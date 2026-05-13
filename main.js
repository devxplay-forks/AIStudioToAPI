/**
 * File: main.js
 * Description: Main entry file that initializes and starts the AIStudio To API proxy server system
 *
 * Author: Ellinav, iBenzene, bbbugg
 */

// Load environment variables based on NODE_ENV
const path = require("path");
const envFile = process.env.NODE_ENV === "production" ? ".env" : ".env.development";
require("dotenv").config({ path: path.resolve(__dirname, envFile) });

const ProxyServerSystem = require("./src/core/ProxyServerSystem");

const parseInitialAuthIndex = rawValue => {
    if (typeof rawValue !== "string" || rawValue.trim() === "") {
        return null;
    }

    const trimmedValue = rawValue.trim();
    if (!/^\d+$/.test(trimmedValue)) {
        console.warn(`[Config] Ignoring invalid INITIAL_AUTH_INDEX="${rawValue}". Expected a non-negative integer.`);
        return null;
    }

    const parsedValue = Number(trimmedValue);
    if (!Number.isSafeInteger(parsedValue)) {
        console.warn(
            `[Config] Ignoring invalid INITIAL_AUTH_INDEX="${rawValue}". Expected a safe non-negative integer.`
        );
        return null;
    }

    return parsedValue;
};

/**
 * Initialize and start the server
 */
const initializeServer = async () => {
    const initialAuthIndex = parseInitialAuthIndex(process.env.INITIAL_AUTH_INDEX);

    try {
        const serverSystem = new ProxyServerSystem();
        await serverSystem.start(initialAuthIndex);

        // Handle graceful shutdown
        const shutdownHandler = async signal => {
            console.log(`\n${signal} received, shutting down gracefully...`);
            try {
                await serverSystem.shutdown();
                process.exit(0);
            } catch (error) {
                console.error("Error during shutdown:", error);
                process.exit(1);
            }
        };

        process.on("SIGTERM", () => shutdownHandler("SIGTERM"));
        process.on("SIGINT", () => shutdownHandler("SIGINT"));
    } catch (error) {
        console.error("❌ Server startup failed:", error.message);
        process.exit(1);
    }
};

// If this file is run directly, start the server
if (require.main === module) {
    initializeServer();
}

module.exports = { initializeServer, parseInitialAuthIndex, ProxyServerSystem };
