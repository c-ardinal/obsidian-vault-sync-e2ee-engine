# VaultSync E2EE Engine

[ [🇺🇸 English](README.md) | [🇯🇵 日本語](README_ja.md) ]

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An external End-to-End Encryption engine for [VaultSync](https://github.com/c-ardinal/obsidian-vault-sync).
When installed, all vault data is encrypted on your device before upload and decrypted locally after download.
Your cloud provider has no way to see plaintext content.

---

## ✨ Features

- **AES-256-GCM Encryption**: Industry-standard authenticated encryption for all vault files
- **PBKDF2 Key Derivation**: Master key derived from your password with 600,000 iterations
- **Random IV per File**: Each encryption operation uses a unique initialization vector, preventing ciphertext pattern analysis
- **Password Strength Checker**: Built-in strength indicator during setup (powered by zxcvbn-based scoring)
- **Auto-Unlock**: Optionally store your password in Obsidian's secure storage (Keychain) for seamless startup
- **Transparent Integration**: VaultSync's smart sync (3-way merge, conflict detection, revision history) works seamlessly with encrypted data
- **One-Click Migration**: Setup wizard handles encryption of existing vault data with integrity verification

---

## 🚀 Installation

### From Release

1. Download `e2ee-engine.js` from the [Releases page](https://github.com/c-ardinal/obsidian-vault-sync-e2ee-engine/releases)
2. Place it in your VaultSync plugin directory:
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

| Property | Value |
|----------|-------|
| Format | CommonJS (CJS) |
| Encryption | AES-256-GCM via Web Crypto API |
| Key Derivation | PBKDF2-SHA256, 600,000 iterations |
| IV Size | 12 bytes (random per operation) |
| Loader | Dynamically loaded by VaultSync via secure `new Function` evaluator |

---

## ⚠️ Important Notes

- **Never forget your password**: There is no password recovery mechanism. If you forget your password, encrypted data cannot be decrypted.
- **Backup vault-lock.vault**: This file is essential for decryption. If lost, your data cannot be recovered.
- **Multi-device**: All devices sharing the vault must use the same password. When E2EE is enabled on one device, others will be prompted to enter the password on next sync.

---

## ⚠️ Export Control Disclaimer

This software contains cryptographic software.
Depending on your country of residence, there may be restrictions on the import, possession, use, and/or re-export of encryption software to other countries.
Before using this encryption software, please check the laws, regulations, and policies of your country regarding the import, possession, use, and re-export of encryption software to ensure compliance.

---

## License

MIT License
