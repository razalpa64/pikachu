/**
 * A very small ZIP reader and writer — just enough for `.jsdos` bundles.
 *
 * Why not a library: this code runs in two very different places (a Node importer
 * and the browser's upload form), and the only thing either needs is "walk the
 * central directory" and "write a store-only archive". A dependency for that
 * would be more code than the thing it replaces, and one more package to trust
 * with a file that arrives from the internet.
 *
 * What it deliberately does *not* do: decompress anything. A bundle's entries are
 * read for their **names and sizes**, which is what a safety check needs — path
 * traversal, absurd entry counts, a decompression bomb announced by its own
 * header. Actually unpacking game data is js-dos's job, inside its sandbox.
 */

export interface ZipEntry {
  name: string;
  /** Uncompressed size, from the central directory. */
  size: number;
  compressedSize: number;
  /** 0 = stored, 8 = deflate. */
  method: number;
  crc32: number;
  isDirectory: boolean;
  /**
   * Where this entry's local header sits in the file.
   *
   * Needed because a zip written to a stream (which is what most bundlers do,
   * and what a `.jsdos` produced by js-dos looks like) leaves the sizes in the
   * local header as zero and puts them in a trailing data descriptor instead.
   * Walking local headers one after another — the obvious way to find an entry —
   * cannot get past the first of those, so the central directory, which always
   * knows the real offsets, is the map.
   */
  localOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/**
 * Walk the central directory.
 *
 * Returns `null` when this is not a ZIP at all, and `[]`-with-a-reason via
 * `inspect` when it is one but unusable. Reads backwards from the end to find the
 * end-of-central-directory record, whose comment may be up to 64 KB.
 */
export function readZipDirectory(bytes: Uint8Array): ZipEntry[] | null {
  if (bytes.length < 22) return null;
  const earliest = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= earliest; i -= 1) {
    if (u32(bytes, i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const count = u16(bytes, eocd + 10);
  const cdOffset = u32(bytes, eocd + 16);
  if (cdOffset >= bytes.length) return null;

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > bytes.length || u32(bytes, p) !== SIG_CENTRAL) return null;
    const method = u16(bytes, p + 10);
    const crc32 = u32(bytes, p + 16);
    const compressedSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const nameStart = p + 46;
    if (nameStart + nameLen > bytes.length) return null;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
    const localOffset = u32(bytes, p + 42);
    entries.push({ name, size, compressedSize, method, crc32, isDirectory: name.endsWith('/'), localOffset });
    p = nameStart + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Read one entry, by name.
 *
 * Only two methods exist in practice for a `.jsdos` bundle — stored and deflate —
 * and `DecompressionStream('deflate-raw')` is available in every browser this
 * site supports as well as in Node, so one small entry (the config) can be read
 * without a ZIP library. Returns `null` when the entry is absent or the archive
 * cannot be parsed; treats an unknown compression method as absent rather than
 * throwing, because the caller is a validator.
 */
export async function readZipEntry(bytes: Uint8Array, wanted: string): Promise<Uint8Array | null> {
  const entries = readZipDirectory(bytes);
  if (!entries) return null;
  const entry = entries.find((e) => e.name.replace(/^\.\//, '') === wanted);
  if (!entry) return null;

  /* Straight to the entry's own local header, using the offset the central
     directory recorded — not a walk from the top of the file. See `localOffset`
     for why: a streamed archive stores 0 in the local header's size fields, and
     a walk that trusts them cannot even find the second entry. */
  const offset = entry.localOffset;
  if (offset + 30 > bytes.length || u32(bytes, offset) !== SIG_LOCAL) return null;
  const nameLen = u16(bytes, offset + 26);
  const extraLen = u16(bytes, offset + 28);
  const dataStart = offset + 30 + nameLen + extraLen;
  /* The central directory's sizes are authoritative; the local header's may be
     zeroed when a data descriptor follows the data. */
  const compressedSize = entry.compressedSize || u32(bytes, offset + 18);
  if (!compressedSize || dataStart + compressedSize > bytes.length) return null;

  const raw = bytes.subarray(dataStart, dataStart + compressedSize);
  if (entry.method === 0) return raw.slice();
  if (entry.method !== 8) return null;
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/* ------------------------------------------------------------------ writer */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipFileInput {
  name: string;
  data: Uint8Array;
}

/**
 * Build a store-only ZIP (method 0, no compression).
 *
 * Deliberate: a bundle we generate ourselves is a handful of small files, and
 * storing them verbatim means the archive can be diffed and audited by hand. DOS
 * game data an admin uploads is not built here — it arrives already packaged.
 */
export function buildZip(files: ZipFileInput[], date = new Date(2020, 0, 1)): Uint8Array {
  const DOS_TIME = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const DOS_DATE = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    const local = new Uint8Array(30 + name.length + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true);      // version needed
    lv.setUint16(6, 0x0800, true);  // UTF-8 names
    lv.setUint16(8, 0, true);       // stored
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(file.data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, 20, true);      // version made by
    cv.setUint16(6, 20, true);      // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + eocd.length);
  let p = 0;
  for (const chunk of [...locals, ...centrals, eocd]) { out.set(chunk, p); p += chunk.length; }
  return out;
}
