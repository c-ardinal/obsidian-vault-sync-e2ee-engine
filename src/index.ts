import { MasterKeyManager } from "./encryption/key-manager";

// Register the engine to a global object so the main plugin can find it
const engine = new MasterKeyManager();
export default engine;

console.log("Vault-Sync E2EE Engine ready for loading.");
