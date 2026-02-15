import { Modal, Setting, App, Notice } from "obsidian";
import { hashPassword } from "../encryption/crypto-primitives";

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

    constructor(
        app: App,
        private plugin: any,
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "E2EE Setup" });
        contentEl.createEl("p", {
            text: "Welcome to VaultSync E2EE. \nThis wizard will migrate your vault to an encrypted format.",
        });

        // Check for active or interrupted migration
        const migrationService = this.plugin.syncManager.migrationService;

        if (migrationService && migrationService.isMigrating) {
            contentEl.createEl("div", {
                text: "Migration is currently running in the background.",
                cls: "vault-sync-warning",
            });
            // Could attach progress listener here if architecture allows, but simple message helps.
            const p = migrationService.currentProgress;
            if (p) {
                contentEl.createEl("div", { text: `Progress: ${p.current} / ${p.total} files` });
            }
            return;
        }

        // Check for interrupted
        this.checkInterrupted(contentEl);

        new Setting(contentEl)
            .setName("Encryption Password")
            .setDesc("Used to derive your Master Key. Don't lose it!")
            .addText((t) => {
                this.passwordInput = t.inputEl;
                t.inputEl.type = "password";
                t.onChange((v) => {
                    this.password = v;
                    this.updateStrengthIndicator(v);
                });
            });

        // Password strength indicator (rendered below the password field)
        this.strengthIndicator = contentEl.createDiv({ cls: "vault-sync-password-strength" });

        // Progress UI (initially empty)
        const mgContainer = contentEl.createDiv({ cls: "vault-sync-migration-container" });
        const barWrapper = mgContainer.createDiv({ cls: "vault-sync-progress-wrapper" });
        this.progressBar = barWrapper.createDiv({ cls: "vault-sync-progress-bar" });
        this.statusText = mgContainer.createDiv({ cls: "vault-sync-migration-status" });
        this.fileText = mgContainer.createDiv({ cls: "vault-sync-migration-file" });
        this.statsText = mgContainer.createDiv({ cls: "vault-sync-migration-status" });

        mgContainer.hide();

        new Setting(contentEl).addButton((btn) =>
            btn
                .setButtonText("Start Migration")
                .setCta()
                .onClick(async () => {
                    if (!this.password || this.password.length < 8) {
                        new Notice("Password must be at least 8 characters.");
                        return;
                    }

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
                    btn.setButtonText("Migrating...");
                    this.startTime = Date.now();
                    this.lastLogTime = 0; // Reset log throttle

                    try {
                        // SEC: Hash the password before use
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
                                    `Migrating: ${p.current} / ${p.total} files (${percent}%)`,
                                );
                                this.fileText.setText(p.fileName);

                                // Stats calculation
                                const elapsedSec = (Date.now() - this.startTime) / 1000;
                                if (elapsedSec > 1 && p.current > 0) {
                                    const speed = p.current / elapsedSec; // files/sec
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

                                    const statsMsg = `ETA: ${etaStr} (Estimated Completion: ${completionTime})`;
                                    this.statsText.setText(statsMsg);

                                    // Periodic Logging (every 10 seconds or so)
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

                        this.statusText.setText("Finalizing migration...");
                        this.fileText.setText("");
                        this.statsText.setText("Performing folder swap on remote...");

                        await this.plugin.syncManager.migrationService.finalizeMigration(adapter);

                        // CRITICAL: Save password to SecureStorage for auto-unlock
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
                                new Notice(
                                    "Warning: Failed to save password to keychain. You will need to re-enter it next time.",
                                );
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

                        // Restore closing capability
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
                        btn.setButtonText("Start Migration");
                        this.statusText.setText("Error occurred. Check logs.");
                        this.statsText.setText("");
                    }
                }),
        );
    }

    private updateStrengthIndicator(password: string) {
        if (!this.strengthIndicator) return;
        this.strengthIndicator.empty();

        const checker = this.plugin.checkPasswordStrength;
        if (!checker || !password) return;

        const result = checker(password);
        const t = this.plugin.i18n;

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
        const label = t ? t(strengthKey) : result.strength;
        const labelEl = this.strengthIndicator.createDiv();
        labelEl.style.cssText = `font-size:0.85em;color:${color};`;
        labelEl.setText(label);

        // Feedback messages
        if (result.feedback.length > 0) {
            const feedbackEl = this.strengthIndicator.createDiv();
            feedbackEl.style.cssText = "font-size:0.8em;color:var(--text-muted);margin-top:2px;";
            const messages = result.feedback.map((key: string) => t ? t(key) : key);
            feedbackEl.setText(messages.join(". "));
        }
    }

    async checkInterrupted(contentEl: HTMLElement) {
        const migrationService = this.plugin.syncManager.migrationService;
        if (!migrationService) return;

        const interrupted = await migrationService.checkForInterruptedMigration();
        if (interrupted) {
            contentEl.empty();
            contentEl.createEl("h2", { text: "Interrupted Migration Found" });
            contentEl.createEl("div", {
                text: "A previous migration attempt was interrupted. A temporary encrypted folder exists on the remote.",
                cls: "vault-sync-warning",
            });

            new Setting(contentEl)
                .setName("Clean Up & Restart")
                .setDesc("Delete the temporary folder and start over.")
                .addButton((btn) =>
                    btn
                        .setButtonText("Reset & Restart")
                        .setCta()
                        .onClick(async () => {
                            btn.setDisabled(true);
                            btn.setButtonText("Cleaning up...");
                            try {
                                await migrationService.cancelMigration();
                                new Notice("Cleanup complete. Please reopen this modal.");
                                this.close();
                            } catch (e: any) {
                                new Notice(`Cleanup failed: ${e.message || e}`);
                                console.error(e);
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
    constructor(
        app: App,
        private plugin: any,
    ) {
        super(app);
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Unlock Vault" });
        new Setting(contentEl)
            .setName("Password")
            .addText((t) => (t.onChange((v) => (this.password = v)).inputEl.type = "password"));
        new Setting(contentEl).addButton((btn) =>
            btn
                .setButtonText("Unlock")
                .setCta()
                .onClick(async () => {
                    try {
                        const lockData =
                            await this.plugin.syncManager.vaultLockService.downloadLockFile();
                        const hashedPassword = await hashPassword(this.password);
                        await this.plugin.syncManager.cryptoEngine.unlockVault(
                            lockData,
                            hashedPassword,
                        );
                        new Notice("Unlocked!");
                        // Save hash for future auto-unlocks in this session context (if needed)
                        if (this.plugin.syncManager.secureStorage) {
                            await this.plugin.syncManager.secureStorage.setExtraSecret(
                                "e2ee-password",
                                hashedPassword,
                            );
                        }
                        this.close();
                    } catch (e) {
                        // Fallback: Try with raw password (migration scenario)
                        try {
                            const lockData =
                                await this.plugin.syncManager.vaultLockService.downloadLockFile();
                            await this.plugin.syncManager.cryptoEngine.unlockVault(
                                lockData,
                                this.password,
                            );
                            new Notice("Unlocked! (Migrating security...)");

                            // MIGRATION: Re-wrap with Hashed password
                            const hashedPassword = await hashPassword(this.password);
                            const newLockData =
                                await this.plugin.syncManager.cryptoEngine.updatePassword(
                                    hashedPassword,
                                );
                            await this.plugin.syncManager.vaultLockService.uploadLockFileToAdapter(
                                this.plugin.syncManager.adapter,
                                newLockData,
                            );

                            if (this.plugin.syncManager.secureStorage) {
                                await this.plugin.syncManager.secureStorage.setExtraSecret(
                                    "e2ee-password",
                                    hashedPassword,
                                );
                            }
                            new Notice("Security migration complete.");
                            this.close();
                        } catch (err2) {
                            new Notice("Invalid password.");
                            console.error(e, err2);
                        }
                    }
                }),
        );
    }
}
