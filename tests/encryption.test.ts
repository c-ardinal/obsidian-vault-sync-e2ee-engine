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

describe("Recovery Code", () => {
    const password = "recovery-test-pw";
    let keyManager: MasterKeyManager;

    beforeAll(() => {
        keyManager = new MasterKeyManager();
    });

    it("exportRecoveryCode returns a 44-char Base64 string (32 bytes)", async () => {
        await keyManager.initializeNewVault(password);
        const code = await keyManager.exportRecoveryCode();
        expect(typeof code).toBe("string");
        expect(code.length).toBe(44); // 32 bytes → Base64 = 44 chars
        expect(() => atob(code)).not.toThrow();
    });

    it("exportRecoveryCode throws when vault is locked", async () => {
        const locked = new MasterKeyManager();
        await expect(locked.exportRecoveryCode()).rejects.toThrow("Vault is locked");
    });

    it("recoverFromCode restores vault and returns a working blob", async () => {
        // 1. Initialize vault and export recovery code
        const km1 = new MasterKeyManager();
        await km1.initializeNewVault(password);
        const code = await km1.exportRecoveryCode();

        // 2. Encrypt some data with original key
        const originalText = "Recovery test data";
        const data = new TextEncoder().encode(originalText).buffer;
        const { iv, ciphertext } = await km1.encrypt(data);

        // 3. Recover with new password using a fresh manager
        const km2 = new MasterKeyManager();
        const newPassword = "new-password-456";
        const newBlob = await km2.recoverFromCode(code, newPassword);
        expect(km2.isUnlocked()).toBe(true);

        // 4. Decrypt original data with recovered key
        const decrypted = await km2.decrypt(ciphertext, iv);
        expect(new TextDecoder().decode(decrypted)).toBe(originalText);

        // 5. New blob should work with the hashed new password
        const km3 = new MasterKeyManager();
        const { hashPassword: hp } = await import("../src/encryption/crypto-primitives");
        const hashedNewPw = await hp(newPassword);
        await km3.unlockVault(newBlob, hashedNewPw);
        expect(km3.isUnlocked()).toBe(true);

        // 6. Decrypting with recovered-then-unlocked key should also work
        const decrypted2 = await km3.decrypt(ciphertext, iv);
        expect(new TextDecoder().decode(decrypted2)).toBe(originalText);
    });

    it("recoverFromCode throws on invalid code length", async () => {
        const km = new MasterKeyManager();
        await expect(km.recoverFromCode("AAAA", "some-password"))
            .rejects.toThrow("Invalid recovery code length");
    });

    it("getKeyFingerprint returns 8 hex chars", async () => {
        const km = new MasterKeyManager();
        await km.initializeNewVault(password);
        const fp = await km.getKeyFingerprint();
        expect(fp).toMatch(/^[0-9a-f]{8}$/);
    });

    it("getKeyFingerprint is consistent for same key", async () => {
        const km = new MasterKeyManager();
        await km.initializeNewVault(password);
        const fp1 = await km.getKeyFingerprint();
        const fp2 = await km.getKeyFingerprint();
        expect(fp1).toBe(fp2);
    });

    it("getKeyFingerprint throws when vault is locked", async () => {
        const locked = new MasterKeyManager();
        await expect(locked.getKeyFingerprint()).rejects.toThrow("Vault is locked");
    });
});

describe("updatePassword", () => {
    const password = "original-password";

    it("updatePassword returns a new blob that works with new password", async () => {
        const km = new MasterKeyManager();
        const { hashPassword: hp } = await import("../src/encryption/crypto-primitives");
        const hashedPw = await hp(password);
        await km.initializeNewVault(hashedPw);

        // Encrypt some data
        const data = new TextEncoder().encode("password change test").buffer;
        const { iv, ciphertext } = await km.encrypt(data);

        // Change password
        const newPassword = "changed-password-789";
        const hashedNewPw = await hp(newPassword);
        const newBlob = await km.updatePassword(hashedNewPw);
        expect(typeof newBlob).toBe("string");

        // Unlock with new password
        const km2 = new MasterKeyManager();
        await km2.unlockVault(newBlob, hashedNewPw);
        expect(km2.isUnlocked()).toBe(true);

        // Decrypt with new-password-unlocked key
        const decrypted = await km2.decrypt(ciphertext, iv);
        expect(new TextDecoder().decode(decrypted)).toBe("password change test");
    });

    it("updatePassword throws when vault is locked", async () => {
        const km = new MasterKeyManager();
        await expect(km.updatePassword("any")).rejects.toThrow("Vault is locked");
    });
});
