import { DecryptionError } from "./errors";

/** VSC2 magic bytes: "VSC2" (Vault-Sync Chunked v2) */
export const CHUNK_MAGIC = new Uint8Array([0x56, 0x53, 0x43, 0x32]);

export const HEADER_SIZE = 12; // magic(4) + chunkSize(4) + totalChunks(4)

/** VSC3 magic bytes: "VSC3" (Vault-Sync Chunked v3, chunks bound to their position) */
export const CHUNK_MAGIC_V3 = new Uint8Array([0x56, 0x53, 0x43, 0x33]);

/** Random per-file id in the VSC3 header, so chunks cannot be moved between files. */
export const FILE_NONCE_SIZE = 16;

export const HEADER_SIZE_V3 = HEADER_SIZE + FILE_NONCE_SIZE; // VSC2 fields + fileNonce(16)

/** Minimal engine interface needed for chunked crypto operations. */
export interface CryptoProvider {
    encrypt(
        data: ArrayBuffer,
        aad?: Uint8Array,
    ): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }>;
    decrypt(ciphertext: ArrayBuffer, iv: Uint8Array, aad?: Uint8Array): Promise<ArrayBuffer>;
    readonly ivSize: number;
    readonly tagSize: number;
}

function hasMagic(data: ArrayBuffer, magic: Uint8Array): boolean {
    if (data.byteLength < 4) return false;
    const view = new Uint8Array(data, 0, 4);
    return view[0] === magic[0] && view[1] === magic[1] && view[2] === magic[2] && view[3] === magic[3];
}

/** Check whether an ArrayBuffer starts with a chunked-format (VSC2 or VSC3) magic header. */
export function isChunkedFormat(data: ArrayBuffer): boolean {
    return hasMagic(data, CHUNK_MAGIC_V3) || hasMagic(data, CHUNK_MAGIC);
}

/** Calculate the total encrypted size for a given plaintext size using VSC2 format. */
export function calculateVSC2Size(
    plaintextSize: number,
    chunkSize: number,
    ivSize: number,
    tagSize: number,
): number {
    const totalChunks = Math.max(1, Math.ceil(plaintextSize / chunkSize));
    return HEADER_SIZE + totalChunks * ivSize + plaintextSize + totalChunks * tagSize;
}

/** Build a 12-byte VSC2 header. */
export function buildVSC2Header(chunkSize: number, totalChunks: number): Uint8Array {
    const header = new Uint8Array(HEADER_SIZE);
    header.set(CHUNK_MAGIC, 0);
    const dv = new DataView(header.buffer, header.byteOffset, HEADER_SIZE);
    dv.setUint32(4, chunkSize, true);
    dv.setUint32(8, totalChunks, true);
    return header;
}

/** Calculate the total encrypted size for a given plaintext size using VSC3 format. */
export function calculateVSC3Size(
    plaintextSize: number,
    chunkSize: number,
    ivSize: number,
    tagSize: number,
): number {
    return calculateVSC2Size(plaintextSize, chunkSize, ivSize, tagSize) + FILE_NONCE_SIZE;
}

/** Build a 28-byte VSC3 header with a fresh random file nonce. */
export function buildVSC3Header(chunkSize: number, totalChunks: number): Uint8Array {
    const header = new Uint8Array(HEADER_SIZE_V3);
    header.set(buildVSC2Header(chunkSize, totalChunks), 0);
    header.set(CHUNK_MAGIC_V3, 0);
    crypto.getRandomValues(header.subarray(HEADER_SIZE));
    return header;
}

/**
 * Additional authenticated data for one VSC3 chunk:
 * header(28) || chunkIndex(LE32) || isLast(1).
 * Binding the whole header (chunk size, chunk count, file nonce), the position and
 * the last-chunk flag means a chunk that was moved, dropped, copied from another
 * file, or followed by a rewritten header fails authentication.
 */
export function vsc3ChunkAad(header: Uint8Array, index: number, isLast: boolean): Uint8Array {
    const aad = new Uint8Array(HEADER_SIZE_V3 + 5);
    aad.set(header.subarray(0, HEADER_SIZE_V3), 0);
    new DataView(aad.buffer).setUint32(HEADER_SIZE_V3, index, true);
    aad[HEADER_SIZE_V3 + 4] = isLast ? 1 : 0;
    return aad;
}

function readHeaderFields(header: Uint8Array): { chunkSize: number; totalChunks: number } {
    const dv = new DataView(header.buffer, header.byteOffset, HEADER_SIZE);
    return { chunkSize: dv.getUint32(4, true), totalChunks: dv.getUint32(8, true) };
}

/**
 * Iterate over plaintext chunks, encrypting each one in VSC3 format.
 *
 * Pass the header that will be written in front of the chunks (from
 * `buildVSC3Header`); every chunk is bound to it. Without one, a header is
 * generated, and each yielded item carries the header that must be written.
 */
export async function* encryptChunks(
    plaintext: ArrayBuffer,
    engine: CryptoProvider,
    chunkSize: number,
    header?: Uint8Array,
): AsyncGenerator<{
    iv: Uint8Array;
    ciphertext: ArrayBuffer;
    index: number;
    totalChunks: number;
    header: Uint8Array;
}> {
    const totalChunks = Math.max(1, Math.ceil(plaintext.byteLength / chunkSize));
    if (header) {
        const fields = header.byteLength === HEADER_SIZE_V3 ? readHeaderFields(header) : null;
        if (
            !fields ||
            !CHUNK_MAGIC_V3.every((b, i) => header![i] === b) ||
            fields.chunkSize !== chunkSize ||
            fields.totalChunks !== totalChunks
        ) {
            throw new Error("VSC3: header does not match the data being encrypted");
        }
    } else {
        header = buildVSC3Header(chunkSize, totalChunks);
    }
    for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, plaintext.byteLength);
        const aad = vsc3ChunkAad(header, i, i === totalChunks - 1);
        const { iv, ciphertext } = await engine.encrypt(plaintext.slice(start, end), aad);
        yield { iv, ciphertext, index: i, totalChunks, header };
    }
}

/** Encrypt an ArrayBuffer into VSC3 chunked format. */
export async function encryptChunked(
    plaintext: ArrayBuffer,
    engine: CryptoProvider,
    chunkSize: number,
): Promise<ArrayBuffer> {
    const { ivSize } = engine;
    const totalChunks = Math.max(1, Math.ceil(plaintext.byteLength / chunkSize));
    const outputSize = calculateVSC3Size(plaintext.byteLength, chunkSize, ivSize, engine.tagSize);
    const output = new Uint8Array(outputSize);

    const header = buildVSC3Header(chunkSize, totalChunks);
    output.set(header, 0);
    let writeOffset = HEADER_SIZE_V3;

    for await (const { iv, ciphertext } of encryptChunks(plaintext, engine, chunkSize, header)) {
        output.set(iv, writeOffset);
        writeOffset += ivSize;
        output.set(new Uint8Array(ciphertext), writeOffset);
        writeOffset += ciphertext.byteLength;
    }

    return output.buffer.slice(output.byteOffset, output.byteOffset + writeOffset);
}

/**
 * Decrypt chunked-format data (VSC3, or the older VSC2) back to plaintext.
 *
 * VSC2 files written before VSC3 still open; their chunks carry no position,
 * so only the chunk contents are authenticated for them.
 */
export async function decryptChunked(
    data: ArrayBuffer,
    engine: CryptoProvider,
): Promise<ArrayBuffer> {
    const v3 = hasMagic(data, CHUNK_MAGIC_V3);
    const tag = v3 ? "VSC3" : "VSC2";
    const headerSize = v3 ? HEADER_SIZE_V3 : HEADER_SIZE;
    if (data.byteLength < headerSize) {
        throw new DecryptionError(`${tag}: data too short for header`, "format");
    }
    if (!v3 && !hasMagic(data, CHUNK_MAGIC)) {
        throw new DecryptionError("VSC2: invalid magic bytes", "format");
    }

    const header = new Uint8Array(data.slice(0, headerSize));
    const { chunkSize, totalChunks } = readHeaderFields(header);

    if (chunkSize === 0) throw new DecryptionError(`${tag}: chunkSize is 0`, "format");
    if (totalChunks === 0) throw new DecryptionError(`${tag}: totalChunks is 0`, "format");

    const { ivSize, tagSize } = engine;
    // Check the header against the data before allocating from it: a corrupt header
    // (or a truncated download) asked for up to 16 EiB here and crashed with a
    // RangeError, or tried to allocate gigabytes on a phone.
    const minSize = headerSize + (totalChunks - 1) * (ivSize + chunkSize + tagSize) + ivSize + tagSize;
    if (data.byteLength < minSize) {
        throw new DecryptionError(`${tag}: data shorter than its header declares`, "format");
    }
    const maxPlaintextSize = Math.min(
        totalChunks * chunkSize,
        data.byteLength - headerSize - totalChunks * (ivSize + tagSize),
    );
    const output = new Uint8Array(maxPlaintextSize);
    let writeOffset = 0;
    let readOffset = headerSize;

    for (let i = 0; i < totalChunks; i++) {
        if (readOffset + ivSize > data.byteLength) {
            throw new DecryptionError(`${tag}: truncated data at chunk ${i} (missing IV)`, "format", i);
        }

        const iv = new Uint8Array(data.slice(readOffset, readOffset + ivSize));
        readOffset += ivSize;

        const isLast = i === totalChunks - 1;
        const ciphertextSize = isLast ? data.byteLength - readOffset : chunkSize + tagSize;

        if (ciphertextSize < tagSize) {
            throw new DecryptionError(`${tag}: truncated ciphertext at chunk ${i}`, "format", i);
        }
        if (readOffset + ciphertextSize > data.byteLength) {
            throw new DecryptionError(
                `${tag}: truncated data at chunk ${i} (missing ciphertext)`,
                "format",
                i,
            );
        }

        const ciphertext = data.slice(readOffset, readOffset + ciphertextSize);
        readOffset += ciphertextSize;

        let decrypted: ArrayBuffer;
        try {
            decrypted = v3
                ? await engine.decrypt(ciphertext, iv, vsc3ChunkAad(header, i, isLast))
                : await engine.decrypt(ciphertext, iv);
        } catch (e) {
            if (e instanceof DecryptionError) throw e;
            throw new DecryptionError(`${tag}: decryption failed at chunk ${i}`, "authentication", i);
        }
        if (decrypted.byteLength > output.byteLength - writeOffset) {
            throw new DecryptionError(`${tag}: chunk ${i} is larger than declared`, "format", i);
        }
        output.set(new Uint8Array(decrypted), writeOffset);
        writeOffset += decrypted.byteLength;
    }

    return output.buffer.slice(output.byteOffset, output.byteOffset + writeOffset);
}
