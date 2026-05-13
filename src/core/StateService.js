/**
 * File: src/core/StateService.js
 * Description: Lightweight state persistence for last used auth index
 *
 * Saves and loads { lastAuthIndex: number } to data/state.json
 */

const fs = require("fs");
const path = require("path");

class StateService {
    constructor(logger, dataDir) {
        this.logger = logger;
        this.dataDir = dataDir || path.join(process.cwd(), "data");
        this.stateFilePath = path.join(this.dataDir, "state.json");
        this.tempStateFilePath = `${this.stateFilePath}.tmp`;
        this.persistenceEnabled = true;

        try {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
        } catch (error) {
            this.persistenceEnabled = false;
            this.logger.warn(`[State] Failed to prepare state directory: ${error.message}`);
        }

        // Load persisted state
        this.state = this._load();
    }

    /**
     * Load state from disk
     * @returns {Object} The loaded state object
     */
    _load() {
        if (!this.persistenceEnabled) {
            return { lastAuthIndex: null };
        }

        try {
            if (fs.existsSync(this.stateFilePath)) {
                const raw = fs.readFileSync(this.stateFilePath, "utf8");
                const parsed = JSON.parse(raw);
                const lastAuthIndex = this._normalizeAuthIndex(parsed.lastAuthIndex);
                this.logger.debug(`[State] Loaded state: lastAuthIndex=${lastAuthIndex}`);
                return { lastAuthIndex };
            }
        } catch (error) {
            this.logger.warn(`[State] Failed to load state file: ${error.message}`);
        }
        return { lastAuthIndex: null };
    }

    /**
     * Save state to disk
     */
    _save(nextState = this.state) {
        if (!this.persistenceEnabled) {
            return false;
        }

        try {
            fs.writeFileSync(this.tempStateFilePath, JSON.stringify(nextState, null, 2), "utf8");
            fs.renameSync(this.tempStateFilePath, this.stateFilePath);
            this.logger.debug(`[State] Saved state: lastAuthIndex=${nextState.lastAuthIndex}`);
            return true;
        } catch (error) {
            this.logger.warn(`[State] Failed to save state file: ${error.message}`);
            return false;
        }
    }

    _persistState(nextState) {
        this.state = nextState;
        return this._save(nextState);
    }

    /**
     * Get the last used auth index
     * @returns {number|null} The last auth index, or null if not set
     */
    getLastAuthIndex() {
        return this._normalizeAuthIndex(this.state.lastAuthIndex);
    }

    /**
     * Update the last used auth index and persist to disk
     * @param {number} authIndex - The auth index to save
     */
    setLastAuthIndex(authIndex) {
        const normalizedAuthIndex = this._normalizeAuthIndex(authIndex);
        if (normalizedAuthIndex === null) {
            return;
        }

        if (this.state.lastAuthIndex !== normalizedAuthIndex) {
            const nextState = { ...this.state, lastAuthIndex: normalizedAuthIndex };
            this._persistState(nextState);
        }
    }

    _normalizeAuthIndex(authIndex) {
        return Number.isInteger(authIndex) && authIndex >= 0 ? authIndex : null;
    }
}

module.exports = StateService;
