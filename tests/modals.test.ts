// @vitest-environment jsdom
/**
 * @file The engine's dialogs (setup, unlock, password change, recovery)
 *
 * The dialogs run on a jsdom document with a stand-in for Obsidian's UI API
 * (tests/helpers/obsidian-dom.ts); the plugin side (crypto engine, lock file,
 * migration, keychain) is recorded. Text comes from the English strings.
 *
 * @pass_criteria
 * - setup: start stays off until the password meets the policy; non-ASCII
 *   characters are dropped with a warning; a run hands the HASHED password to the
 *   migration, turns encryption on, removes a stale saved password and closes;
 *   a failed run leaves encryption off and lets the user try again
 * - setup after an interrupted migration offers the clean-up, which runs it
 * - unlock: a wrong password keeps the dialog open; a right one unlocks with the
 *   hashed password, saves it only with auto-unlock on, upgrades a v1 lock file
 * - password change: needs the policy and a matching confirmation; uploads the
 *   new lock file and replaces a saved password
 * - recovery: the code must look like a recovery code; restoring uploads the new
 *   lock file; export shows the code and fingerprint and copies the code
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { webcrypto } from "node:crypto";

vi.mock("obsidian", async () => {
    const m = await import("./helpers/obsidian-dom");
    return { ...m, default: m };
});

import { App, Notice, press, toggle, type } from "./helpers/obsidian-dom";
import {
    E2EEPasswordChangeModal,
    E2EERecoveryExportModal,
    E2EERecoveryImportModal,
    E2EESetupModal,
    E2EEUnlockModal,
} from "../src/ui/modals";
import { hashPassword } from "../src/encryption/crypto-primitives";
import { STRINGS } from "../src/i18n";
import type { E2EEPluginContext } from "../src/interfaces";

if (!window.crypto?.subtle) Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });

const GOOD = "correct horse battery staple";
const t = (k: string) => STRINGS.en[k] ?? `MISSING:${k}`;
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeCtx(over: { autoUnlock?: boolean; interrupted?: boolean } = {}) {
    const calls: string[] = [];
    const notices: string[] = [];
    const secrets = new Map<string, string>([["e2ee-password", "stale"]]);
    let unlockWith = "";
    const ctx = {
        app: new App(),
        t,
        settings: { e2eeEnabled: false, e2eeAutoUnlock: !!over.autoUnlock },
        saveSettings: vi.fn(async () => {}),
        refreshSettingsUI: vi.fn(),
        cryptoEngine: {
            unlockVault: vi.fn(async (_blob: string, pw: string) => {
                if (pw !== unlockWith) throw new Error("wrong password");
            }),
            needsLockMigration: vi.fn(() => false),
            updatePassword: vi.fn(async (pw: string) => `lock-for:${pw}`),
            recoverFromCode: vi.fn(async (code: string, pw: string) => `recovered:${code}:${pw}`),
            verifyPassword: vi.fn(async (_blob: string, pw: string) => pw === unlockWith),
            exportRecoveryCode: vi.fn(async () => "A".repeat(43) + "="),
            getKeyFingerprint: vi.fn(async () => "ab:cd:ef"),
        },
        vaultLockService: {
            downloadLockFile: vi.fn(async () => "lock-blob"),
            uploadLockFile: vi.fn(async (_b: string) => {}),
        },
        secureStorage: {
            setExtraSecret: vi.fn(async (k: string, v: string) => void secrets.set(k, v)),
            removeExtraSecret: vi.fn(async (k: string) => void secrets.delete(k)),
        },
        migrationService: {
            isMigrating: false,
            currentProgress: null,
            startMigration: vi.fn(async (_pw: string) => "temp-adapter"),
            runMigration: vi.fn(async (_a: unknown, onProgress: (p: unknown) => void) => {
                onProgress({ current: 1, total: 2, fileName: "a.md" });
                onProgress({ current: 2, total: 2, fileName: "b.md" });
            }),
            finalizeMigration: vi.fn(async () => {}),
            checkForInterruptedMigration: vi.fn(async () => !!over.interrupted),
            cancelMigration: vi.fn(async () => {}),
        },
        notify: vi.fn(async (k: string) => void notices.push(k)),
        log: vi.fn(async () => {}),
        setCurrentTrigger: vi.fn((tr: string) => void calls.push(`trigger:${tr}`)),
    };
    return {
        ctx: ctx as unknown as E2EEPluginContext,
        raw: ctx,
        notices,
        secrets,
        acceptPassword: async (pw: string) => (unlockWith = await hashPassword(pw)),
    };
}

/** The dialog's parts, found the way a user finds them */
function parts(modal: { contentEl: HTMLElement }) {
    const el = modal.contentEl;
    const button = (key: string) =>
        [...el.querySelectorAll("button")].find((b) => b.textContent === t(key)) as HTMLButtonElement;
    const passwords = () => [...el.querySelectorAll("input")].filter((i) => i.type === "password");
    return { el, button, passwords };
}

beforeEach(() => {
    document.body.replaceChildren();
    Notice.shown = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("setup dialog", () => {
    it("starts only with a password that meets the policy", async () => {
        const { ctx } = makeCtx();
        const m = new E2EESetupModal(ctx.app, ctx);
        m.open();
        await flush();
        const { button, passwords } = parts(m);
        const start = button("e2eeSetupStartButton");

        expect(start.disabled).toBe(true);
        await type(passwords()[0], "short");
        expect(start.disabled).toBe(true);
        await type(passwords()[0], GOOD);
        expect(start.disabled).toBe(false);
    });

    it("drops characters outside printable ASCII and says so", async () => {
        const { ctx } = makeCtx();
        const m = new E2EESetupModal(ctx.app, ctx);
        m.open();
        await flush();
        const input = parts(m).passwords()[0];
        const warning = m.contentEl.querySelector(".vault-syncer-ascii-warning") as HTMLElement;

        await type(input, "pässwörd-long-enough");
        expect(input.value).toBe("psswrd-long-enough");
        expect(warning.style.display).toBe("");
        await type(input, GOOD);
        expect(warning.style.display).toBe("none");
    });

    it("migrates with the hashed password, turns encryption on and closes", async () => {
        const { ctx, raw, notices, secrets } = makeCtx();
        const m = new E2EESetupModal(ctx.app, ctx);
        m.open();
        await flush();
        const { button, passwords } = parts(m);
        await type(passwords()[0], GOOD);
        await press(button("e2eeSetupStartButton"));

        const hashed = await hashPassword(GOOD);
        expect(raw.migrationService.startMigration).toHaveBeenCalledWith(hashed);
        expect(raw.migrationService.startMigration).not.toHaveBeenCalledWith(GOOD);
        expect(raw.migrationService.finalizeMigration).toHaveBeenCalledWith("temp-adapter");
        expect(raw.settings.e2eeEnabled).toBe(true);
        expect(raw.saveSettings).toHaveBeenCalled();
        // Auto-unlock is off: a password saved for an earlier vault must not stay
        expect(secrets.has("e2ee-password")).toBe(false);
        expect(notices).toEqual(["noticeMigrationStarted", "noticeMigrationComplete"]);
        expect(m.isOpen).toBe(false);
        expect(raw.refreshSettingsUI).toHaveBeenCalled();
    });

    it("leaves encryption off after a failed run and lets the user try again", async () => {
        const { ctx, raw, notices } = makeCtx();
        raw.migrationService.runMigration.mockRejectedValueOnce(new Error("network down"));
        const m = new E2EESetupModal(ctx.app, ctx);
        m.open();
        await flush();
        const { button, passwords } = parts(m);
        await type(passwords()[0], GOOD);
        await press(button("e2eeSetupStartButton"));

        expect(raw.settings.e2eeEnabled).toBe(false);
        expect(raw.migrationService.finalizeMigration).not.toHaveBeenCalled();
        expect(notices).toContain("noticeMigrationFailed");
        expect(m.isOpen).toBe(true);
        expect(button("e2eeSetupStartButton").disabled).toBe(false);
        expect(passwords()[0].disabled).toBe(false);
        expect(m.contentEl.textContent).toContain(t("e2eeSetupError"));
    });

    it("offers to clean up an interrupted migration", async () => {
        const { ctx, raw, notices } = makeCtx({ interrupted: true });
        const m = new E2EESetupModal(ctx.app, ctx);
        m.open();
        await flush();
        const { button } = parts(m);

        expect(m.contentEl.textContent).toContain(t("e2eeInterruptedTitle"));
        expect(button("e2eeSetupStartButton")).toBeUndefined();
        await press(button("e2eeInterruptedResetButton"));
        expect(raw.migrationService.cancelMigration).toHaveBeenCalled();
        expect(notices).toEqual(["e2eeInterruptedDone"]);
        expect(m.isOpen).toBe(false);
    });
});

describe("unlock dialog", () => {
    it("stays open on a wrong password", async () => {
        const { ctx, notices, acceptPassword } = makeCtx();
        await acceptPassword(GOOD);
        const m = new E2EEUnlockModal(ctx.app, ctx);
        m.open();
        const { button, passwords } = parts(m);
        await type(passwords()[0], "not the password");
        await press(button("e2eeUnlockButton"));

        expect(notices).toEqual(["e2eeUnlockFailed"]);
        // Said inside the dialog too: the plugin's notice settings may hide notices
        expect(m.contentEl.textContent).toContain(t("e2eeUnlockFailed"));
        expect(m.isOpen).toBe(true);
    });

    it("says so when the lock file cannot be read, without blaming the password", async () => {
        const { ctx, raw, acceptPassword } = makeCtx();
        await acceptPassword(GOOD);
        raw.vaultLockService.downloadLockFile.mockRejectedValueOnce(new Error("offline"));
        const m = new E2EEUnlockModal(ctx.app, ctx);
        m.open();
        const { button, passwords } = parts(m);
        await type(passwords()[0], GOOD);
        await press(button("e2eeUnlockButton"));

        expect(m.contentEl.textContent).toContain(t("e2eeRecoveryVerifyError"));
        expect(m.contentEl.textContent).not.toContain(t("e2eeUnlockFailed"));
        expect(raw.cryptoEngine.unlockVault).not.toHaveBeenCalled();
        expect(m.isOpen).toBe(true);

        // The next try works, and the message is gone
        await press(button("e2eeUnlockButton"));
        expect(m.isOpen).toBe(false);
    });

    it("unlocks with the hashed password and saves it only with auto-unlock on", async () => {
        const { ctx, raw, notices, secrets, acceptPassword } = makeCtx();
        await acceptPassword(GOOD);
        const m = new E2EEUnlockModal(ctx.app, ctx);
        m.open();
        const { el, button, passwords } = parts(m);
        await type(passwords()[0], GOOD);
        await toggle(el.querySelector("input[type=checkbox]")!, true);
        await press(button("e2eeUnlockButton"));

        const hashed = await hashPassword(GOOD);
        expect(raw.cryptoEngine.unlockVault).toHaveBeenCalledWith("lock-blob", hashed);
        expect(notices).toEqual(["e2eeUnlockSuccess"]);
        expect(raw.settings.e2eeAutoUnlock).toBe(true);
        expect(secrets.get("e2ee-password")).toBe(hashed);
        expect(m.isOpen).toBe(false);

        // Off again: the saved password goes
        const again = new E2EEUnlockModal(ctx.app, ctx);
        again.open();
        const p = parts(again);
        await type(p.passwords()[0], GOOD);
        await toggle(p.el.querySelector("input[type=checkbox]")!, false);
        await press(p.button("e2eeUnlockButton"));
        expect(secrets.has("e2ee-password")).toBe(false);
    });

    it("re-saves an old (v1) lock file in the current format", async () => {
        const { ctx, raw, acceptPassword } = makeCtx();
        await acceptPassword(GOOD);
        raw.cryptoEngine.needsLockMigration.mockReturnValue(true);
        const m = new E2EEUnlockModal(ctx.app, ctx);
        m.open();
        const { button, passwords } = parts(m);
        await type(passwords()[0], GOOD);
        await press(button("e2eeUnlockButton"));

        const hashed = await hashPassword(GOOD);
        expect(raw.cryptoEngine.updatePassword).toHaveBeenCalledWith(hashed);
        expect(raw.vaultLockService.uploadLockFile).toHaveBeenCalledWith(`lock-for:${hashed}`);
    });
});

describe("password change dialog", () => {
    it("needs a matching confirmation, then uploads the new lock file", async () => {
        const { ctx, raw, notices, secrets } = makeCtx({ autoUnlock: true });
        const m = new E2EEPasswordChangeModal(ctx.app, ctx);
        m.open();
        const { button, passwords } = parts(m);
        const change = button("e2eeChangePasswordButton");
        const [pw, confirm] = passwords();

        await type(pw, GOOD);
        expect(change.disabled).toBe(true);
        await type(confirm, GOOD + "!");
        expect(change.disabled).toBe(true);
        await type(confirm, GOOD);
        expect(change.disabled).toBe(false);
        await press(change);

        const hashed = await hashPassword(GOOD);
        expect(raw.vaultLockService.uploadLockFile).toHaveBeenCalledWith(`lock-for:${hashed}`);
        expect(secrets.get("e2ee-password")).toBe(hashed);
        expect(notices).toEqual(["noticeE2EEPasswordChanged"]);
        expect(m.isOpen).toBe(false);
    });

    it("keeps the dialog usable when the upload fails", async () => {
        const { ctx, raw } = makeCtx();
        raw.vaultLockService.uploadLockFile.mockRejectedValueOnce(new Error("offline"));
        const m = new E2EEPasswordChangeModal(ctx.app, ctx);
        m.open();
        const { button, passwords } = parts(m);
        const [pw, confirm] = passwords();
        await type(pw, GOOD);
        await type(confirm, GOOD);
        await press(button("e2eeChangePasswordButton"));

        expect(Notice.shown).toEqual(["Error: offline"]);
        expect(m.isOpen).toBe(true);
        expect(button("e2eeChangePasswordButton").disabled).toBe(false);
    });
});

describe("recovery dialogs", () => {
    const CODE = "A".repeat(43) + "=";

    it("restores only with a code that looks like a recovery code", async () => {
        const { ctx, raw, notices } = makeCtx();
        const m = new E2EERecoveryImportModal(ctx.app, ctx);
        m.open();
        const { el, button, passwords } = parts(m);
        const restore = button("e2eeRecoveryRestoreButton");
        const [pw, confirm] = passwords();
        await type(pw, GOOD);
        await type(confirm, GOOD);

        await type(el.querySelector("textarea")!, "not a code");
        expect(restore.disabled).toBe(true);
        await type(el.querySelector("textarea")!, `  ${CODE}\n`);
        expect(restore.disabled).toBe(false);
        await press(restore);

        expect(raw.cryptoEngine.recoverFromCode).toHaveBeenCalledWith(CODE, GOOD);
        expect(raw.vaultLockService.uploadLockFile).toHaveBeenCalledWith(`recovered:${CODE}:${GOOD}`);
        expect(notices).toEqual(["noticeE2EERecoveryComplete"]);
        expect(m.isOpen).toBe(false);
    });

    it("shows the code only after the password is entered again", async () => {
        const { ctx, raw, notices, acceptPassword } = makeCtx();
        await acceptPassword(GOOD);
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        const m = new E2EERecoveryExportModal(ctx.app, ctx);
        m.open();
        await flush();
        const { el, button, passwords } = parts(m);

        expect(el.querySelector("textarea")).toBeNull();
        expect(raw.cryptoEngine.exportRecoveryCode).not.toHaveBeenCalled();

        await type(passwords()[0], "a wrong password");
        await press(button("e2eeRecoveryVerifyButton"));
        expect(notices).toEqual(["e2eeUnlockFailed"]);
        expect(el.querySelector("textarea")).toBeNull();
        expect(raw.cryptoEngine.exportRecoveryCode).not.toHaveBeenCalled();
        // Checking the password must not go through unlock: a wrong one would lock the vault
        expect(raw.cryptoEngine.unlockVault).not.toHaveBeenCalled();

        await type(passwords()[0], GOOD);
        await press(button("e2eeRecoveryVerifyButton"));
        expect(el.querySelector("textarea")!.value).toBe(CODE);
        expect(el.querySelector("textarea")!.readOnly).toBe(true);
        expect(el.textContent).toContain("ab:cd:ef");
        expect(passwords()).toEqual([]);
        await press(button("e2eeRecoveryCopy"));
        expect(writeText).toHaveBeenCalledWith(CODE);
        await press(button("e2eeRecoveryClose"));
        expect(m.isOpen).toBe(false);
    });

    it("does not show the code when the password cannot be checked", async () => {
        const { ctx, raw, acceptPassword } = makeCtx();
        await acceptPassword(GOOD);
        raw.vaultLockService.downloadLockFile.mockRejectedValueOnce(new Error("offline"));
        const m = new E2EERecoveryExportModal(ctx.app, ctx);
        m.open();
        await flush();
        const { el, button, passwords } = parts(m);
        await type(passwords()[0], GOOD);
        await press(button("e2eeRecoveryVerifyButton"));

        expect(el.querySelector("textarea")).toBeNull();
        expect(Notice.shown).toEqual([`${t("e2eeRecoveryVerifyError")} offline`]);
        expect(m.isOpen).toBe(true);
    });

    it("shows the code once right after setup, without asking again", async () => {
        const { ctx } = makeCtx();
        const m = new E2EERecoveryExportModal(ctx.app, ctx, "after-setup");
        m.open();
        await flush();
        const { el, passwords } = parts(m);

        expect(passwords()).toEqual([]);
        expect(el.querySelector("textarea")!.value).toBe(CODE);
        expect(el.textContent).toContain(t("e2eeRecoverySetupDesc"));
    });
});
