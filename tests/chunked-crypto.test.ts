/**
 * Chunked format (VSC3, and the older VSC2 it still reads): round trips at chunk boundaries and how damaged or
 * tampered data is rejected. Large files are uploaded in this format, so a
 * truncated download (connection dropped) must fail loudly instead of
 * producing a shorter file.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { webcrypto } from "node:crypto";
import {
    HEADER_SIZE,
    HEADER_SIZE_V3,
    calculateVSC2Size,
    calculateVSC3Size,
    buildVSC3Header,
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
        async encrypt(data, aad) {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const params = aad ? { name: "AES-GCM", iv, additionalData: aad } : { name: "AES-GCM", iv };
            return { iv, ciphertext: await crypto.subtle.encrypt(params, key, data) };
        },
        async decrypt(ciphertext, iv, aad) {
            const params = aad ? { name: "AES-GCM", iv, additionalData: aad } : { name: "AES-GCM", iv };
            return crypto.subtle.decrypt(params, key, ciphertext);
        },
    };
});

function bytes(n: number, seed = 1): ArrayBuffer {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 31 + seed * 7) & 0xff;
    return b.buffer;
}

const CHUNK = 64;
const STRIDE = 12 + CHUNK + 16; // one full encrypted chunk: IV + data + tag

/** The pre-VSC3 writer: VSC2 header, chunks encrypted without AAD. */
async function encryptLegacyVSC2(plain: ArrayBuffer): Promise<ArrayBuffer> {
    const total = Math.max(1, Math.ceil(plain.byteLength / CHUNK));
    const out = new Uint8Array(calculateVSC2Size(plain.byteLength, CHUNK, 12, 16));
    out.set(buildVSC2Header(CHUNK, total), 0);
    let o = HEADER_SIZE;
    for (let i = 0; i < total; i++) {
        const { iv, ciphertext } = await engine.encrypt(plain.slice(i * CHUNK, Math.min((i + 1) * CHUNK, plain.byteLength)));
        out.set(iv, o);
        o += 12;
        out.set(new Uint8Array(ciphertext), o);
        o += ciphertext.byteLength;
    }
    return out.buffer;
}

describe("VSC3 round trip", () => {
    it.each([0, 1, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 3, CHUNK * 3 + 5])(
        "%i bytes survive encrypt + decrypt with the predicted size",
        async (n) => {
            const plain = bytes(n);
            const enc = await encryptChunked(plain, engine, CHUNK);
            expect(isChunkedFormat(enc)).toBe(true);
            expect(new TextDecoder().decode(new Uint8Array(enc, 0, 4))).toBe("VSC3");
            expect(enc.byteLength).toBe(calculateVSC3Size(n, CHUNK, 12, 16));
            const dec = await decryptChunked(enc, engine);
            expect(new Uint8Array(dec)).toEqual(new Uint8Array(plain));
        },
    );

    it("the streaming generator and the one-shot encoder produce the same layout", async () => {
        const plain = bytes(CHUNK * 2 + 10);
        const parts: Uint8Array[] = [];
        let total = 0;
        const header = buildVSC3Header(CHUNK, 3);
        parts.push(header);
        for await (const c of encryptChunks(plain, engine, CHUNK, header)) {
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

describe("VSC3 damaged data", () => {
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
        for (const cut of [HEADER_SIZE_V3 - 1, HEADER_SIZE_V3 + 5, HEADER_SIZE_V3 + 12 + CHUNK, enc.byteLength - 1]) {
            const p = decryptChunked(enc.slice(0, cut).buffer, engine);
            await expect(p, `cut at ${cut}`).rejects.toBeInstanceOf(DecryptionError);
        }
    });

    it("rejects a single flipped bit in any chunk", async () => {
        const enc = await sample();
        const stride = 12 + CHUNK + 16;
        for (let chunk = 0; chunk < 3; chunk++) {
            const bad = enc.slice();
            bad[HEADER_SIZE_V3 + chunk * stride + 12 + 3] ^= 1;
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

    it("rejects chunks swapped into a different order", async () => {
        const enc = await sample();
        const swapped = enc.slice();
        const a = HEADER_SIZE_V3;
        const b = HEADER_SIZE_V3 + STRIDE;
        swapped.set(enc.subarray(b, b + STRIDE), a);
        swapped.set(enc.subarray(a, a + STRIDE), b);
        await expectError(swapped, "authentication");
    });

    it("rejects trailing chunks dropped with the chunk count lowered to match", async () => {
        const enc = await sample();
        const dropped = enc.slice(0, HEADER_SIZE_V3 + 2 * STRIDE);
        new DataView(dropped.buffer).setUint32(8, 2, true);
        await expectError(dropped, "authentication");
    });

    it("rejects a whole chunk duplicated in place of another", async () => {
        const enc = await sample();
        const dup = enc.slice();
        dup.set(enc.subarray(HEADER_SIZE_V3, HEADER_SIZE_V3 + STRIDE), HEADER_SIZE_V3 + STRIDE);
        await expectError(dup, "authentication");
    });

    it("rejects a chunk taken from another file with the same layout", async () => {
        const a = await sample();
        const b = await sample();
        const mixed = a.slice();
        mixed.set(b.subarray(HEADER_SIZE_V3 + STRIDE, HEADER_SIZE_V3 + 2 * STRIDE), HEADER_SIZE_V3 + STRIDE);
        await expectError(mixed, "authentication");
        // Even with the other file's header, the rest of the chunks no longer fit.
        const hdr = a.slice();
        hdr.set(b.subarray(0, HEADER_SIZE_V3), 0);
        await expectError(hdr, "authentication");
    });

    it("rejects a changed file nonce in the header", async () => {
        const enc = await sample();
        const nonce = enc.slice();
        nonce[HEADER_SIZE_V3 - 1] ^= 1;
        await expectError(nonce, "authentication");
    });

    it("rejects a VSC3 file relabelled as VSC2 (downgrade)", async () => {
        const enc = await sample();
        const down = enc.slice();
        down[3] = 0x32;
        await expect(decryptChunked(down.buffer, engine)).rejects.toBeInstanceOf(DecryptionError);
    });
});

describe("VSC3 streaming header", () => {
    it("without a header, every item carries the generated one, and it decrypts", async () => {
        const plain = bytes(CHUNK * 2 + 3);
        const parts: Uint8Array[] = [];
        for await (const c of encryptChunks(plain, engine, CHUNK)) {
            if (c.index === 0) parts.push(c.header);
            parts.push(c.iv, new Uint8Array(c.ciphertext));
        }
        const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
        let o = 0;
        for (const p of parts) {
            out.set(p, o);
            o += p.byteLength;
        }
        expect(new Uint8Array(await decryptChunked(out.buffer, engine))).toEqual(new Uint8Array(plain));
    });

    it("refuses a header that does not match the data", async () => {
        const plain = bytes(CHUNK * 2);
        const run = async (header: Uint8Array) => {
            for await (const _ of encryptChunks(plain, engine, CHUNK, header)) void _;
        };
        await expect(run(buildVSC3Header(CHUNK, 3))).rejects.toThrow(/header/);
        await expect(run(buildVSC3Header(CHUNK + 1, 2))).rejects.toThrow(/header/);
        await expect(run(buildVSC2Header(CHUNK, 2))).rejects.toThrow(/header/);
    });

    it("each header gets a fresh file nonce", () => {
        expect(buildVSC3Header(CHUNK, 1)).not.toEqual(buildVSC3Header(CHUNK, 1));
    });
});

describe("VSC2 files written before VSC3", () => {
    it.each([0, 1, CHUNK, CHUNK * 3 + 5])("%i bytes still decrypt", async (n) => {
        const plain = bytes(n, 3);
        const enc = await encryptLegacyVSC2(plain);
        expect(isChunkedFormat(enc)).toBe(true);
        expect(new Uint8Array(await decryptChunked(enc, engine))).toEqual(new Uint8Array(plain));
    });

    it("still rejects a flipped bit and a cut-off download", async () => {
        const enc = new Uint8Array(await encryptLegacyVSC2(bytes(CHUNK * 3)));
        const bad = enc.slice();
        bad[HEADER_SIZE + 12 + 3] ^= 1;
        await expect(decryptChunked(bad.buffer, engine)).rejects.toMatchObject({ cause: "authentication" });
        await expect(decryptChunked(enc.slice(0, enc.byteLength - 1).buffer, engine)).rejects.toBeInstanceOf(
            DecryptionError,
        );
    });

    it("a VSC2 file is not accepted as VSC3 (no AAD upgrade by relabelling)", async () => {
        const enc = new Uint8Array(await encryptLegacyVSC2(bytes(CHUNK * 3)));
        const up = enc.slice();
        up[3] = 0x33;
        await expect(decryptChunked(up.buffer, engine)).rejects.toBeInstanceOf(DecryptionError);
    });
});
