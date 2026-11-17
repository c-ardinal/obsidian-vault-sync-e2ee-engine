/**
 * VSC2 chunked format: round trips at chunk boundaries and how damaged or
 * tampered data is rejected. Large files are uploaded in this format, so a
 * truncated download (connection dropped) must fail loudly instead of
 * producing a shorter file.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { webcrypto } from "node:crypto";
import {
    HEADER_SIZE,
    calculateVSC2Size,
    decryptChunked,
    encryptChunked,
    encryptChunks,
    buildVSC2Header,
    isChunkedFormat,
    type CryptoProvider,
} from "../src/encryption/chunked-crypto";
import { DecryptionError } from "../src/encryption/errors";

const g = globalThis as any;
if (!g.crypto) g.crypto = webcrypto;

let engine: CryptoProvider;

beforeAll(async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    engine = {
        ivSize: 12,
        tagSize: 16,
        async encrypt(data) {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            return { iv, ciphertext: await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data) };
        },
        async decrypt(ciphertext, iv) {
            return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
        },
    };
});

function bytes(n: number, seed = 1): ArrayBuffer {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 31 + seed * 7) & 0xff;
    return b.buffer;
}

const CHUNK = 64;

describe("VSC2 round trip", () => {
    it.each([0, 1, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 3, CHUNK * 3 + 5])(
        "%i bytes survive encrypt + decrypt with the predicted size",
        async (n) => {
            const plain = bytes(n);
            const enc = await encryptChunked(plain, engine, CHUNK);
            expect(isChunkedFormat(enc)).toBe(true);
            expect(enc.byteLength).toBe(calculateVSC2Size(n, CHUNK, 12, 16));
            const dec = await decryptChunked(enc, engine);
            expect(new Uint8Array(dec)).toEqual(new Uint8Array(plain));
        },
    );

    it("the streaming generator and the one-shot encoder produce the same layout", async () => {
        const plain = bytes(CHUNK * 2 + 10);
        const parts: Uint8Array[] = [];
        let total = 0;
        for await (const c of encryptChunks(plain, engine, CHUNK)) {
            if (c.index === 0) parts.push(buildVSC2Header(CHUNK, c.totalChunks));
            parts.push(c.iv, new Uint8Array(c.ciphertext));
        }
        for (const p of parts) total += p.byteLength;
        const out = new Uint8Array(total);
        let o = 0;
        for (const p of parts) {
            out.set(p, o);
            o += p.byteLength;
        }
        expect(new Uint8Array(await decryptChunked(out.buffer, engine))).toEqual(new Uint8Array(plain));
    });

    it("each upload uses fresh IVs (identical content gives different ciphertext)", async () => {
        const plain = bytes(CHUNK * 2);
        const a = new Uint8Array(await encryptChunked(plain, engine, CHUNK));
        const b = new Uint8Array(await encryptChunked(plain, engine, CHUNK));
        expect(a).not.toEqual(b);
    });
});

describe("VSC2 damaged data", () => {
    async function sample(chunks = 3): Promise<Uint8Array> {
        return new Uint8Array(await encryptChunked(bytes(CHUNK * chunks), engine, CHUNK));
    }

    async function expectError(data: Uint8Array, cause: "format" | "authentication") {
        const p = decryptChunked(data.slice().buffer, engine);
        await expect(p).rejects.toBeInstanceOf(DecryptionError);
        await expect(p).rejects.toMatchObject({ cause });
    }

    it("rejects a download cut off at any point", async () => {
        const enc = await sample();
        for (const cut of [HEADER_SIZE - 1, HEADER_SIZE + 5, HEADER_SIZE + 12 + CHUNK, enc.byteLength - 1]) {
            const p = decryptChunked(enc.slice(0, cut).buffer, engine);
            await expect(p, `cut at ${cut}`).rejects.toBeInstanceOf(DecryptionError);
        }
    });

    it("rejects a single flipped bit in any chunk", async () => {
        const enc = await sample();
        const stride = 12 + CHUNK + 16;
        for (let chunk = 0; chunk < 3; chunk++) {
            const bad = enc.slice();
            bad[HEADER_SIZE + chunk * stride + 12 + 3] ^= 1;
            await expectError(bad, "authentication");
        }
    });

    it("rejects bytes appended after the last chunk", async () => {
        const enc = await sample();
        const longer = new Uint8Array(enc.byteLength + 7);
        longer.set(enc);
        await expectError(longer, "authentication");
    });

    it("rejects a header whose chunk count does not match the data", async () => {
        const enc = await sample();
        const more = enc.slice();
        new DataView(more.buffer).setUint32(8, 5, true);
        await expect(decryptChunked(more.buffer, engine)).rejects.toBeInstanceOf(DecryptionError);
        const fewer = enc.slice();
        new DataView(fewer.buffer).setUint32(8, 2, true);
        await expect(decryptChunked(fewer.buffer, engine)).rejects.toBeInstanceOf(DecryptionError);
    });

    it("rejects zero chunk size / chunk count and bad magic", async () => {
        const enc = await sample();
        const zeroSize = enc.slice();
        new DataView(zeroSize.buffer).setUint32(4, 0, true);
        await expectError(zeroSize, "format");
        const zeroCount = enc.slice();
        new DataView(zeroCount.buffer).setUint32(8, 0, true);
        await expectError(zeroCount, "format");
        const magic = enc.slice();
        magic[0] = 0;
        await expectError(magic, "format");
    });

    it("does not allocate from an absurd header before checking the data", async () => {
        // chunkSize * totalChunks from a corrupt header must not be trusted blindly
        const enc = await sample(1);
        const huge = enc.slice();
        new DataView(huge.buffer).setUint32(4, 0xffff_fff0, true);
        new DataView(huge.buffer).setUint32(8, 0xffff_fff0, true);
        await expect(decryptChunked(huge.buffer, engine)).rejects.toBeInstanceOf(DecryptionError);
    });

    // Chunks carry no position (no AAD), so someone with write access to the cloud
    // could reorder chunks of one file, or drop trailing chunks and lower the count
    // in the header, without the authentication failing. Fixing this needs a new
    // format version; see the report in the plugin repository.
    it.todo("rejects chunks that were reordered or dropped from the end (needs a format with chunk AAD)");
});
