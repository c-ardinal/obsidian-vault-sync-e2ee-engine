import { Modal, Setting, App, Notice, ButtonComponent, TextAreaComponent } from "obsidian";
import { hashPassword } from "../encryption/crypto-primitives";
import type { E2EEPluginContext, MigrationProgress } from "../interfaces";
import { addPasswordInput, createAsciiWarning, renderStrengthIndicator } from "./password-field";

/** Set text content with \n → line breaks */
function setTextWithBreaks(el: HTMLElement, text: string): void {
    el.empty();
    const lines = text.split("\n");
    lines.forEach((line, i) => {
        if (i > 0) el.createEl("br");
        el.appendText(line);
    });
}

function formatError(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * Migration Setup Modal
 */
export class E2EESetupModal extends Modal {
    private password = "";
    private progressBar!: HTMLDivElement;
    private statusText!: HTMLDivElement;
    private fileText!: HTMLDivElement;
    private statsText!: HTMLDivElement;
    private startTime: number = 0;
    private lastLogTime: number = 0;
    private passwordInput?: HTMLInputElement;
    private strengthIndicator?: HTMLDivElement;
    private startBtn?: ButtonComponent;
    private showAsciiWarning?: (visible: boolean) => void;

    constructor(
        app: App,
        private ctx: E2EEPluginContext,
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.ctx.t("e2eeSetupTitle") });

        const desc = contentEl.createEl("p");
        setTextWithBreaks(desc, this.ctx.t("e2eeSetupDesc"));

        // Check for active or interrupted migration
        const { migrationService } = this.ctx;

        if (migrationService && migrationService.isMigrating) {
            contentEl.createEl("div", {
                text: this.ctx.t("e2eeSetupMigratingBg"),
                cls: "vault-sync-warning",
            });
            const p = migrationService.currentProgress;
            if (p) {
                contentEl.createEl("div", { text: `${p.current} / ${p.total} files` });
            }
            return;
        }

        // Check for interrupted
        this.checkInterrupted(contentEl);

        // Password input with show/hide toggle
        this.passwordInput = addPasswordInput({
            container: contentEl,
            t: (k) => this.ctx.t(k),
            label: this.ctx.t("e2eeSetupPasswordLabel"),
            descKey: "e2eeSetupPasswordDesc",
            autocomplete: "new-password",
            onPasswordChange: (pw) => {
                this.password = pw;
                this.updateButtonState();
                if (this.strengthIndicator) {
                    renderStrengthIndicator(
                        this.strengthIndicator, pw,
                        this.ctx.checkPasswordStrength, (k) => this.ctx.t(k),
                    );
                }
            },
            onAsciiViolation: (violated) => this.showAsciiWarning?.(violated),
        });

        // ASCII-only warning (hidden by default)
        this.showAsciiWarning = createAsciiWarning(contentEl, (k) => this.ctx.t(k));

        // Allowed characters hint
        const hint = contentEl.createDiv();
        hint.style.cssText = "color:var(--text-muted);font-size:0.8em;margin-top:-8px;margin-bottom:8px;white-space:pre-line;";
        hint.setText(this.ctx.t("e2eeSetupPasswordHint"));

        // Password strength indicator
        this.strengthIndicator = contentEl.createDiv({ cls: "vault-sync-password-strength" });

        // Progress UI (initially hidden)
        const mgContainer = contentEl.createDiv({ cls: "vault-sync-migration-container" });
        const barWrapper = mgContainer.createDiv({ cls: "vault-sync-progress-wrapper" });
        this.progressBar = barWrapper.createDiv({ cls: "vault-sync-progress-bar" });
        this.statusText = mgContainer.createDiv({ cls: "vault-sync-migration-status" });
        this.fileText = mgContainer.createDiv({ cls: "vault-sync-migration-file" });
        this.statsText = mgContainer.createDiv({ cls: "vault-sync-migration-status" });
        mgContainer.hide();

        // Start Migration button (disabled until password >= 8 chars)
        new Setting(contentEl).addButton((btn) => {
            this.startBtn = btn;
            btn.setButtonText(this.ctx.t("e2eeSetupStartButton"))
                .setCta()
                .setDisabled(true)
                .onClick(async () => {
                    const closeBtn = this.modalEl.querySelector(
                        ".modal-close-button",
                    ) as HTMLElement;
                    if (closeBtn) closeBtn.style.display = "none";
                    if (this.passwordInput) this.passwordInput.disabled = true;

                    // Prevent closing on outside click
                    (this as any).closeOnOutsideClick = false;
                    const bg = this.containerEl.querySelector(".modal-bg") as HTMLElement;
                    if (bg) bg.style.pointerEvents = "none";

                    mgContainer.show();
                    btn.setDisabled(true);
                    btn.setButtonText(this.ctx.t("e2eeSetupMigratingButton"));
                    this.startTime = Date.now();
                    this.lastLogTime = 0;

                    try {
                        const hashedPassword = await hashPassword(this.password);

                        this.ctx.setCurrentTrigger("migration");
                        await this.ctx.notify("noticeMigrationStarted");

                        const adapter =
                            await this.ctx.migrationService.startMigration(hashedPassword);

                        await this.ctx.migrationService.runMigration(
                            adapter,
                            (p: MigrationProgress) => {
                                const percent = Math.round((p.current / p.total) * 100);
                                this.progressBar.style.width = `${percent}%`;
                                this.statusText.setText(
                                    `${p.current} / ${p.total} (${percent}%)`,
                                );
                                this.fileText.setText(p.fileName);

                                const elapsedSec = (Date.now() - this.startTime) / 1000;
                                if (elapsedSec > 1 && p.current > 0) {
                                    const speed = p.current / elapsedSec;
                                    const remaining = p.total - p.current;
                                    const etaSec = Math.round(remaining / speed);

                                    const etaMin = Math.floor(etaSec / 60);
                                    const etaRemainSec = etaSec % 60;
                                    const etaStr =
                                        etaMin > 0 ? `${etaMin}m ${etaRemainSec}s` : `${etaSec}s`;

                                    const completionTime = new Date(
                                        Date.now() + etaSec * 1000,
                                    ).toLocaleTimeString([], {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                        second: "2-digit",
                                    });

                                    const statsMsg = `ETA: ${etaStr} (${completionTime})`;
                                    this.statsText.setText(statsMsg);

                                    const now = Date.now();
                                    if (now - this.lastLogTime > 10000) {
                                        this.ctx.log(
                                            `Migration: ${percent}% (${p.current}/${p.total}). ${statsMsg}`,
                                            "info",
                                        );
                                        this.lastLogTime = now;
                                    }
                                }
                            },
                        );

                        this.statusText.setText(this.ctx.t("e2eeSetupFinalizing"));
                        this.fileText.setText("");
                        this.statsText.setText(this.ctx.t("e2eeSetupSwapping"));

                        await this.ctx.migrationService.finalizeMigration(adapter);

                        // Save password to SecureStorage for auto-unlock
                        if (this.ctx.secureStorage) {
                            try {
                                await this.ctx.secureStorage.setExtraSecret(
                                    "e2ee-password",
                                    hashedPassword,
                                );
                                await this.ctx.log(
                                    "E2EE Password saved to SecureStorage.",
                                    "info",
                                );
                            } catch (err) {
                                console.error("Failed to save password to SecureStorage", err);
                                await this.ctx.notify("e2eeSetupKeychainFailed");
                            }
                        }

                        this.ctx.settings.e2eeEnabled = true;
                        await this.ctx.saveSettings();
                        await this.ctx.notify("noticeMigrationComplete");
                        this.close();
                        this.ctx.refreshSettingsUI?.();
                    } catch (e: unknown) {
                        const closeBtn = this.modalEl.querySelector(
                            ".modal-close-button",
                        ) as HTMLElement;
                        if (closeBtn) closeBtn.style.display = "";

                        (this as any).closeOnOutsideClick = true;
                        const bg = this.containerEl.querySelector(".modal-bg") as HTMLElement;
                        if (bg) bg.style.pointerEvents = "";

                        if (this.passwordInput) this.passwordInput.disabled = false;

                        await this.ctx.log(
                            `Migration failed: ${formatError(e)}`,
                            "error",
                        );
                        await this.ctx.notify("noticeMigrationFailed");
                        console.error(e);
                        btn.setDisabled(false);
                        btn.setButtonText(this.ctx.t("e2eeSetupStartButton"));
                        this.statusText.setText(this.ctx.t("e2eeSetupError"));
                        this.statsText.setText("");
                    }
                });
        });
    }

    private updateButtonState() {
        if (this.startBtn) {
            this.startBtn.setDisabled(this.password.length < 8);
        }
    }

    async checkInterrupted(contentEl: HTMLElement) {
        const { migrationService } = this.ctx;
        if (!migrationService) return;

        const interrupted = await migrationService.checkForInterruptedMigration();
        if (interrupted) {
            contentEl.empty();
            contentEl.createEl("h2", { text: this.ctx.t("e2eeInterruptedTitle") });

            const desc = contentEl.createEl("div", { cls: "vault-sync-warning" });
            setTextWithBreaks(desc, this.ctx.t("e2eeInterruptedDesc"));

            new Setting(contentEl)
                .setName(this.ctx.t("e2eeInterruptedCleanLabel"))
                .setDesc(this.ctx.t("e2eeInterruptedCleanDesc"))
                .addButton((btn) =>
                    btn
                        .setButtonText(this.ctx.t("e2eeInterruptedResetButton"))
                        .setCta()
                        .onClick(async () => {
                            btn.setDisabled(true);
                            btn.setButtonText(this.ctx.t("e2eeInterruptedCleaning"));
                            try {
                                await migrationService.cancelMigration();
                                await this.ctx.notify("e2eeInterruptedDone");
                                this.close();
                            } catch (e: unknown) {
                                await this.ctx.log(
                                    `[E2EE] Cleanup failed: ${formatError(e)}`, "error",
                                );
                                new Notice(formatError(e));
                            }
                        }),
                );
        }
    }
}

/**
 * Unlock Modal
 */
export class E2EEUnlockModal extends Modal {
    private password = "";
    private passwordInput?: HTMLInputElement;
    private autoUnlock = false;

    constructor(
        app: App,
        private ctx: E2EEPluginContext,
    ) {
        super(app);
        this.autoUnlock = !!this.ctx.settings?.e2eeAutoUnlock;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.ctx.t("e2eeUnlockTitle") });
        new Setting(contentEl)
            .setName(this.ctx.t("e2eeUnlockPasswordLabel"))
            .addText((text) => {
                this.passwordInput = text.inputEl;
                text.inputEl.type = "password";
                text.inputEl.setAttribute("autocomplete", "current-password");
                text.onChange((v) => (this.password = v));
            })
            .addExtraButton((btn) => {
                btn.setIcon("eye");
                btn.setTooltip("Show/Hide");
                btn.onClick(() => {
                    if (!this.passwordInput) return;
                    const isHidden = this.passwordInput.type === "password";
                    this.passwordInput.type = isHidden ? "text" : "password";
                    btn.setIcon(isHidden ? "eye-off" : "eye");
                });
            });
        new Setting(contentEl)
            .setName(this.ctx.t("e2eeUnlockAutoUnlock"))
            .addToggle((toggle) => {
                toggle.setValue(this.autoUnlock);
                toggle.onChange((v) => (this.autoUnlock = v));
            });
        new Setting(contentEl).addButton((btn) =>
            btn
                .setButtonText(this.ctx.t("e2eeUnlockButton"))
                .setCta()
                .onClick(async () => {
                    try {
                        const blob =
                            await this.ctx.vaultLockService.downloadLockFile();
                        const hashedPassword = await hashPassword(this.password);
                        await this.ctx.cryptoEngine.unlockVault(
                            blob,
                            hashedPassword,
                        );
                        await this.ctx.notify("e2eeUnlockSuccess");

                        // Sync auto-unlock setting (non-critical, don't block unlock)
                        try {
                            this.ctx.settings.e2eeAutoUnlock = this.autoUnlock;
                            await this.ctx.saveSettings();

                            if (this.autoUnlock && this.ctx.secureStorage) {
                                await this.ctx.secureStorage.setExtraSecret(
                                    "e2ee-password",
                                    hashedPassword,
                                );
                            } else if (!this.autoUnlock && this.ctx.secureStorage) {
                                await this.ctx.secureStorage.removeExtraSecret(
                                    "e2ee-password",
                                );
                            }
                        } catch (err) {
                            console.error("Failed to save auto-unlock preference", err);
                        }

                        this.close();
                        this.ctx.refreshSettingsUI?.();
                    } catch (e) {
                        await this.ctx.notify("e2eeUnlockFailed");
                        console.error(e);
                    }
                }),
        );
    }
}

/**
 * Password Change Modal
 */
export class E2EEPasswordChangeModal extends Modal {
    private newPassword = "";
    private confirmPassword = "";
    private passwordInput?: HTMLInputElement;
    private strengthIndicator?: HTMLDivElement;
    private changeBtn?: ButtonComponent;
    private showAsciiWarning?: (visible: boolean) => void;

    constructor(
        app: App,
        private ctx: E2EEPluginContext,
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.ctx.t("e2eeChangePasswordTitle") });

        const desc = contentEl.createEl("p");
        setTextWithBreaks(desc, this.ctx.t("e2eeChangePasswordDesc"));

        // New password input with show/hide toggle
        this.passwordInput = addPasswordInput({
            container: contentEl,
            t: (k) => this.ctx.t(k),
            label: this.ctx.t("e2eeChangePasswordNewLabel"),
            autocomplete: "new-password",
            onPasswordChange: (pw) => {
                this.newPassword = pw;
                this.updateButtonState();
                if (this.strengthIndicator) {
                    renderStrengthIndicator(
                        this.strengthIndicator, pw,
                        this.ctx.checkPasswordStrength, (k) => this.ctx.t(k),
                    );
                }
            },
            onAsciiViolation: (violated) => this.showAsciiWarning?.(violated),
        });

        // ASCII-only warning (hidden by default)
        this.showAsciiWarning = createAsciiWarning(contentEl, (k) => this.ctx.t(k));

        // Password strength indicator
        this.strengthIndicator = contentEl.createDiv({ cls: "vault-sync-password-strength" });

        // Confirm password
        new Setting(contentEl)
            .setName(this.ctx.t("e2eeChangePasswordConfirmLabel"))
            .addText((text) => {
                text.inputEl.type = "password";
                text.inputEl.setAttribute("autocomplete", "new-password");
                text.onChange((v) => {
                    this.confirmPassword = v;
                    this.updateButtonState();
                });
            });

        // Change Password button
        new Setting(contentEl).addButton((btn) => {
            this.changeBtn = btn;
            btn.setButtonText(this.ctx.t("e2eeChangePasswordButton"))
                .setCta()
                .setDisabled(true)
                .onClick(async () => {
                    btn.setDisabled(true);
                    btn.setButtonText("...");
                    try {
                        const hashedPassword = await hashPassword(this.newPassword);
                        const newBlob = await this.ctx.cryptoEngine.updatePassword(hashedPassword);

                        await this.ctx.vaultLockService.uploadLockFile(newBlob);

                        // Update saved auto-unlock password if enabled
                        if (this.ctx.settings.e2eeAutoUnlock && this.ctx.secureStorage) {
                            try {
                                await this.ctx.secureStorage.setExtraSecret(
                                    "e2ee-password", hashedPassword,
                                );
                            } catch (_) { /* non-critical */ }
                        }

                        await this.ctx.notify("noticeE2EEPasswordChanged");
                        this.close();
                    } catch (e: unknown) {
                        new Notice(`Error: ${formatError(e)}`);
                        btn.setDisabled(false);
                        btn.setButtonText(this.ctx.t("e2eeChangePasswordButton"));
                    }
                });
        });
    }

    private updateButtonState() {
        if (this.changeBtn) {
            const valid = this.newPassword.length >= 8
                && this.newPassword === this.confirmPassword;
            this.changeBtn.setDisabled(!valid);
        }
    }
}

/**
 * Recovery Code Export Modal
 */
export class E2EERecoveryExportModal extends Modal {
    constructor(
        app: App,
        private ctx: E2EEPluginContext,
    ) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.ctx.t("e2eeRecoveryExportTitle") });
        contentEl.createEl("p", { text: this.ctx.t("e2eeRecoveryExportDesc") });

        // Warning banner
        const warningEl = contentEl.createDiv({ cls: "vault-sync-recovery-warning" });
        warningEl.style.cssText = "background:var(--background-modifier-error);padding:8px 12px;border-radius:4px;margin-bottom:12px;";
        warningEl.setText(this.ctx.t("e2eeRecoveryWarning"));

        const engine = this.ctx.cryptoEngine;

        // Recovery code (read-only textarea)
        const code = await engine.exportRecoveryCode();
        const codeArea = contentEl.createEl("textarea");
        codeArea.value = code;
        codeArea.readOnly = true;
        codeArea.rows = 2;
        codeArea.style.cssText = "width:100%;font-family:monospace;font-size:14px;margin-bottom:8px;";

        // Key fingerprint
        const fp = await engine.getKeyFingerprint();
        contentEl.createEl("div", {
            text: `Key Fingerprint: ${fp}`,
            cls: "setting-item-description",
        });

        // Copy + Close buttons
        new Setting(contentEl)
            .addButton((btn) =>
                btn.setButtonText(this.ctx.t("e2eeRecoveryCopy")).onClick(() => {
                    navigator.clipboard.writeText(code);
                    btn.setButtonText(this.ctx.t("e2eeRecoveryCopied"));
                    setTimeout(() => btn.setButtonText(this.ctx.t("e2eeRecoveryCopy")), 2000);
                }),
            )
            .addButton((btn) =>
                btn.setButtonText(this.ctx.t("e2eeRecoveryClose")).onClick(() => this.close()),
            );
    }
}

/**
 * Recovery Code Import (Restore) Modal
 */
export class E2EERecoveryImportModal extends Modal {
    private recoveryCode = "";
    private newPassword = "";
    private confirmPassword = "";
    private passwordInput?: HTMLInputElement;
    private strengthIndicator?: HTMLDivElement;
    private restoreBtn?: ButtonComponent;
    private showAsciiWarning?: (visible: boolean) => void;

    constructor(
        app: App,
        private ctx: E2EEPluginContext,
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.ctx.t("e2eeRecoveryImportTitle") });
        contentEl.createEl("p", { text: this.ctx.t("e2eeRecoveryImportDesc") });

        // Recovery code input
        new Setting(contentEl)
            .setName(this.ctx.t("e2eeRecoveryCodeLabel"))
            .addTextArea((text: TextAreaComponent) => {
                text.inputEl.rows = 2;
                text.inputEl.style.cssText = "width:100%;font-family:monospace;";
                text.onChange((val: string) => {
                    this.recoveryCode = val.trim();
                    this.updateButtonState();
                });
            });

        // New password
        this.passwordInput = addPasswordInput({
            container: contentEl,
            t: (k) => this.ctx.t(k),
            label: this.ctx.t("e2eeChangePasswordNewLabel"),
            autocomplete: "new-password",
            onPasswordChange: (pw) => {
                this.newPassword = pw;
                this.updateButtonState();
                if (this.strengthIndicator) {
                    renderStrengthIndicator(
                        this.strengthIndicator, pw,
                        this.ctx.checkPasswordStrength, (k) => this.ctx.t(k),
                    );
                }
            },
            onAsciiViolation: (violated) => this.showAsciiWarning?.(violated),
        });

        // ASCII-only warning
        this.showAsciiWarning = createAsciiWarning(contentEl, (k) => this.ctx.t(k));

        // Password strength indicator
        this.strengthIndicator = contentEl.createDiv({ cls: "vault-sync-password-strength" });

        // Confirm password
        new Setting(contentEl)
            .setName(this.ctx.t("e2eeChangePasswordConfirmLabel"))
            .addText((text) => {
                text.inputEl.type = "password";
                text.inputEl.setAttribute("autocomplete", "new-password");
                text.onChange((v) => {
                    this.confirmPassword = v;
                    this.updateButtonState();
                });
            });

        // Restore button
        new Setting(contentEl).addButton((btn) => {
            this.restoreBtn = btn;
            btn.setButtonText(this.ctx.t("e2eeRecoveryRestoreButton"))
                .setCta()
                .setDisabled(true)
                .onClick(async () => {
                    btn.setDisabled(true);
                    btn.setButtonText("...");
                    try {
                        const newBlob = await this.ctx.cryptoEngine.recoverFromCode(
                            this.recoveryCode, this.newPassword,
                        );

                        await this.ctx.vaultLockService.uploadLockFile(newBlob);

                        // Save new password for auto-unlock
                        if (this.ctx.secureStorage) {
                            try {
                                const hashedPassword = await hashPassword(this.newPassword);
                                await this.ctx.secureStorage.setExtraSecret(
                                    "e2ee-password", hashedPassword,
                                );
                            } catch (_) { /* non-critical */ }
                        }

                        await this.ctx.notify("noticeE2EERecoveryComplete");
                        this.close();
                        this.ctx.refreshSettingsUI?.();
                    } catch (e: unknown) {
                        new Notice(`Recovery failed: ${formatError(e)}`);
                        btn.setDisabled(false);
                        btn.setButtonText(this.ctx.t("e2eeRecoveryRestoreButton"));
                    }
                });
        });
    }

    private updateButtonState() {
        if (this.restoreBtn) {
            // Pre-validate Base64 format: 32 bytes → 44 chars Base64 (with padding)
            const isValidBase64 = /^[A-Za-z0-9+/]+=*$/.test(this.recoveryCode)
                && this.recoveryCode.length >= 40
                && this.recoveryCode.length <= 48;
            const valid = isValidBase64
                && this.newPassword.length >= 8
                && this.newPassword === this.confirmPassword;
            this.restoreBtn.setDisabled(!valid);
        }
    }
}
