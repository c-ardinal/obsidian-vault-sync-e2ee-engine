import { describe, it, expect, beforeAll, vi } from "vitest";
import { MasterKeyManager } from "../src/encryption/key-manager";
import { encryptData, decryptData } from "../src/encryption/crypto-primitives";

// Mock obsidian
vi.mock("obsidian", () => ({
    Notice: vi.fn(),
    Modal: class {},
    Setting: class {
        setName = vi.fn().mockReturnThis();
        setDesc = vi.fn().mockReturnThis();
        addText = vi.fn().mockReturnThis();
        addButton = vi.fn().mockReturnThis();
    },
    App: class {},
}));

// Provide window and crypto polyfills for Node environment
import { webcrypto } from "node:crypto";
const g = globalThis as any;
if (typeof window === "undefined") {
    g.window = g;
}
if (!g.crypto) {
    g.crypto = webcrypto;
}
if (!g.TextEncoder) {
    const { TextEncoder, TextDecoder } = await import("node:util");
    g.TextEncoder = TextEncoder;
    g.TextDecoder = TextDecoder;
}

describe("Encryption Foundation", () => {
    const password = "test-password-123";
    let keyManager: MasterKeyManager;

    beforeAll(() => {
        keyManager = new MasterKeyManager();
    });

    it("should initialize a new vault and generate encrypted lock blob", async () => {
        const blob = await keyManager.initializeNewVault(password);
        expect(typeof blob).toBe("string");
        expect(blob.length).toBeGreaterThan(0);
        // Blob should be valid base64 (outer AES-GCM encrypted VaultLockData)
        expect(() => atob(blob)).not.toThrow();
        expect(keyManager.isUnlocked()).toBe(true);
    });

    it("should unlock the vault with the correct password", async () => {
        const lockData = await keyManager.initializeNewVault(password);
        // MasterKeyManager doesn't have a public lock() in the new simplified version,
        // we'll just check re-unlocking.
        const newManager = new MasterKeyManager();
        await newManager.unlockVault(lockData, password);
        expect(newManager.isUnlocked()).toBe(true);
    });

    it("should correctly encrypt and decrypt data", async () => {
        await keyManager.initializeNewVault(password);
        const originalText = "Hello, End-to-End Encryption!";
        const encoder = new TextEncoder();
        const data = encoder.encode(originalText).buffer;

        const { iv, ciphertext } = await keyManager.encrypt(data);
        expect(new Uint8Array(ciphertext)).not.toEqual(new Uint8Array(data));

        const decrypted = await keyManager.decrypt(ciphertext, iv);
        const decoder = new TextDecoder();
        const decryptedText = decoder.decode(decrypted);

        expect(decryptedText).toBe(originalText);
    });
});
