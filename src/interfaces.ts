import type { App } from "obsidian";

export interface VaultLockData {
    salt: string;
    encryptedMasterKey: string;
    iv: string;
    algo: string;
    /** v2: PBKDF2 iterations used for the lock keys */
    iterations?: number;
}

export interface MigrationProgress {
    current: number;
    total: number;
    fileName: string;
}

export interface SettingItem {
    key: string;
    type: "toggle" | "text" | "number" | "dropdown" | "textarea" | "info" | "subheader";
    label: string;
    desc?: string;
    getDesc?: (settings: any, plugin: any) => string;
    placeholder?: string;
    options?: Record<string, string>;
    unit?: string;
    limits?: { min: number; max: number; default: number; disabled?: number };
    onChange?: (value: any, plugin: any) => Promise<void>;
    isHidden?: (settings: any) => boolean;
}

export interface SettingSection {
    id: string;
    title: string;
    description?: string;
    items: SettingItem[];
    isHidden?: (settings: any) => boolean;
}

export interface E2EEPluginContext {
    /** Obsidian App (for Modal constructor) */
    app: App;

    /** i18n translation */
    t(key: string): string;

    /** Password strength checker (optional, provided by plugin) */
    checkPasswordStrength?(password: string): {
        strength: string;
        feedback: string[];
    };

    /** Plugin settings (mutable reference to actual settings object) */
    settings: {
        e2eeEnabled: boolean;
        e2eeAutoUnlock: boolean;
    };
    saveSettings(): Promise<void>;
    refreshSettingsUI?(): void;

    /** Crypto engine reference */
    cryptoEngine: ICryptoEngine;

    /** Flattened services (eliminates syncManager.xxx.yyy chains) */
    vaultLockService: {
        downloadLockFile(): Promise<string>;
        uploadLockFile(blob: string): Promise<void>;
    };
    secureStorage: {
        setExtraSecret(key: string, value: string): Promise<void>;
        removeExtraSecret(key: string): Promise<void>;
    } | null;
    migrationService: {
        isMigrating: boolean;
        currentProgress: MigrationProgress | null;
        startMigration(hashedPassword: string): Promise<unknown>;
        runMigration(
            adapter: unknown,
            onProgress: (p: MigrationProgress) => void,
        ): Promise<void>;
        finalizeMigration(adapter: unknown): Promise<void>;
        checkForInterruptedMigration(): Promise<boolean>;
        cancelMigration(): Promise<void>;
    };

    /** Notification + logging (flattened from syncManager) */
    notify(key: string): Promise<void>;
    log(message: string, level: "system" | "error" | "warn" | "notice" | "info" | "debug"): Promise<void>;

    /** Set sync trigger type */
    setCurrentTrigger(trigger: string): void;
}

export interface ICryptoEngine {
    initializeNewVault(password: string): Promise<string>;
    unlockVault(encryptedBlob: string, password: string): Promise<void>;
    updatePassword(password: string): Promise<string>;
    isUnlocked(): boolean;
    /**
     * True after unlocking a lock file in the old (v1) format. The caller should
     * then re-save it: `uploadLockFile(await updatePassword(samePassword))`.
     */
    needsLockMigration?(): boolean;

    encrypt(data: ArrayBuffer, aad?: Uint8Array): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }>;
    decrypt(ciphertext: ArrayBuffer, iv: Uint8Array, aad?: Uint8Array): Promise<ArrayBuffer>;

    /** Cipher metadata for AES-256-GCM. */
    readonly ivSize: number;
    readonly tagSize: number;

    /** Encrypt data and return the wire-format blob: [IV][ciphertext] (VSC1). */
    encryptToBlob(data: ArrayBuffer): Promise<ArrayBuffer>;
    /** Decrypt a wire-format blob: splits [IV][ciphertext] and decrypts. */
    decryptFromBlob(blob: ArrayBuffer): Promise<ArrayBuffer>;
    /** Return the optimal plaintext chunk size so encrypted chunks align to 256 KiB boundaries. */
    getOptimalChunkSize(): number;

    // Chunked encryption (writes VSC3; reads VSC3 and the older VSC2)
    /** Check whether data starts with a chunked-format (VSC2/VSC3) magic header. */
    isChunkedFormat(data: ArrayBuffer): boolean;
    /** Encrypt data into VSC3 chunked format. */
    encryptChunked(data: ArrayBuffer): Promise<ArrayBuffer>;
    /** Decrypt VSC3 or VSC2 chunked-format data back to plaintext. */
    decryptChunked(data: ArrayBuffer): Promise<ArrayBuffer>;
    /** Calculate the total encrypted size for a given plaintext size in VSC3 format. */
    calculateChunkedSize(plaintextSize: number): number;
    /** Build a VSC3 header (with a fresh file nonce) for a given plaintext size. */
    buildChunkedHeader(plaintextSize: number): Uint8Array;
    /**
     * Encrypt data as a stream of chunks for use with resumable uploads.
     * Pass the header from buildChunkedHeader that is written in front of the
     * chunks; each chunk is authenticated together with it and its position.
     */
    encryptChunks(
        data: ArrayBuffer,
        header?: Uint8Array,
    ): AsyncGenerator<{
        iv: Uint8Array;
        ciphertext: ArrayBuffer;
        index: number;
        totalChunks: number;
        header: Uint8Array;
    }>;

    // Recovery
    exportRecoveryCode(): Promise<string>;
    recoverFromCode(recoveryCode: string, newPassword: string): Promise<string>;
    getKeyFingerprint(): Promise<string>;

    // UI Injection
    showSetupModal(ctx: E2EEPluginContext): void;
    showUnlockModal(ctx: E2EEPluginContext): void;
    showPasswordChangeModal(ctx: E2EEPluginContext): void;
    showRecoveryExportModal(ctx: E2EEPluginContext): void;
    showRecoveryImportModal(ctx: E2EEPluginContext): void;
    getSettingsSections(ctx: E2EEPluginContext): SettingSection[];
    /**
     * This add-on's settings page and actions. Vault-Sync lists the page under
     * Settings › Add-ons and registers the actions as commands. Vault-Sync
     * versions without add-on pages do not call it and keep using the methods above.
     */
    getUiContributions(ctx: E2EEPluginContext, host: AddonUiHost): AddonUiContributions;
    /** Display text for a UI language ("en", "ja", ...). Vault-Sync's own dictionary has none of it. */
    getStrings(lang: string): Record<string, string>;
}

// --- Add-on UI contract (copy of Vault-Sync's src/addons/addon-ui.ts) ---

/** One row on an add-on page. "action" runs actionId, "page" opens pageId. */
export interface AddonSettingItem {
    key: string;
    type: SettingItem["type"] | "action" | "page";
    label: string;
    desc?: string;
    getDesc?: (settings: any, plugin: any) => string;
    placeholder?: string;
    options?: Record<string, string>;
    unit?: string;
    limits?: { min: number; max: number; default: number; disabled?: number };
    onChange?: (value: any, plugin: any) => Promise<void>;
    isHidden?: (settings: any) => boolean;
    actionId?: string;
    pageId?: string;
}

export interface AddonSettingSection {
    id: string;
    title: string;
    description?: string;
    items: AddonSettingItem[];
    isHidden?: (settings: any) => boolean;
}

export interface AddonAction {
    /** Stable id, also the command id: keep it across releases (hotkeys). */
    id: string;
    /** Command palette name, and default row name. */
    label: string;
    description?: string;
    buttonText?: string;
    style?: "default" | "cta" | "warning";
    /** false: settings pages only. Default true. */
    command?: boolean;
    isAvailable?(): boolean;
    run(): void | Promise<void>;
}

export interface AddonPage {
    id: string;
    title: string;
    description?: string;
    /** Lucide icon name */
    icon?: string;
    /** Read each time the page is drawn. */
    getSections(): AddonSettingSection[];
}

export interface AddonUiContributions {
    pages?: AddonPage[];
    actions?: AddonAction[];
}

export interface AddonUiHost {
    refresh(): void;
    openPage(pageId: string): void;
    runAction(actionId: string): Promise<boolean>;
}
