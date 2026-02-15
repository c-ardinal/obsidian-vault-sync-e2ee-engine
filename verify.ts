import { MasterKeyManager } from "./src/encryption/key-manager.js";
import { webcrypto } from "node:crypto";

// Polyfill
(globalThis as any).window = globalThis;
(globalThis as any).crypto = webcrypto;

async function test() {
    try {
        const keyManager = new MasterKeyManager();
        const lockData = await keyManager.initializeNewVault("test-password");
        console.log("Success: Lock data generated");
        console.log("Unlocked:", keyManager.isUnlocked());
    } catch (e) {
        console.error("Failed:", e);
    }
}

test();
