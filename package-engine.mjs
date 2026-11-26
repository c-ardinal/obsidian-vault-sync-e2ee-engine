// Packs the built engine, its Additional Terms of Use and an add-on manifest
// (addon.json) into one zip: Vault Syncer's generic add-on package format.
//
// Vault Syncer imports this zip: it shows the terms in-app, asks the user to
// agree, and only then installs the engine. Vault Syncer pins the SHA-256 of
// every file in the package, so changing any of them needs a matching
// Vault Syncer release (see the hashes printed below).
import fs from "fs";
import crypto from "crypto";
import { zipSync, strToU8 } from "fflate";

const OUT = "./dist/vault-sync-e2ee-engine.zip";
const pkg = JSON.parse(fs.readFileSync("./package.json", "utf8"));

// Add-on manifest read by Vault Syncer. Display text for the add-on lives here,
// not in Vault Syncer.
const manifest = {
    id: "vault-sync-e2ee-engine",
    name: "Vault-Sync E2EE Engine",
    version: pkg.version,
    description: {
        en: "End-to-end encryption for Vault-Sync. Files are encrypted on your device before upload.",
        ja: "Vault-Sync用のエンドツーエンド暗号化。ファイルはアップロード前にデバイス上で暗号化されます。",
    },
    entry: "e2ee-engine.js",
    terms: { en: "TERMS.md", ja: "TERMS_ja.md" },
};
fs.mkdirSync("./dist", { recursive: true });
fs.writeFileSync("./dist/addon.json", JSON.stringify(manifest, null, 4) + "\n");

const FILES = {
    "addon.json": "./dist/addon.json",
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
console.log(
    "To apply, update the files of this add-on in Vault Syncer's src/addons/approved-addons.ts:",
);
for (const [name, hash] of Object.entries(hashes)) {
    console.log(`    "${name}": "${hash}",`);
}
