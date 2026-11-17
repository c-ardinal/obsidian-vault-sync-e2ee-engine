# Vault-Sync E2EE Engine: Additional Terms of Use

[ [🇺🇸 English](TERMS.md) | [🇯🇵 日本語](TERMS_ja.md) ]

These Additional Terms ("Additional Terms") apply to the Vault-Sync E2EE Engine ("the Engine"), the optional end-to-end encryption add-on for Vault-Sync, developed by c-ardinal. They are an addendum to the [Vault-Sync Terms of Service](https://obsidian-vault-sync.pages.dev/tos/) ("Base Terms"). Where the two conflict for anything concerning the Engine, these Additional Terms take precedence.

By installing the Engine (including by confirming these Additional Terms in Vault-Sync's install dialog), you agree to the Base Terms and to these Additional Terms. If you do not agree, do not install or use the Engine.

## 1. What the Engine is

- The Engine is free, open-source software released under the [MIT License](LICENSE). It encrypts vault data on your device before Vault-Sync uploads it and decrypts it after download.
- The Engine is distributed separately from Vault-Sync. Vault-Sync does not download, install or enable the Engine on its own. You obtain it yourself from this repository's release page and choose to install it.

## 2. Your decision and responsibility

- You install and use the Engine of your own free will and at your own risk.
- You are responsible for deciding whether the Engine's protection is adequate for your data.

## 3. Laws on encryption software

- The Engine contains cryptographic software. Some countries and regions restrict the import, possession, use and/or re-export of encryption software, or require a licence or registration.
- You are solely responsible for confirming that the laws and regulations that apply to you allow you to download, possess and use the Engine, and for complying with them.
- Do not download, install, use or re-export the Engine where doing so is prohibited, or for any person or destination to which its provision is restricted by applicable export-control or sanctions laws.

## 4. Passwords, recovery codes and the vault-lock file

- Your encryption password, recovery code and the `vault-lock.vault` file are under your control alone. The developer never receives them and cannot reset or recover them.
- If you lose both your password and your recovery code, or lose the `vault-lock.vault` file, your encrypted data cannot be decrypted by anyone, including the developer.
- Once E2EE is enabled for a vault, it cannot be turned off from within Vault-Sync. To stop using it you must follow the recovery procedure described in the README.

## 5. Limits of the protection

- No encryption is absolutely secure. The developer does not guarantee that the Engine is free of defects or vulnerabilities, or that encrypted data cannot be accessed by others.
- The Engine does not protect data on a device that is compromised (for example by malware), unlocked and accessible to others, or while the vault is unlocked.
- Information other than file contents, such as the number and size of files and when sync happens, may still be observable by your cloud storage provider.

## 6. No warranty

THE ENGINE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING FITNESS FOR A PARTICULAR PURPOSE, SECURITY, AND NON-INFRINGEMENT.

## 7. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE DEVELOPER SHALL NOT BE LIABLE FOR ANY DAMAGES ARISING FROM THE INSTALLATION OR USE OF THE ENGINE, INCLUDING BUT NOT LIMITED TO:

- Permanent loss of access to encrypted data
- Data loss or corruption during encryption, migration or decryption
- Unauthorised access to your data
- Any consequence of downloading, possessing or using the Engine in breach of laws that apply to you

## 8. Changes

The developer may modify these Additional Terms at any time. Updated terms will be published in this repository. Continuing to use the Engine after a change means you accept the revised Additional Terms.

## 9. Contact

For questions about these Additional Terms, please open an issue on this GitHub repository.

Last updated: November 17, 2026
