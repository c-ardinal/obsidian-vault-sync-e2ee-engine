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

export async function deriveKey(
    password: string,
    salt: Uint8Array,
    iterations = 100000,
): Promise<CryptoKey> {
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
            iterations,
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
    aad?: Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: ArrayBuffer }> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv,
            ...(aad ? { additionalData: aad } : {}),
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
    aad?: Uint8Array,
): Promise<ArrayBuffer> {
    return await window.crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv,
            ...(aad ? { additionalData: aad } : {}),
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

/** v2 lock-file KDF parameters (OWASP 2023: PBKDF2-HMAC-SHA512 >= 210,000). */
export const LOCK_V2_KDF = { hash: "SHA-512", iterations: 210_000 } as const;

/**
 * v2 lock-file keys: ONE salted, slow PBKDF2-SHA512 run yields 64 bytes, split
 * into the outer key (opens vault-lock.vault) and the inner key (unwraps the
 * master key). The v1 outer key was SHA-256(hashedPassword) with no salt, so
 * anyone holding the lock file could test password guesses at hash speed and
 * skip PBKDF2 entirely.
 */
export async function deriveLockKeysV2(
    hashedPassword: string,
    salt: Uint8Array,
    iterations: number = LOCK_V2_KDF.iterations,
): Promise<{ outerKey: CryptoKey; innerKey: CryptoKey }> {
    const base = await window.crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(hashedPassword),
        { name: "PBKDF2" },
        false,
        ["deriveBits"],
    );
    const bits = new Uint8Array(
        await window.crypto.subtle.deriveBits(
            { name: "PBKDF2", salt, iterations, hash: LOCK_V2_KDF.hash } as Pbkdf2Params,
            base,
            512,
        ),
    );
    const outerKey = await window.crypto.subtle.importKey(
        "raw",
        bits.slice(0, 32),
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
    );
    const innerKey = await window.crypto.subtle.importKey(
        "raw",
        bits.slice(32, 64),
        { name: "AES-GCM" },
        false,
        ["wrapKey", "unwrapKey"],
    );
    return { outerKey, innerKey };
}
