import { Modal, Setting, App, Notice, ButtonComponent, TextAreaComponent } from "obsidian";
import { hashPassword } from "../encryption/crypto-primitives";

const ASCII_PRINTABLE = /^[\x20-\x7E]*$/;

/** Set text content with \n → line breaks */
function setTextWithBreaks(el: HTMLElement, text: string): void {
    el.empty();
    const lines = text.split("\n");
    lines.forEach((line, i) => {
        if (i > 0) el.createEl("br");
        el.appendText(line);
    });
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
    private asciiWarning?: HTMLDivElement;

    constructor(
        app: App,
        private plugin: any,
    ) {
        super(app);
    }

    private t(key: string): string {
        return this.plugin.i18n?.(key) || key;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.t("e2eeSetupTitle") });

        const desc = contentEl.createEl("p");
        setTextWithBreaks(desc, this.t("e2eeSetupDesc"));

        // Check for active or interrupted migration
        const migrationService = this.plugin.syncManager.migrationService;

        if (migrationService && migrationService.isMigrating) {
            contentEl.createEl("div", {
                text: this.t("e2eeSetupMigratingBg"),
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
        new Setting(contentEl)
            .setName(this.t("e2eeSetupPasswordLabel"))
            .setDesc(this.t("e2eeSetupPasswordDesc"))
            .addText((text) => {
                this.passwordInput = text.inputEl;
                text.inputEl.type = "password";
                text.inputEl.setAttribute("autocomplete", "new-password");
                text.onChange((v) => {
                    // ASCII-only filter
                    if (!ASCII_PRINTABLE.test(v)) {
                        const filtered = v.replace(/[^\x20-\x7E]/g, "");
                        text.setValue(filtered);
                        this.password = filtered;
                        this.showAsciiWarning(true);
                    } else {
                        this.password = v;
                        this.showAsciiWarning(false);
                    }
                    this.updateButtonState();
                    this.updateStrengthIndicator(this.password);
                });
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

        // ASCII-only warning (hidden by default)
        this.asciiWarning = contentEl.createDiv({ cls: "vault-sync-ascii-warning" });
        this.asciiWarning.style.cssText = "color:var(--text-error);font-size:0.85em;display:none;margin-top:-8px;margin-bottom:8px;";
        this.asciiWarning.setText(this.t("e2eeSetupAsciiOnly"));

        // Allowed characters hint
        const hint = contentEl.createDiv();
        hint.style.cssText = "color:var(--text-muted);font-size:0.8em;margin-top:-8px;margin-bottom:8px;white-space:pre-line;";
        hint.setText(this.t("e2eeSetupPasswordHint"));

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
            btn.setButtonText(this.t("e2eeSetupStartButton"))
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
                    btn.setButtonText(this.t("e2eeSetupMigratingButton"));
                    this.startTime = Date.now();
                    this.lastLogTime = 0;

                    try {
                        const hashedPassword = await hashPassword(this.password);

                        (this.plugin.syncManager as any).currentTrigger = "migration";
                        await this.plugin.syncManager.notify("noticeMigrationStarted");

                        const adapter =
                            await this.plugin.syncManager.migrationService.startMigration(
                                hashedPassword,
                            );

                        await this.plugin.syncManager.migrationService.runMigration(
                            adapter,
                            (p: any) => {
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
                                        this.plugin.syncManager.log(
                                            `Migration: ${percent}% (${p.current}/${p.total}). ${statsMsg}`,
                                            "info",
                                        );
                                        this.lastLogTime = now;
                                    }
                                }
                            },
                        );

                        this.statusText.setText(this.t("e2eeSetupFinalizing"));
                        this.fileText.setText("");
                        this.statsText.setText(this.t("e2eeSetupSwapping"));

                        await this.plugin.syncManager.migrationService.finalizeMigration(adapter);

                        // Save password to SecureStorage for auto-unlock
                        if (this.plugin.syncManager.secureStorage) {
                            try {
                                await this.plugin.syncManager.secureStorage.setExtraSecret(
                                    "e2ee-password",
                                    hashedPassword,
                                );
                                await this.plugin.syncManager.log(
                                    "E2EE Password saved to SecureStorage.",
                                    "info",
                                );
                            } catch (err) {
                                console.error("Failed to save password to SecureStorage", err);
                                await this.plugin.syncManager.notify("e2eeSetupKeychainFailed");
                            }
                        }

                        this.plugin.settings.e2eeEnabled = true;
                        await this.plugin.saveSettings();
                        await this.plugin.syncManager.notify("noticeMigrationComplete");
                        this.close();
                        this.plugin.refreshSettingsUI();
                    } catch (e) {
                        const closeBtn = this.modalEl.querySelector(
                            ".modal-close-button",
                        ) as HTMLElement;
                        if (closeBtn) closeBtn.style.display = "";

                        (this as any).closeOnOutsideClick = true;
                        const bg = this.containerEl.querySelector(".modal-bg") as HTMLElement;
                        if (bg) bg.style.pointerEvents = "";

                        if (this.passwordInput) this.passwordInput.disabled = false;

                        await this.plugin.syncManager.log(
                            `Migration failed: ${(e as any).message || e}`,
                            "error",
                        );
                        await this.plugin.syncManager.notify("noticeMigrationFailed");
                        console.error(e);
                        btn.setDisabled(false);
                        btn.setButtonText(this.t("e2eeSetupStartButton"));
                        this.statusText.setText(this.t("e2eeSetupError"));
                        this.statsText.setText("");
                    }
                });
        });
    }

    private showAsciiWarning(show: boolean) {
        if (this.asciiWarning) {
            this.asciiWarning.style.display = show ? "" : "none";
        }
    }

    private updateButtonState() {
        if (this.startBtn) {
            this.startBtn.setDisabled(this.password.length < 8);
        }
    }

    private updateStrengthIndicator(password: string) {
        if (!this.strengthIndicator) return;
        this.strengthIndicator.empty();

        const checker = this.plugin.checkPasswordStrength;
        if (!checker || !password) return;

        const result = checker(password);

        // Strength bar
        const barContainer = this.strengthIndicator.createDiv({ cls: "vault-sync-strength-bar-container" });
        barContainer.style.cssText = "display:flex;gap:4px;margin-bottom:4px;";

        const colors: Record<string, string> = {
            weak: "var(--text-error)",
            fair: "var(--text-warning)",
            good: "var(--text-success)",
            strong: "var(--interactive-accent)",
        };
        const segmentCount: Record<string, number> = { weak: 1, fair: 2, good: 3, strong: 4 };
        const filled = segmentCount[result.strength] || 0;
        const color = colors[result.strength] || "var(--text-muted)";

        for (let i = 0; i < 4; i++) {
            const seg = barContainer.createDiv();
            seg.style.cssText = `height:4px;flex:1;border-radius:2px;background:${i < filled ? color : "var(--background-modifier-border)"};`;
        }

        // Strength label
        const strengthKey = `passwordStrength${result.strength.charAt(0).toUpperCase() + result.strength.slice(1)}`;
        const label = this.t(strengthKey);
        const labelEl = this.strengthIndicator.createDiv();
        labelEl.style.cssText = `font-size:0.85em;color:${color};`;
        labelEl.setText(label);

        // Feedback messages
        if (result.feedback.length > 0) {
            const feedbackEl = this.strengthIndicator.createDiv();
            feedbackEl.style.cssText = "font-size:0.8em;color:var(--text-muted);margin-top:2px;";
            const messages = result.feedback.map((key: string) => this.t(key));
            feedbackEl.setText(messages.join(". "));
        }
    }

    async checkInterrupted(contentEl: HTMLElement) {
        const migrationService = this.plugin.syncManager.migrationService;
        if (!migrationService) return;

        const interrupted = await migrationService.checkForInterruptedMigration();
        if (interrupted) {
            contentEl.empty();
            contentEl.createEl("h2", { text: this.t("e2eeInterruptedTitle") });

            const desc = contentEl.createEl("div", { cls: "vault-sync-warning" });
            setTextWithBreaks(desc, this.t("e2eeInterruptedDesc"));

            new Setting(contentEl)
                .setName(this.t("e2eeInterruptedCleanLabel"))
                .setDesc(this.t("e2eeInterruptedCleanDesc"))
                .addButton((btn) =>
                    btn
                        .setButtonText(this.t("e2eeInterruptedResetButton"))
                        .setCta()
                        .onClick(async () => {
                            btn.setDisabled(true);
                            btn.setButtonText(this.t("e2eeInterruptedCleaning"));
                            try {
                                await migrationService.cancelMigration();
                                await this.plugin.syncManager.notify("e2eeInterruptedDone");
                                this.close();
                            } catch (e: any) {
                                await this.plugin.syncManager.log(
                                    `[E2EE] Cleanup failed: ${e.message || e}`, "error",
                                );
                                new Notice(`${e.message || e}`);
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
        private plugin: any,
    ) {
        super(app);
        this.autoUnlock = !!this.plugin.settings?.e2eeAutoUnlock;
    }

    private t(key: string): string {
        return this.plugin.i18n?.(key) || key;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.t("e2eeUnlockTitle") });
        new Setting(contentEl)
            .setName(this.t("e2eeUnlockPasswordLabel"))
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
            .setName(this.t("e2eeUnlockAutoUnlock"))
            .addToggle((toggle) => {
                toggle.setValue(this.autoUnlock);
                toggle.onChange((v) => (this.autoUnlock = v));
            });
        new Setting(contentEl).addButton((btn) =>
            btn
                .setButtonText(this.t("e2eeUnlockButton"))
                .setCta()
                .onClick(async () => {
                    try {
                        const blob =
                            await this.plugin.syncManager.vaultLockService.downloadLockFile();
                        const hashedPassword = await hashPassword(this.password);
                        await this.plugin.syncManager.cryptoEngine.unlockVault(
                            blob,
                            hashedPassword,
                        );
                        await this.plugin.syncManager.notify("e2eeUnlockSuccess");

                        // Sync auto-unlock setting (non-critical, don't block unlock)
                        try {
                            this.plugin.settings.e2eeAutoUnlock = this.autoUnlock;
                            await this.plugin.saveSettings();

                            if (this.autoUnlock && this.plugin.syncManager.secureStorage) {
                                await this.plugin.syncManager.secureStorage.setExtraSecret(
                                    "e2ee-password",
                                    hashedPassword,
                                );
                            } else if (!this.autoUnlock && this.plugin.syncManager.secureStorage) {
                                await this.plugin.syncManager.secureStorage.deleteExtraSecret(
                                    "e2ee-password",
                                );
                            }
                        } catch (err) {
                            console.error("Failed to save auto-unlock preference", err);
                        }

                        this.close();
                        this.plugin.refreshSettingsUI?.();
                    } catch (e) {
                        await this.plugin.syncManager.notify("e2eeUnlockFailed");
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
    private confirmInput?: HTMLInputElement;
    private strengthIndicator?: HTMLDivElement;
    private changeBtn?: ButtonComponent;
    private asciiWarning?: HTMLDivElement;

    constructor(
        app: App,
        private plugin: any,
    ) {
        super(app);
    }

    private t(key: string): string {
        return this.plugin.i18n?.(key) || key;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.t("e2eeChangePasswordTitle") });

        const desc = contentEl.createEl("p");
        setTextWithBreaks(desc, this.t("e2eeChangePasswordDesc"));

        // New password input with show/hide toggle
        new Setting(contentEl)
            .setName(this.t("e2eeChangePasswordNewLabel"))
            .addText((text) => {
                this.passwordInput = text.inputEl;
                text.inputEl.type = "password";
                text.inputEl.setAttribute("autocomplete", "new-password");
                text.onChange((v) => {
                    if (!ASCII_PRINTABLE.test(v)) {
                        const filtered = v.replace(/[^\x20-\x7E]/g, "");
                        text.setValue(filtered);
                        this.newPassword = filtered;
                        this.showAsciiWarning(true);
                    } else {
                        this.newPassword = v;
                        this.showAsciiWarning(false);
                    }
                    this.updateButtonState();
                    this.updateStrengthIndicator(this.newPassword);
                });
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

        // ASCII-only warning (hidden by default)
        this.asciiWarning = contentEl.createDiv({ cls: "vault-sync-ascii-warning" });
        this.asciiWarning.style.cssText = "color:var(--text-error);font-size:0.85em;display:none;margin-top:-8px;margin-bottom:8px;";
        this.asciiWarning.setText(this.t("e2eeSetupAsciiOnly"));

        // Password strength indicator
        this.strengthIndicator = contentEl.createDiv({ cls: "vault-sync-password-strength" });

        // Confirm password
        new Setting(contentEl)
            .setName(this.t("e2eeChangePasswordConfirmLabel"))
            .addText((text) => {
                this.confirmInput = text.inputEl;
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
            btn.setButtonText(this.t("e2eeChangePasswordButton"))
                .setCta()
                .setDisabled(true)
                .onClick(async () => {
                    btn.setDisabled(true);
                    btn.setButtonText("...");
                    try {
                        const engine = this.plugin.syncManager.cryptoEngine;
                        const hashedPassword = await hashPassword(this.newPassword);
                        const newBlob = await engine.updatePassword(hashedPassword);

                        await this.plugin.syncManager.vaultLockService.uploadLockFile(newBlob);

                        // Update saved auto-unlock password if enabled
                        if (this.plugin.settings.e2eeAutoUnlock && this.plugin.syncManager.secureStorage) {
                            try {
                                await this.plugin.syncManager.secureStorage.setExtraSecret(
                                    "e2ee-password", hashedPassword,
                                );
                            } catch (_) { /* non-critical */ }
                        }

                        await this.plugin.syncManager.notify("noticeE2EEPasswordChanged");
                        this.close();
                    } catch (e: any) {
                        new Notice(`Error: ${e.message || e}`);
                        btn.setDisabled(false);
                        btn.setButtonText(this.t("e2eeChangePasswordButton"));
                    }
                });
        });
    }

    private showAsciiWarning(show: boolean) {
        if (this.asciiWarning) {
            this.asciiWarning.style.display = show ? "" : "none";
        }
    }

    private updateButtonState() {
        if (this.changeBtn) {
            const valid = this.newPassword.length >= 8
                && this.newPassword === this.confirmPassword;
            this.changeBtn.setDisabled(!valid);
        }
    }

    private updateStrengthIndicator(password: string) {
        if (!this.strengthIndicator) return;
        this.strengthIndicator.empty();

        const checker = this.plugin.checkPasswordStrength;
        if (!checker || !password) return;

        const result = checker(password);

        const barContainer = this.strengthIndicator.createDiv({ cls: "vault-sync-strength-bar-container" });
        barContainer.style.cssText = "display:flex;gap:4px;margin-bottom:4px;";

        const colors: Record<string, string> = {
            weak: "var(--text-error)", fair: "var(--text-warning)",
            good: "var(--text-success)", strong: "var(--interactive-accent)",
        };
        const segmentCount: Record<string, number> = { weak: 1, fair: 2, good: 3, strong: 4 };
        const filled = segmentCount[result.strength] || 0;
        const color = colors[result.strength] || "var(--text-muted)";

        for (let i = 0; i < 4; i++) {
            const seg = barContainer.createDiv();
            seg.style.cssText = `height:4px;flex:1;border-radius:2px;background:${i < filled ? color : "var(--background-modifier-border)"};`;
        }

        const strengthKey = `passwordStrength${result.strength.charAt(0).toUpperCase() + result.strength.slice(1)}`;
        const label = this.t(strengthKey);
        const labelEl = this.strengthIndicator.createDiv();
        labelEl.style.cssText = `font-size:0.85em;color:${color};`;
        labelEl.setText(label);

        if (result.feedback.length > 0) {
            const feedbackEl = this.strengthIndicator.createDiv();
            feedbackEl.style.cssText = "font-size:0.8em;color:var(--text-muted);margin-top:2px;";
            feedbackEl.setText(result.feedback.map((key: string) => this.t(key)).join(". "));
        }
    }
}

/**
 * Recovery Code Export Modal
 */
export class E2EERecoveryExportModal extends Modal {
    constructor(
        app: App,
        private plugin: any,
    ) {
        super(app);
    }

    private t(key: string): string {
        return this.plugin.i18n?.(key) || key;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.t("e2eeRecoveryExportTitle") });
        contentEl.createEl("p", { text: this.t("e2eeRecoveryExportDesc") });

        // Warning banner
        const warningEl = contentEl.createDiv({ cls: "vault-sync-recovery-warning" });
        warningEl.style.cssText = "background:var(--background-modifier-error);padding:8px 12px;border-radius:4px;margin-bottom:12px;";
        warningEl.setText(this.t("e2eeRecoveryWarning"));

        const engine = this.plugin.syncManager.cryptoEngine;

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
                btn.setButtonText(this.t("e2eeRecoveryCopy")).onClick(() => {
                    navigator.clipboard.writeText(code);
                    btn.setButtonText(this.t("e2eeRecoveryCopied"));
                    setTimeout(() => btn.setButtonText(this.t("e2eeRecoveryCopy")), 2000);
                }),
            )
            .addButton((btn) =>
                btn.setButtonText(this.t("e2eeRecoveryClose")).onClick(() => this.close()),
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
    private asciiWarning?: HTMLDivElement;

    constructor(
        app: App,
        private plugin: any,
    ) {
        super(app);
    }

    private t(key: string): string {
        return this.plugin.i18n?.(key) || key;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.t("e2eeRecoveryImportTitle") });
        contentEl.createEl("p", { text: this.t("e2eeRecoveryImportDesc") });

        // Recovery code input
        new Setting(contentEl)
            .setName(this.t("e2eeRecoveryCodeLabel"))
            .addTextArea((text: TextAreaComponent) => {
                text.inputEl.rows = 2;
                text.inputEl.style.cssText = "width:100%;font-family:monospace;";
                text.onChange((val: string) => {
                    this.recoveryCode = val.trim();
                    this.updateButtonState();
                });
            });

        // New password
        new Setting(contentEl)
            .setName(this.t("e2eeChangePasswordNewLabel"))
            .addText((text) => {
                this.passwordInput = text.inputEl;
                text.inputEl.type = "password";
                text.inputEl.setAttribute("autocomplete", "new-password");
                text.onChange((v) => {
                    if (!ASCII_PRINTABLE.test(v)) {
                        const filtered = v.replace(/[^\x20-\x7E]/g, "");
                        text.setValue(filtered);
                        this.newPassword = filtered;
                        this.showAsciiWarning(true);
                    } else {
                        this.newPassword = v;
                        this.showAsciiWarning(false);
                    }
                    this.updateButtonState();
                    this.updateStrengthIndicator(this.newPassword);
                });
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

        // ASCII-only warning
        this.asciiWarning = contentEl.createDiv({ cls: "vault-sync-ascii-warning" });
        this.asciiWarning.style.cssText = "color:var(--text-error);font-size:0.85em;display:none;margin-top:-8px;margin-bottom:8px;";
        this.asciiWarning.setText(this.t("e2eeSetupAsciiOnly"));

        // Password strength indicator
        this.strengthIndicator = contentEl.createDiv({ cls: "vault-sync-password-strength" });

        // Confirm password
        new Setting(contentEl)
            .setName(this.t("e2eeChangePasswordConfirmLabel"))
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
            btn.setButtonText(this.t("e2eeRecoveryRestoreButton"))
                .setCta()
                .setDisabled(true)
                .onClick(async () => {
                    btn.setDisabled(true);
                    btn.setButtonText("...");
                    try {
                        const engine = this.plugin.syncManager.cryptoEngine;
                        const newBlob = await engine.recoverFromCode(
                            this.recoveryCode, this.newPassword,
                        );

                        await this.plugin.syncManager.vaultLockService.uploadLockFile(newBlob);

                        // Save new password for auto-unlock
                        if (this.plugin.syncManager.secureStorage) {
                            try {
                                const hashedPassword = await hashPassword(this.newPassword);
                                await this.plugin.syncManager.secureStorage.setExtraSecret(
                                    "e2ee-password", hashedPassword,
                                );
                            } catch (_) { /* non-critical */ }
                        }

                        await this.plugin.syncManager.notify("noticeE2EERecoveryComplete");
                        this.close();
                        this.plugin.refreshSettingsUI?.();
                    } catch (e: any) {
                        new Notice(`Recovery failed: ${e.message || e}`);
                        btn.setDisabled(false);
                        btn.setButtonText(this.t("e2eeRecoveryRestoreButton"));
                    }
                });
        });
    }

    private showAsciiWarning(show: boolean) {
        if (this.asciiWarning) {
            this.asciiWarning.style.display = show ? "" : "none";
        }
    }

    private updateButtonState() {
        if (this.restoreBtn) {
            const valid = this.recoveryCode.length > 0
                && this.newPassword.length >= 8
                && this.newPassword === this.confirmPassword;
            this.restoreBtn.setDisabled(!valid);
        }
    }

    private updateStrengthIndicator(password: string) {
        if (!this.strengthIndicator) return;
        this.strengthIndicator.empty();

        const checker = this.plugin.checkPasswordStrength;
        if (!checker || !password) return;

        const result = checker(password);

        const barContainer = this.strengthIndicator.createDiv({ cls: "vault-sync-strength-bar-container" });
        barContainer.style.cssText = "display:flex;gap:4px;margin-bottom:4px;";

        const colors: Record<string, string> = {
            weak: "var(--text-error)", fair: "var(--text-warning)",
            good: "var(--text-success)", strong: "var(--interactive-accent)",
        };
        const segmentCount: Record<string, number> = { weak: 1, fair: 2, good: 3, strong: 4 };
        const filled = segmentCount[result.strength] || 0;
        const color = colors[result.strength] || "var(--text-muted)";

        for (let i = 0; i < 4; i++) {
            const seg = barContainer.createDiv();
            seg.style.cssText = `height:4px;flex:1;border-radius:2px;background:${i < filled ? color : "var(--background-modifier-border)"};`;
        }

        const strengthKey = `passwordStrength${result.strength.charAt(0).toUpperCase() + result.strength.slice(1)}`;
        const label = this.t(strengthKey);
        const labelEl = this.strengthIndicator.createDiv();
        labelEl.style.cssText = `font-size:0.85em;color:${color};`;
        labelEl.setText(label);

        if (result.feedback.length > 0) {
            const feedbackEl = this.strengthIndicator.createDiv();
            feedbackEl.style.cssText = "font-size:0.8em;color:var(--text-muted);margin-top:2px;";
            feedbackEl.setText(result.feedback.map((key: string) => this.t(key)).join(". "));
        }
    }
}
