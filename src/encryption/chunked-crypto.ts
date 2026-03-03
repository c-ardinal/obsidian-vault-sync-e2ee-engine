import { DecryptionError } from "./errors";

/** VSC2 magic bytes: "VSC2" (Vault-Sync Chunked v2) */
export const CHUNK_MAGIC = new Uint8Array([0x56, 0x53, 0x43, 0x32]);

export const HEADER_SIZE = 12; // magic(4) + chunkSize(4) + totalChunks(4)

/** Minimal engine interface needed for chunked crypto operations. */
export interface CryptoProvider {
    encrypt(data: ArrayBuffer): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }>;
    decrypt(ciphertext: ArrayBuffer, iv: Uint8Array): Promise<ArrayBuffer>;
    readonly ivSize: number;
    readonly tagSize: number;
}

/** Check whether an ArrayBuffer starts with the VSC2 magic header. */
export function isChunkedFormat(data: ArrayBuffer): boolean {
    if (data.byteLength < 4) return false;
    const view = new Uint8Array(data, 0, 4);
    return (
        view[0] === CHUNK_MAGIC[0] &&
        view[1] === CHUNK_MAGIC[1] &&
        view[2] === CHUNK_MAGIC[2] &&
        view[3] === CHUNK_MAGIC[3]
    );
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

/** Iterate over plaintext chunks, encrypting each one independently. */
export async function* encryptChunks(
    plaintext: ArrayBuffer,
    engine: CryptoProvider,
    chunkSize: number,
): AsyncGenerator<{ iv: Uint8Array; ciphertext: ArrayBuffer; index: number; totalChunks: number }> {
    const totalChunks = Math.max(1, Math.ceil(plaintext.byteLength / chunkSize));
    for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, plaintext.byteLength);
        const { iv, ciphertext } = await engine.encrypt(plaintext.slice(start, end));
        yield { iv, ciphertext, index: i, totalChunks };
    }
}

/** Encrypt an ArrayBuffer into VSC2 chunked format. */
export async function encryptChunked(
    plaintext: ArrayBuffer,
    engine: CryptoProvider,
    chunkSize: number,
): Promise<ArrayBuffer> {
    const { ivSize } = engine;
    const totalChunks = Math.max(1, Math.ceil(plaintext.byteLength / chunkSize));
    const outputSize = calculateVSC2Size(plaintext.byteLength, chunkSize, ivSize, engine.tagSize);
    const output = new Uint8Array(outputSize);

    output.set(buildVSC2Header(chunkSize, totalChunks), 0);
    let writeOffset = HEADER_SIZE;

    for await (const { iv, ciphertext } of encryptChunks(plaintext, engine, chunkSize)) {
        output.set(iv, writeOffset);
        writeOffset += ivSize;
        output.set(new Uint8Array(ciphertext), writeOffset);
        writeOffset += ciphertext.byteLength;
    }

    return output.buffer.slice(output.byteOffset, output.byteOffset + writeOffset);
}

/** Decrypt a VSC2 chunked-format ArrayBuffer back to plaintext. */
export async function decryptChunked(
    data: ArrayBuffer,
    engine: CryptoProvider,
): Promise<ArrayBuffer> {
    if (data.byteLength < HEADER_SIZE) {
        throw new DecryptionError("VSC2: data too short for header", "format");
    }

    const view = new DataView(data, 0, HEADER_SIZE);
    const magic = new Uint8Array(data, 0, 4);
    if (
        magic[0] !== CHUNK_MAGIC[0] ||
        magic[1] !== CHUNK_MAGIC[1] ||
        magic[2] !== CHUNK_MAGIC[2] ||
        magic[3] !== CHUNK_MAGIC[3]
    ) {
        throw new DecryptionError("VSC2: invalid magic bytes", "format");
    }

    const chunkSize = view.getUint32(4, true);
    const totalChunks = view.getUint32(8, true);

    if (chunkSize === 0) throw new DecryptionError("VSC2: chunkSize is 0", "format");
    if (totalChunks === 0) throw new DecryptionError("VSC2: totalChunks is 0", "format");

    const { ivSize, tagSize } = engine;
    const maxPlaintextSize = totalChunks * chunkSize;
    const output = new Uint8Array(maxPlaintextSize);
    let writeOffset = 0;
    let readOffset = HEADER_SIZE;

    for (let i = 0; i < totalChunks; i++) {
        if (readOffset + ivSize > data.byteLength) {
            throw new DecryptionError(
                `VSC2: truncated data at chunk ${i} (missing IV)`,
                "format",
                i,
            );
        }

        const iv = new Uint8Array(data.slice(readOffset, readOffset + ivSize));
        readOffset += ivSize;

        let ciphertextSize: number;
        if (i < totalChunks - 1) {
            ciphertextSize = chunkSize + tagSize;
        } else {
            ciphertextSize = data.byteLength - readOffset;
        }

        if (ciphertextSize < tagSize) {
            throw new DecryptionError(`VSC2: truncated ciphertext at chunk ${i}`, "format", i);
        }

        if (readOffset + ciphertextSize > data.byteLength) {
            throw new DecryptionError(
                `VSC2: truncated data at chunk ${i} (missing ciphertext)`,
                "format",
                i,
            );
        }

        const ciphertext = data.slice(readOffset, readOffset + ciphertextSize);
        readOffset += ciphertextSize;

        let decrypted: ArrayBuffer;
        try {
            decrypted = await engine.decrypt(ciphertext, iv);
        } catch (e) {
            if (e instanceof DecryptionError) throw e;
            throw new DecryptionError(`VSC2: decryption failed at chunk ${i}`, "authentication", i);
        }
        output.set(new Uint8Array(decrypted), writeOffset);
        writeOffset += decrypted.byteLength;
    }

    return output.buffer.slice(output.byteOffset, output.byteOffset + writeOffset);
}
