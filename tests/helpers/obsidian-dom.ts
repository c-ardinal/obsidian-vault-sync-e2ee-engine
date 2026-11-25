/**
 * The parts of Obsidian's UI API the engine's dialogs use, on a jsdom document.
 * Elements are real DOM; the tests read them and drive the controls through the
 * handlers the dialogs registered (see type / press).
 */

type Opts = { text?: string; cls?: string } | string | undefined;

declare global {
    interface HTMLElement {
        createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: Opts): HTMLElementTagNameMap[K];
        createDiv(o?: Opts): HTMLDivElement;
        empty(): void;
        setText(text: string): void;
        appendText(text: string): void;
        hide(): void;
        show(): void;
    }
}

const proto = HTMLElement.prototype;
proto.createEl = function <K extends keyof HTMLElementTagNameMap>(this: HTMLElement, tag: K, o?: Opts) {
    const el = document.createElement(tag);
    const opts = typeof o === "string" ? { cls: o } : (o ?? {});
    if (opts.text !== undefined) el.textContent = opts.text;
    if (opts.cls) el.className = opts.cls;
    this.appendChild(el);
    return el;
};
proto.createDiv = function (this: HTMLElement, o?: Opts) {
    return this.createEl("div", o);
};
proto.empty = function (this: HTMLElement) {
    this.replaceChildren();
};
proto.setText = function (this: HTMLElement, text: string) {
    this.textContent = text;
};
proto.appendText = function (this: HTMLElement, text: string) {
    this.appendChild(document.createTextNode(text));
};
proto.hide = function (this: HTMLElement) {
    this.style.display = "none";
};
proto.show = function (this: HTMLElement) {
    this.style.display = "";
};

/** Handlers the dialogs registered, kept on the element they belong to */
type Handlers = { __change?: (v: string) => unknown; __click?: () => unknown };

export class App {}

export class Notice {
    static shown: string[] = [];
    constructor(message: string) {
        Notice.shown.push(message);
    }
}

export class Modal {
    containerEl = document.createElement("div");
    modalEl = this.containerEl.createDiv("modal");
    contentEl = this.modalEl.createDiv("modal-content");
    isOpen = false;
    constructor(public app: App) {
        this.modalEl.createEl("button", { cls: "modal-close-button" });
    }
    open(): void {
        this.isOpen = true;
        document.body.appendChild(this.containerEl);
        void (this as unknown as { onOpen?: () => unknown }).onOpen?.();
    }
    close(): void {
        this.isOpen = false;
        this.containerEl.remove();
    }
}

export class ButtonComponent {
    buttonEl: HTMLButtonElement;
    constructor(container: HTMLElement) {
        this.buttonEl = container.createEl("button");
    }
    setButtonText(t: string) {
        this.buttonEl.textContent = t;
        return this;
    }
    setCta() {
        this.buttonEl.classList.add("mod-cta");
        return this;
    }
    setDisabled(d: boolean) {
        this.buttonEl.disabled = d;
        return this;
    }
    onClick(fn: () => unknown) {
        (this.buttonEl as HTMLElement & Handlers).__click = fn;
        return this;
    }
}

class ExtraButtonComponent {
    extraSettingsEl: HTMLElement;
    icon = "";
    constructor(container: HTMLElement) {
        this.extraSettingsEl = container.createDiv("clickable-icon");
    }
    setIcon(icon: string) {
        this.icon = icon;
        this.extraSettingsEl.dataset.icon = icon;
        return this;
    }
    setTooltip(t: string) {
        this.extraSettingsEl.setAttribute("aria-label", t);
        return this;
    }
    onClick(fn: () => unknown) {
        (this.extraSettingsEl as HTMLElement & Handlers).__click = fn;
        return this;
    }
}

class TextComponent {
    inputEl: HTMLInputElement;
    constructor(container: HTMLElement) {
        this.inputEl = container.createEl("input");
        this.inputEl.type = "text";
    }
    setValue(v: string) {
        this.inputEl.value = v;
        return this;
    }
    onChange(fn: (v: string) => unknown) {
        (this.inputEl as HTMLElement & Handlers).__change = fn;
        return this;
    }
}

export class TextAreaComponent {
    inputEl: HTMLTextAreaElement;
    constructor(container: HTMLElement) {
        this.inputEl = container.createEl("textarea");
    }
    setValue(v: string) {
        this.inputEl.value = v;
        return this;
    }
    onChange(fn: (v: string) => unknown) {
        (this.inputEl as HTMLElement & Handlers).__change = fn;
        return this;
    }
}

class ToggleComponent {
    toggleEl: HTMLInputElement;
    constructor(container: HTMLElement) {
        this.toggleEl = container.createEl("input");
        this.toggleEl.type = "checkbox";
    }
    setValue(v: boolean) {
        this.toggleEl.checked = v;
        return this;
    }
    onChange(fn: (v: boolean) => unknown) {
        (this.toggleEl as HTMLElement & Handlers).__change = fn as never;
        return this;
    }
}

export class Setting {
    settingEl: HTMLElement;
    nameEl: HTMLElement;
    descEl: HTMLElement;
    controlEl: HTMLElement;
    constructor(container: HTMLElement) {
        this.settingEl = container.createDiv("setting-item");
        const info = this.settingEl.createDiv("setting-item-info");
        this.nameEl = info.createDiv("setting-item-name");
        this.descEl = info.createDiv("setting-item-description");
        this.controlEl = this.settingEl.createDiv("setting-item-control");
    }
    setName(n: string) {
        this.nameEl.textContent = n;
        return this;
    }
    setDesc(d: string) {
        this.descEl.textContent = d;
        return this;
    }
    addButton(cb: (b: ButtonComponent) => unknown) {
        cb(new ButtonComponent(this.controlEl));
        return this;
    }
    addExtraButton(cb: (b: ExtraButtonComponent) => unknown) {
        cb(new ExtraButtonComponent(this.controlEl));
        return this;
    }
    addText(cb: (t: TextComponent) => unknown) {
        cb(new TextComponent(this.controlEl));
        return this;
    }
    addTextArea(cb: (t: TextAreaComponent) => unknown) {
        cb(new TextAreaComponent(this.controlEl));
        return this;
    }
    addToggle(cb: (t: ToggleComponent) => unknown) {
        cb(new ToggleComponent(this.controlEl));
        return this;
    }
}

// ── Test drivers ──

/** Type into a field: what the user's input event would hand to the dialog */
export async function type(el: Element, value: string): Promise<void> {
    (el as HTMLInputElement).value = value;
    await (el as HTMLElement & Handlers).__change?.(value);
}

/** Flip a toggle */
export async function toggle(el: Element, on: boolean): Promise<void> {
    (el as HTMLInputElement).checked = on;
    await (el as HTMLElement & Handlers).__change?.(on as never);
}

/** Press a button (a disabled one does nothing, as in the app) */
export async function press(el: Element): Promise<void> {
    if ((el as HTMLButtonElement).disabled) return;
    await (el as HTMLElement & Handlers).__click?.();
}
