import { describe, it, expect } from "vitest";
import { buildUiContributions } from "../src/ui/contributions";
import { STRINGS } from "../src/i18n";
import type { E2EEPluginContext, ICryptoEngine } from "../src/interfaces";

function setup(e2eeEnabled: boolean, unlocked: boolean) {
    const calls: string[] = [];
    const engine = {
        isUnlocked: () => unlocked,
        showSetupModal: () => calls.push("setup"),
        showUnlockModal: () => calls.push("unlock"),
        showPasswordChangeModal: () => calls.push("password"),
        showRecoveryExportModal: () => calls.push("export"),
        showRecoveryImportModal: () => calls.push("import"),
    } as unknown as ICryptoEngine;
    const ctx = {
        t: (k: string) => STRINGS.en[k] ?? `MISSING:${k}`,
        settings: { e2eeEnabled, e2eeAutoUnlock: false },
    } as unknown as E2EEPluginContext;
    const ui = buildUiContributions(engine, ctx, { refresh() {}, openPage() {}, async runAction() { return true; } });
    const available = () => ui.actions!.filter((a) => a.isAvailable?.() !== false).map((a) => a.id);
    return { ui, calls, available, ctx };
}

describe("add-on UI contributions", () => {
    it("keeps the command ids of earlier releases", () => {
        expect(setup(false, false).ui.actions!.map((a) => a.id)).toEqual([
            "e2ee-setup",
            "e2ee-unlock",
            "e2ee-change-password",
            "e2ee-show-recovery",
            "e2ee-recover",
        ]);
    });

    it("offers the actions that apply to each state", () => {
        expect(setup(false, false).available()).toEqual(["e2ee-setup"]);
        expect(setup(true, false).available()).toEqual(["e2ee-unlock", "e2ee-recover"]);
        expect(setup(true, true).available()).toEqual(["e2ee-change-password", "e2ee-show-recovery"]);
    });

    it("opens the matching dialog", async () => {
        const { ui, calls } = setup(true, true);
        for (const a of ui.actions!) await a.run();
        expect(calls).toEqual(["setup", "unlock", "password", "export", "import"]);
    });

    it("has one page whose action rows all point at known actions, with no missing text", () => {
        const { ui } = setup(true, true);
        expect(ui.pages).toHaveLength(1);
        const ids = new Set(ui.actions!.map((a) => a.id));
        const items = ui.pages![0].getSections().flatMap((s) => s.items);
        for (const i of items.filter((i) => i.type === "action")) expect(ids.has(i.actionId!)).toBe(true);
        const text = JSON.stringify({ ...ui.pages![0], items, actions: ui.actions });
        expect(text).not.toContain("MISSING:");
    });

    it("hides password rows and auto-unlock until encryption is set up", () => {
        const { ui, ctx } = setup(false, false);
        const items = ui.pages![0].getSections().flatMap((s) => s.items);
        const hidden = items.filter((i) => i.isHidden?.(ctx.settings)).map((i) => i.key);
        expect(hidden).toEqual(["_subheader_e2ee_password", "e2eeAutoUnlock"]);
    });
});
