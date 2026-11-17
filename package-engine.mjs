// Packs the built engine and its Additional Terms of Use into one zip.
//
// Vault-Sync imports this zip: it shows the terms in-app, asks the user to
// agree, and only then installs the engine. Vault-Sync pins the SHA-256 of
// the engine AND of each terms file, so changing either needs a matching
// Vault-Sync release (see the hashes printed below).
import fs from "fs";
import crypto from "crypto";
import { zipSync, strToU8 } from "fflate";

const OUT = "./dist/vault-sync-e2ee-engine.zip";
const FILES = {
    "e2ee-engine.js": "./dist/e2ee-engine.js",
    "TERMS.md": "./TERMS.md",
    "TERMS_ja.md": "./TERMS_ja.md",
};

const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

const entries = {};
const hashes = {};
for (const [name, path] of Object.entries(FILES)) {
    if (!fs.existsSync(path)) {
        console.error(`[E2EE] Missing ${path}. Run the build first.`);
        process.exit(1);
    }
    // Normalize line endings so the hash does not depend on git's autocrlf setting.
    const text = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    entries[name] = strToU8(text);
    hashes[name] = sha256(text);
}

// Fixed timestamps keep the zip byte-identical across builds.
const zip = zipSync(entries, { level: 9, mtime: new Date("2020-01-01T00:00:00Z") });
fs.writeFileSync(OUT, zip);

console.log(`[E2EE] Package: ${OUT} (${zip.length} bytes)`);
console.log("");
console.log("To apply, update Vault-Sync's src/encryption/engine-loader.ts:");
console.log(`  APPROVED_ENGINE_HASH = "${hashes["e2ee-engine.js"]}"`);
console.log(`  APPROVED_TERMS_HASHES = {`);
console.log(`      "TERMS.md": "${hashes["TERMS.md"]}",`);
console.log(`      "TERMS_ja.md": "${hashes["TERMS_ja.md"]}",`);
console.log(`  }`);
