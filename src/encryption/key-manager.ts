import { VaultLockData, ICryptoEngine, SettingSection } from "../interfaces";
import { generateMasterKey, deriveKey, encryptData, decryptData, deriveOuterKey } from "./crypto-primitives";
import { E2EESetupModal, E2EEUnlockModal } from "../ui/modals";
import { Notice } from "obsidian";

export class MasterKeyManager implements ICryptoEngine {
    private masterKey: CryptoKey | null = null;

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

    showSetupModal(plugin: any): void {
        new E2EESetupModal(plugin.app, plugin).open();
    }

    showUnlockModal(plugin: any): void {
        new E2EEUnlockModal(plugin.app, plugin).open();
    }

    getSettingsSections(plugin: any): SettingSection[] {
        const t = (key: string) => plugin.t?.(key) || plugin.syncManager?.t?.(key) || key;

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
                        getDesc: (s: any, p: any) => {
                            if (!s.e2eeEnabled) return t("settingE2EEStatusDisabled") || "Disabled";
                            if (p.syncManager?.cryptoEngine?.isUnlocked?.())
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
