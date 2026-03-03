/**
 * Cryptographic primitives for Vault-Sync using Web Crypto API (SubtleCrypto).
 */

export async function generateMasterKey(): Promise<CryptoKey> {
    return await window.crypto.subtle.generateKey(
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
    );
}

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordKey = await window.crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"],
    );

    return await window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: 100000,
            hash: "SHA-256",
        } as Pbkdf2Params,
        passwordKey,
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        ["wrapKey", "unwrapKey", "encrypt", "decrypt"],
    );
}

export async function encryptData(
    key: CryptoKey,
    data: ArrayBuffer,
): Promise<{ iv: Uint8Array; ciphertext: ArrayBuffer }> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv,
        } as AesGcmParams,
        key,
        data,
    );
    return { iv, ciphertext };
}

export async function decryptData(
    key: CryptoKey,
    data: ArrayBuffer,
    iv: Uint8Array,
): Promise<ArrayBuffer> {
    return await window.crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv,
        } as AesGcmParams,
        key,
        data,
    );
}

export async function hashPassword(password: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // consistent base64 encoding
    return btoa(String.fromCharCode(...hashArray));
}

/**
 * Derive an outer encryption key from hashedPassword using SHA-256.
 * Used to encrypt vault-lock file for opaque storage.
 * Key independence: outerKey = SHA-256(hashedPassword), innerKey = PBKDF2(hashedPassword, salt)
 */
export async function deriveOuterKey(hashedPassword: string): Promise<CryptoKey> {
    const hashBuffer = await window.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(hashedPassword),
    );
    return await window.crypto.subtle.importKey("raw", hashBuffer, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
    ]);
}
