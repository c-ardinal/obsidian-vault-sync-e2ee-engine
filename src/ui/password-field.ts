import { Setting } from "obsidian";

const ASCII_PRINTABLE = /^[\x20-\x7E]*$/;

/**
 * Creates a password input Setting with show/hide toggle and ASCII-only filter.
 * Returns the raw HTMLInputElement for external state tracking.
 */
export function addPasswordInput(opts: {
    container: HTMLElement;
    t: (key: string) => string;
    label: string;
    descKey?: string;
    autocomplete: string;
    onPasswordChange: (filteredPassword: string) => void;
    onAsciiViolation?: (violated: boolean) => void;
}): HTMLInputElement {
    let inputEl!: HTMLInputElement;

    const setting = new Setting(opts.container).setName(opts.label);
    if (opts.descKey) {
        setting.setDesc(opts.t(opts.descKey));
    }

    setting
        .addText((text) => {
            inputEl = text.inputEl;
            text.inputEl.type = "password";
            text.inputEl.setAttribute("autocomplete", opts.autocomplete);
            text.onChange((v) => {
                if (!ASCII_PRINTABLE.test(v)) {
                    const filtered = v.replace(/[^\x20-\x7E]/g, "");
                    text.setValue(filtered);
                    opts.onPasswordChange(filtered);
                    opts.onAsciiViolation?.(true);
                } else {
                    opts.onPasswordChange(v);
                    opts.onAsciiViolation?.(false);
                }
            });
        })
        .addExtraButton((btn) => {
            btn.setIcon("eye");
            btn.setTooltip("Show/Hide");
            btn.onClick(() => {
                const isHidden = inputEl.type === "password";
                inputEl.type = isHidden ? "text" : "password";
                btn.setIcon(isHidden ? "eye-off" : "eye");
            });
        });

    return inputEl;
}

/**
 * Creates an ASCII-only warning element, hidden by default.
 * Returns a show/hide control function.
 */
export function createAsciiWarning(
    container: HTMLElement,
    t: (key: string) => string,
): (visible: boolean) => void {
    const el = container.createDiv({ cls: "vault-sync-ascii-warning" });
    el.style.cssText =
        "color:var(--text-error);font-size:0.85em;display:none;margin-top:-8px;margin-bottom:8px;";
    el.setText(t("e2eeSetupAsciiOnly"));

    return (visible: boolean) => {
        el.style.display = visible ? "" : "none";
    };
}

/**
 * Renders a password strength indicator into the given container.
 * Clears previous content and re-renders based on current password.
 */
export function renderStrengthIndicator(
    container: HTMLDivElement,
    password: string,
    checker: ((pw: string) => { strength: string; feedback: string[] }) | undefined,
    t: (key: string) => string,
): void {
    container.empty();
    if (!checker || !password) return;

    const result = checker(password);

    // Strength bar
    const barContainer = container.createDiv({
        cls: "vault-sync-strength-bar-container",
    });
    barContainer.style.cssText = "display:flex;gap:4px;margin-bottom:4px;";

    const colors: Record<string, string> = {
        weak: "var(--text-error)",
        fair: "var(--text-warning)",
        good: "var(--text-success)",
        strong: "var(--interactive-accent)",
    };
    const segmentCount: Record<string, number> = {
        weak: 1,
        fair: 2,
        good: 3,
        strong: 4,
    };
    const filled = segmentCount[result.strength] || 0;
    const color = colors[result.strength] || "var(--text-muted)";

    for (let i = 0; i < 4; i++) {
        const seg = barContainer.createDiv();
        seg.style.cssText = `height:4px;flex:1;border-radius:2px;background:${i < filled ? color : "var(--background-modifier-border)"};`;
    }

    // Strength label
    const strengthKey = `passwordStrength${result.strength.charAt(0).toUpperCase() + result.strength.slice(1)}`;
    const labelEl = container.createDiv();
    labelEl.style.cssText = `font-size:0.85em;color:${color};`;
    labelEl.setText(t(strengthKey));

    // Feedback messages
    if (result.feedback.length > 0) {
        const feedbackEl = container.createDiv();
        feedbackEl.style.cssText =
            "font-size:0.8em;color:var(--text-muted);margin-top:2px;";
        feedbackEl.setText(
            result.feedback.map((key: string) => t(key)).join(". "),
        );
    }
}
