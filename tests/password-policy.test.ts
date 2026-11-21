import { describe, it, expect } from "vitest";
import { MIN_PASSWORD_LENGTH, isPasswordAcceptable } from "../src/encryption/password-policy";

describe("new password policy", () => {
    it("needs at least 12 characters", () => {
        expect(MIN_PASSWORD_LENGTH).toBe(12);
        expect(isPasswordAcceptable("Ab1!Ab1!Ab1")).toBe(false); // 11
        expect(isPasswordAcceptable("Ab1!Ab1!Ab1!")).toBe(true); // 12
    });

    it("refuses a password the strength checker rates weak", () => {
        const checker = (pw: string) => ({ strength: pw.startsWith("weak") ? "weak" : "fair", feedback: [] });
        expect(isPasswordAcceptable("weak-but-long-enough", checker)).toBe(false);
        expect(isPasswordAcceptable("fine-and-long-enough", checker)).toBe(true);
    });

    it("works without a strength checker (older Vault-Sync)", () => {
        expect(isPasswordAcceptable("twelve chars")).toBe(true);
        expect(isPasswordAcceptable("short")).toBe(false);
    });
});
