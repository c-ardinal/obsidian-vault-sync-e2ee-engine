/**
 * Minimum rules for a new encryption password (setup, password change, recovery).
 *
 * The vault-lock is protected by PBKDF2-SHA512 at 210,000 iterations. One GPU
 * still tests thousands of guesses per second against it, so a short or
 * dictionary-like password falls quickly once someone holds the lock file.
 * Existing passwords are not affected: unlocking never checks these rules.
 */
export const MIN_PASSWORD_LENGTH = 12;

export type PasswordStrengthChecker = (password: string) => { strength: string; feedback: string[] };

/** True when a new password may be used: long enough and not rated "weak". */
export function isPasswordAcceptable(password: string, checker?: PasswordStrengthChecker): boolean {
    if (password.length < MIN_PASSWORD_LENGTH) return false;
    if (checker && checker(password).strength === "weak") return false;
    return true;
}
