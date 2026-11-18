import { describe, it, expect } from "vitest";
import { STRINGS, getStrings } from "../src/i18n";

describe("add-on strings", () => {
    it("has the same keys in every language", () => {
        const en = Object.keys(STRINGS.en).sort();
        for (const [lang, dict] of Object.entries(STRINGS)) {
            expect(Object.keys(dict).sort(), lang).toEqual(en);
        }
    });

    it("returns {} for an unknown language", () => {
        expect(getStrings("fr")).toEqual({});
        expect(getStrings("ja").labelE2EEUnlock).toBe(STRINGS.ja.labelE2EEUnlock);
    });
});
