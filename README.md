# VaultSync E2EE Engine

This is an external encryption engine for VaultSync.

## Build Instructions

1. Install dependencies:

    ```bash
    npm install
    ```

2. Build the engine:

    ```bash
    npm run build
    ```

3. Copy the output file:
   Copy `dist/e2ee-engine.js` to your Obsidian plugin directory:
   `.obsidian/plugins/obsidian-vault-sync/e2ee-engine.js`

4. Restart Obsidian or reload the plugin.

## Technical Details

- **Format**: CommonJS (CJS)
- **APIs**: Web Crypto API
- **Loader**: Dynamically loaded by VaultSync main plugin using a secure `new Function` evaluator.
