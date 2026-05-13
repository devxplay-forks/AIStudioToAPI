# Feature: Persist Last Used Account Index Across Restarts

## Problem

Every time the server restarted, it would always start from the first account in the list (`auth-0.json`), regardless of which account was last used before shutdown. There was no mechanism to remember and resume from the last active account.

## Solution

Implemented a lightweight state persistence mechanism that saves the current `authIndex` to a JSON file on every change, and loads it back on startup.

## Files Changed

### 1. New File: `src/core/StateService.js`

**Purpose:** Read/write persistent state to `data/state.json`.

**Key methods:**

- `_load()` — reads `data/state.json` on construction
- `_save()` — writes `{ lastAuthIndex: number }` to `data/state.json`
- `getLastAuthIndex()` — returns the saved index or `null`
- `setLastAuthIndex(authIndex)` — updates and persists the index (only if changed)

**Design notes:**

- Uses synchronous `fs.readFileSync`/`writeFileSync` — appropriate for this use case since it's only called on state changes, not hot paths
- File path: `data/state.json` (reuses existing `data/` directory)
- Gracefully handles missing/corrupt files by returning default state `{ lastAuthIndex: null }`
- Validates loaded values so only non-negative integer auth indices are accepted

### 2. Modified: `src/core/BrowserManager.js`

**Change 1 — Constructor signature:**

```text
constructor(logger, config, authSource, stateService = null)
```

Added optional `stateService` parameter (default `null` so existing callers without it still work).

**Change 2 — currentAuthIndex setter:**

```javascript
set currentAuthIndex(value) {
    this._currentAuthIndex = value;
    if (this.stateService && value >= 0) {
        this.stateService.setLastAuthIndex(value);
    }
}
```

Every time the current account index changes to a valid value (>= 0), it is immediately persisted.

**Change 3 — activation path:**
`_activateContext()` now updates the current account through the setter, so successful startup activation, fast switches, and newly initialized switches all persist the last used account.

### 3. Modified: `src/core/ProxyServerSystem.js`

**Change 1 — Added import:**

```javascript
const StateService = require("./StateService");
```

**Change 2 — Constructor:**

```javascript
const dataDir = path.join(process.cwd(), "data");
this.stateService = new StateService(this.logger, dataDir);
this.browserManager = new BrowserManager(this.logger, this.config, this.authSource, this.stateService);
```

StateService is created before BrowserManager so it can be passed in.

**Change 3 — `start()` method logic (around line 169):**
When `INITIAL_AUTH_INDEX` env var is NOT set, the code now checks `stateService.getLastAuthIndex()`:

- If the saved index is valid and still available → put it first in `startupOrder`
- If the saved index points at a duplicate auth file → resume from that account's canonical/latest auth index
- If the saved index was deleted → fall through to default first-available behavior
- If no saved state → same as before (first available)

```javascript
} else {
    const savedLastAuthIndex = this.stateService.getLastAuthIndex();
    const canonicalSavedIndex =
        savedLastAuthIndex !== null ? this.authSource.getCanonicalIndex(savedLastAuthIndex) : null;
    if (canonicalSavedIndex !== null && startupOrder.includes(canonicalSavedIndex)) {
        startupOrder = [canonicalSavedIndex, ...startupOrder.filter(i => i !== canonicalSavedIndex)];
        if (canonicalSavedIndex !== savedLastAuthIndex) {
            this.logger.warn(
                `[System] Last used account #${savedLastAuthIndex} is a duplicate, resuming from latest auth index #${canonicalSavedIndex}.`
            );
        } else {
            this.logger.info(
                `[System] No startup index specified, resuming from last used account #${savedLastAuthIndex}.`
            );
        }
    } else if (savedLastAuthIndex !== null) {
        this.logger.info(
            `[System] Last used account #${savedLastAuthIndex} is no longer available for startup, starting from first available context.`
        );
    } else {
        this.logger.info(
            `[System] No valid startup index specified, will activate first available context [${startupOrder[0]}].`
        );
    }
}
```

### 4. Modified: `main.js`

Startup parsing now preserves `INITIAL_AUTH_INDEX=0` as an explicit configured value instead of treating it as unset. Parsing is strict, so malformed values such as `1abc` are ignored instead of being partially parsed as `1`.

### 5. Modified: `.env.example` and `README.md`

`INITIAL_AUTH_INDEX` is now documented as an optional override. Leaving it unset allows the saved last-used account to be used by default.

## Startup Priority

| Priority     | Source                        | Value                                |
| ------------ | ----------------------------- | ------------------------------------ |
| 1 (highest)  | `INITIAL_AUTH_INDEX` env var  | User explicitly sets startup account |
| 2            | `data/state.json` (last used) | Auto-resume from previous session    |
| 3 (fallback) | First available account       | Default behavior                     |

## Data Flow

```
[Server Start]
    └─> ProxyServerSystem.start(initialAuthIndex=null)
            └─> initialAuthIndex is null? Yes (no env var)
                    └─> stateService.getLastAuthIndex() → e.g., 3
                    └─> startupOrder = [3, 0, 1, 2, 4, ...]
                    └─> preloadContextPool(startupOrder, maxContexts)
                    └─> launchOrSwitchContext(3)  ← resumed from #3

[During Operation]
    └─> Account switch to #5
            └─> browserManager.currentAuthIndex = 5
                    └─> stateService.setLastAuthIndex(5)
                            └─> writes { "lastAuthIndex": 5 } to data/state.json

[Server Restart]
    └─> ProxyServerSystem.start()
            └─> stateService._load() reads data/state.json
            └─> getLastAuthIndex() returns 5
            └─> Resume from account #5
```

## Verification

- `eslint` on affected runtime files: **clean**
- Direct `StateService` persistence check: **clean**
- No breaking changes to existing API signatures (stateService defaults to `null`)

## Potential Review Points

1. **Should we also persist account usage counts?** Currently only the index is saved, not which account was used how many times (SWITCH_ON_USES counter resets on restart).

2. **Race condition on simultaneous writes?** StateService uses sync file I/O and is called from the `currentAuthIndex` setter, which is only invoked from single-threaded contexts. No concurrent writes should occur under normal operation.

3. **Should we debounce saves?** The setter calls `_save()` on every change. For high-frequency switching scenarios, a debounce could reduce disk writes, but the current pattern (sync, on explicit setter call) seems fine for this use case.

4. **What if `data/` dir is not writable?** StateService logs a warning, disables persistence, and falls back to in-memory state — server continues working without persistence.

5. **Should we use `data/state.jsonl` (append-only) like UsageStatsService?** The current single-JSON approach overwrites on each update. Append-only would be safer against crashes mid-write but is more complex. Current implementation is simpler and sufficient for this feature.
