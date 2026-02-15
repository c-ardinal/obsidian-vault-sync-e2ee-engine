import { VaultLockData, ICryptoEngine, SettingSection } from "../interfaces";
import { generateMasterKey, deriveKey, encryptData, decryptData } from "./crypto-primitives";
import { E2EESetupModal, E2EEUnlockModal } from "../ui/modals";
import { Notice } from "obsidian";

export class MasterKeyManager implements ICryptoEngine {
    private masterKey: CryptoKey | null = null;

    isUnlocked(): boolean {
        return this.masterKey !== null;
    }

    async initializeNewVault(password: string): Promise<VaultLockData> {
        const mk = await generateMasterKey();
        this.masterKey = mk;
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const wk = await deriveKey(password, salt);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const wrappedKeyBuffer = await window.crypto.subtle.wrapKey("raw", mk, wk, {
            name: "AES-GCM",
            iv,
        });

        return {
            salt: this.arrayBufferToBase64(salt),
            encryptedMasterKey: this.arrayBufferToBase64(wrappedKeyBuffer),
            iv: this.arrayBufferToBase64(iv),
            algo: "PBKDF2-SHA256-100k-AES-GCM-256",
        };
    }

    async updatePassword(password: string): Promise<VaultLockData> {
        if (!this.masterKey) throw new Error("Vault is locked. Unlock first.");

        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const wk = await deriveKey(password, salt);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));

        const wrappedKeyBuffer = await window.crypto.subtle.wrapKey("raw", this.masterKey, wk, {
            name: "AES-GCM",
            iv,
        });

        return {
            salt: this.arrayBufferToBase64(salt),
            encryptedMasterKey: this.arrayBufferToBase64(wrappedKeyBuffer),
            iv: this.arrayBufferToBase64(iv),
            algo: "PBKDF2-SHA256-100k-AES-GCM-256",
        };
    }

    async unlockVault(lockData: VaultLockData, password: string): Promise<void> {
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
