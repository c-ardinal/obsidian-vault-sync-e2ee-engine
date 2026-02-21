import { VaultLockData, ICryptoEngine, SettingSection, E2EEPluginContext } from "../interfaces";
import { generateMasterKey, deriveKey, encryptData, decryptData, deriveOuterKey, hashPassword } from "./crypto-primitives";
import {
    isChunkedFormat as _isChunkedFormat,
    encryptChunked as _encryptChunked,
    decryptChunked as _decryptChunked,
    calculateVSC2Size,
    buildVSC2Header as _buildVSC2Header,
    encryptChunks as _encryptChunks,
} from "./chunked-crypto";
import {
    E2EESetupModal,
    E2EEUnlockModal,
    E2EEPasswordChangeModal,
    E2EERecoveryExportModal,
    E2EERecoveryImportModal,
} from "../ui/modals";

export class MasterKeyManager implements ICryptoEngine {
    private masterKey: CryptoKey | null = null;

    readonly ivSize = 12;
    readonly tagSize = 16;

    isUnlocked(): boolean {
        return this.masterKey !== null;
    }

    async initializeNewVault(password: string): Promise<string> {
        const mk = await generateMasterKey();
        this.masterKey = mk;
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const wk = await deriveKey(password, salt);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const wrappedKeyBuffer = await window.crypto.subtle.wrapKey("raw", mk, wk, {
            name: "AES-GCM",
            iv,
        });

        const lockData: VaultLockData = {
            salt: this.arrayBufferToBase64(salt),
            encryptedMasterKey: this.arrayBufferToBase64(wrappedKeyBuffer),
            iv: this.arrayBufferToBase64(iv),
            algo: "PBKDF2-SHA256-100k-AES-GCM-256",
        };
        return await this.wrapLockFile(lockData, password);
    }

    async updatePassword(password: string): Promise<string> {
        if (!this.masterKey) throw new Error("Vault is locked. Unlock first.");

        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const wk = await deriveKey(password, salt);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));

        const wrappedKeyBuffer = await window.crypto.subtle.wrapKey("raw", this.masterKey, wk, {
            name: "AES-GCM",
            iv,
        });

        const lockData: VaultLockData = {
            salt: this.arrayBufferToBase64(salt),
            encryptedMasterKey: this.arrayBufferToBase64(wrappedKeyBuffer),
            iv: this.arrayBufferToBase64(iv),
            algo: "PBKDF2-SHA256-100k-AES-GCM-256",
        };
        return await this.wrapLockFile(lockData, password);
    }

    async unlockVault(encryptedBlob: string, password: string): Promise<void> {
        // Outer layer: fast password check via AES-GCM(SHA-256(hashedPassword))
        let lockData: VaultLockData;
        try {
            lockData = await this.unwrapLockFile(encryptedBlob, password);
        } catch (e) {
            this.masterKey = null;
            throw new Error("Invalid password");
        }

        // Inner layer: PBKDF2-derived key unwraps the master key
        const salt = this.base64ToArrayBuffer(lockData.salt);
        const iv = this.base64ToArrayBuffer(lockData.iv);
        const wrappedKeyBuffer = this.base64ToArrayBuffer(lockData.encryptedMasterKey);
        const wk = await deriveKey(password, new Uint8Array(salt));

        try {
            this.masterKey = await window.crypto.subtle.unwrapKey(
                "raw",
                wrappedKeyBuffer,
                wk,
                { name: "AES-GCM", iv: new Uint8Array(iv) },
                "AES-GCM",
                true,
                ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
            );
        } catch (e) {
            this.masterKey = null;
            throw new Error("Invalid password");
        }
    }

    async encrypt(data: ArrayBuffer): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> {
        if (!this.masterKey) throw new Error("Locked");
        return await encryptData(this.masterKey, data);
    }

    async decrypt(ciphertext: ArrayBuffer, iv: Uint8Array): Promise<ArrayBuffer> {
        if (!this.masterKey) throw new Error("Locked");
        return await decryptData(this.masterKey, ciphertext, iv);
    }

    async encryptToBlob(data: ArrayBuffer): Promise<ArrayBuffer> {
        const { iv, ciphertext } = await this.encrypt(data);
        const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), iv.byteLength);
        return combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength);
    }

    async decryptFromBlob(blob: ArrayBuffer): Promise<ArrayBuffer> {
        if (blob.byteLength < this.ivSize) {
            throw new Error("Encrypted data too short (missing IV).");
        }
        const iv = new Uint8Array(blob.slice(0, this.ivSize));
        const ciphertext = blob.slice(this.ivSize);
        return this.decrypt(ciphertext, iv);
    }

    getOptimalChunkSize(): number {
        // 1 MiB (256 KiB × 4) minus IV and GCM tag overhead per chunk
        return 1_048_576 - this.ivSize - this.tagSize;
    }

    isChunkedFormat(data: ArrayBuffer): boolean {
        return _isChunkedFormat(data);
    }

    async encryptChunked(data: ArrayBuffer): Promise<ArrayBuffer> {
        return _encryptChunked(data, this, this.getOptimalChunkSize());
    }

    async decryptChunked(data: ArrayBuffer): Promise<ArrayBuffer> {
        return _decryptChunked(data, this);
    }

    calculateChunkedSize(plaintextSize: number): number {
        return calculateVSC2Size(plaintextSize, this.getOptimalChunkSize(), this.ivSize, this.tagSize);
    }

    buildChunkedHeader(plaintextSize: number): Uint8Array {
        const chunkSize = this.getOptimalChunkSize();
        const totalChunks = Math.max(1, Math.ceil(plaintextSize / chunkSize));
        return _buildVSC2Header(chunkSize, totalChunks);
    }

    async *encryptChunks(data: ArrayBuffer): AsyncGenerator<{
        iv: Uint8Array;
        ciphertext: ArrayBuffer;
        index: number;
        totalChunks: number;
    }> {
        yield* _encryptChunks(data, this, this.getOptimalChunkSize());
    }

    async exportRecoveryCode(): Promise<string> {
        if (!this.masterKey) throw new Error("Vault is locked.");
        const rawKey = await window.crypto.subtle.exportKey("raw", this.masterKey);
        return btoa(String.fromCharCode(...new Uint8Array(rawKey)));
    }

    async recoverFromCode(recoveryCode: string, newPassword: string): Promise<string> {
        const rawBytes = Uint8Array.from(atob(recoveryCode), c => c.charCodeAt(0));
        if (rawBytes.byteLength !== 32) throw new Error("Invalid recovery code length.");

        const restoredKey = await window.crypto.subtle.importKey(
            "raw", rawBytes, { name: "AES-GCM", length: 256 },
            true, ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
        );

        this.masterKey = restoredKey;

        const hashedPassword = await hashPassword(newPassword);
        return this.updatePassword(hashedPassword);
    }

    async getKeyFingerprint(): Promise<string> {
        if (!this.masterKey) throw new Error("Vault is locked.");
        const rawKey = await window.crypto.subtle.exportKey("raw", this.masterKey);
        const hash = await window.crypto.subtle.digest("SHA-256", rawKey);
        return Array.from(new Uint8Array(hash).slice(0, 4))
            .map(b => b.toString(16).padStart(2, "0")).join("");
    }

    showSetupModal(ctx: E2EEPluginContext): void {
        new E2EESetupModal(ctx.app, ctx).open();
    }

    showUnlockModal(ctx: E2EEPluginContext): void {
        new E2EEUnlockModal(ctx.app, ctx).open();
    }

    showPasswordChangeModal(ctx: E2EEPluginContext): void {
        new E2EEPasswordChangeModal(ctx.app, ctx).open();
    }

    showRecoveryExportModal(ctx: E2EEPluginContext): void {
        new E2EERecoveryExportModal(ctx.app, ctx).open();
    }

    showRecoveryImportModal(ctx: E2EEPluginContext): void {
        new E2EERecoveryImportModal(ctx.app, ctx).open();
    }

    getSettingsSections(ctx: E2EEPluginContext): SettingSection[] {
        const t = (key: string) => ctx.t(key);

        return [
            {
                id: "security",
                title: t("settingSecuritySection") || "Security (E2EE)",
                items: [
                    {
                        key: "e2eeStatusDisp",
                        type: "info",
                        label: t("settingE2EEStatus") || "Encryption Status",
                        desc: t("settingE2EEStatusGuide") || "Manage via Command Palette.",
                        getDesc: () => {
                            if (!ctx.settings.e2eeEnabled) return t("settingE2EEStatusDisabled") || "Disabled";
                            if (ctx.cryptoEngine.isUnlocked())
                                return t("settingE2EEStatusUnlocked") || "Unlocked";
                            return t("settingE2EEStatusLocked") || "Locked";
                        },
                    },
                ],
            },
        ];
    }

    // --- Outer encryption: vault-lock file wrapping ---

    private async wrapLockFile(lockData: VaultLockData, hashedPassword: string): Promise<string> {
        const outerKey = await deriveOuterKey(hashedPassword);
        const plaintext = new TextEncoder().encode(JSON.stringify(lockData));
        const { iv, ciphertext } = await encryptData(outerKey, plaintext.buffer);
        // Combine: [iv (12 bytes)][ciphertext]
        const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), iv.length);
        return btoa(String.fromCharCode(...combined));
    }

    private async unwrapLockFile(blob: string, hashedPassword: string): Promise<VaultLockData> {
        const outerKey = await deriveOuterKey(hashedPassword);
        const binaryStr = atob(blob);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const iv = bytes.slice(0, 12);
        const ciphertext = bytes.slice(12);
        const plaintext = await decryptData(outerKey, ciphertext.buffer, iv);
        return JSON.parse(new TextDecoder().decode(plaintext)) as VaultLockData;
    }

    // --- Helpers ---

    private arrayBufferToBase64(buffer: Uint8Array | ArrayBuffer): string {
        return btoa(String.fromCharCode(...new Uint8Array(buffer)));
    }

    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
}
