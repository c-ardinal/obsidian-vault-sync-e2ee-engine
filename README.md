# Vault-Sync E2EE Engine

[ [🇺🇸 English](README.md) | [🇯🇵 日本語](README_ja.md) ]

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An external End-to-End Encryption engine for [Vault-Sync](https://github.com/c-ardinal/obsidian-vault-sync).
When installed, all vault data is encrypted on your device before upload and decrypted locally after download.
Your cloud provider has no way to see plaintext content.

---

## ✨ Features

- **AES-256-GCM Encryption**:
    - Industry-standard authenticated encryption for all vault files
- **PBKDF2 Key Derivation**:
    - Master key derived from your password with 600,000 iterations
- **Random IV per File**:
    - Each encryption operation uses a unique initialization vector, preventing ciphertext pattern analysis
- **Password Strength Checker**:
    - Built-in strength indicator during setup (powered by zxcvbn-based scoring)
- **Auto-Unlock**:
    - Optionally store your password in Obsidian's secure storage (Keychain) for seamless startup
- **Transparent Integration**:
    - Vault-Sync's smart sync (3-way merge, conflict detection, revision history) works seamlessly with encrypted data
- **One-Click Migration**:
    - Setup wizard handles encryption of existing vault data with integrity verification

---

## ⌨️ Commands (via Command Palette)

Once the E2EE Engine is installed, the following commands become available in Obsidian's command palette:

| Command                                | Description                                 |
| -------------------------------------- | ------------------------------------------- |
| E2EE: Start Vault Encryption           | Initialize E2EE on a non-encrypted vault    |
| E2EE: Unlock Vault                     | Unlock a locked vault with your password    |
| E2EE: Change Encryption Password       | Re-wrap master key with a new password      |
| E2EE: Show Recovery Code               | Display a recovery code and key fingerprint |
| E2EE: Recover Vault with Recovery Code | Restore vault access using a recovery code  |

---

## 🚀 Installation

Note: Once E2EE is enabled, it cannot be disabled. If you wish to continue using this plugin without E2EE, follow the [Recovery Procedure](#️-recovery-procedure).

### From Release

1. Download the latest `e2ee-engine.js` from the [Releases page](https://github.com/c-ardinal/obsidian-vault-sync-e2ee-engine/releases)
    - Only the latest version can be used. Vault-Sync will not load older versions even if installed.
2. Place it in your Vault-Sync plugin directory:
    ```
    <Your Vault>/.obsidian/plugins/obsidian-vault-sync/e2ee-engine.js
    ```
3. Restart Obsidian
4. Run the E2EE setup command from the command palette
5. The E2EE setup wizard will appear — follow the prompts to set your password and migrate your vault

### From Source

1. Install dependencies:

    ```bash
    npm install
    ```

2. Build the engine:

    ```bash
    npm run build
    ```

3. Copy `dist/e2ee-engine.js` to your plugin directory:
    ```
    <Your Vault>/.obsidian/plugins/obsidian-vault-sync/e2ee-engine.js
    ```

---

## 🔒 Security Architecture

### Vault Lock

The `vault-lock.vault` file is stored alongside your encrypted vault and contains:

- Encrypted master key material
- PBKDF2 salt and iteration count
- Password hint (if configured)

This file is required to unlock the vault. Without it and your password, data cannot be decrypted.
The file is not stored locally — it is located on cloud storage at:

```
  <Your Vault>/.obsidian/plugins/obsidian-vault-sync/data/remote/vault-lock.vault
```

---

## 🔧 Technical Details

| Property       | Value                                                                |
| -------------- | -------------------------------------------------------------------- |
| Format         | CommonJS (CJS)                                                       |
| Encryption     | AES-256-GCM via Web Crypto API                                       |
| Key Derivation | PBKDF2-SHA256, 600,000 iterations                                    |
| IV Size        | 12 bytes (random per operation)                                      |
| Loader         | Dynamically loaded by Vault-Sync via secure `new Function` evaluator |

---

## ⚠️ Important Notes

- **Never forget your password**:
    - If you lose both your password and recovery code, encrypted data cannot be decrypted. Use the "Show Recovery Code" command to export a backup recovery code and store it in a safe place.
    - Even the developer cannot recover your data.
- **Backup vault-lock.vault**:
    - This file exists only on cloud storage. It is essential for decryption. If lost, your data cannot be recovered.
    - Even the developer cannot recover your data.
- **Multi-device**:
    - All devices sharing the vault must use the same password. When E2EE is enabled on one device, others will be prompted to enter the password on next sync.

---

## ⚠️ Export Control Disclaimer

This software contains cryptographic software.
Depending on your country of residence, there may be restrictions on the import, possession, use, and/or re-export of encryption software to other countries.
Before using this encryption software, please check the laws, regulations, and policies of your country regarding the import, possession, use, and re-export of encryption software to ensure compliance.

---

## ❗️ Troubleshooting

### If you forgot your password / lost your recovery code / lost vault-lock.vault

Data on cloud storage **cannot be decrypted by any means**. As a result, features such as sync and revision history will not be available.
If you wish to continue using this plugin without E2EE, follow the [Recovery Procedure](#️-recovery-procedure).

### If you want to disable E2EE

Once enabled, E2EE cannot be disabled.
If you wish to continue using this plugin without E2EE, follow the [Recovery Procedure](#️-recovery-procedure).

### Recovery Procedure

Note: Performing the following steps will result in the **loss of all Vault-Sync plugin-related data**, including plugin settings and file revision history.

1. Outside of Obsidian: Using a browser or cloud storage app, delete the Vault folder on cloud storage (under `ObsidianVaultSync` by default).
2. In Obsidian, go to Settings > Community Plugins > Installed Plugins and uninstall Vault-Sync.
3. Restart Obsidian.
4. In Obsidian, go to Settings > Community Plugins > Browse and reinstall Vault-Sync.
5. Log in from Vault-Sync settings and upload your Vault to cloud storage.

---

## License

MIT License
