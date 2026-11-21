/** IFC GlobalId: 128 bit encoded as 22 characters of the IFC base64 alphabet. */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

export const IFC_GUID_PATTERN = /^[0-3][0-9A-Za-z_$]{21}$/;

/** Compress 16 bytes into an IFC GUID (first char carries 2 bits, the remaining 21 six each). */
export function bytesToIfcGuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error('IFC GUID needs 16 bytes');
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < 22; i++) {
    out = ALPHABET[Number(n & 63n)]! + out;
    n >>= 6n;
  }
  return out;
}

/** Random (UUID v4 style) IFC GUID. */
export function randomIfcGuid(): string {
  const b = new Uint8Array(16);
  (
    globalThis as unknown as { crypto: { getRandomValues(a: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  return bytesToIfcGuid(b);
}

/** Deterministic IFC GUID from a string key (4 × 32-bit FNV-1a variants, not cryptographic). */
export function hashIfcGuid(key: string): string {
  const b = new Uint8Array(16);
  for (let k = 0; k < 4; k++) {
    let h = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    h ^= h >>> 12;
    b[k * 4] = h >>> 24;
    b[k * 4 + 1] = (h >>> 16) & 255;
    b[k * 4 + 2] = (h >>> 8) & 255;
    b[k * 4 + 3] = h & 255;
  }
  return bytesToIfcGuid(b);
}

/** GUID factory: deterministic when a seed is given (stable across re-exports), random otherwise. */
export function guidFactory(seed?: string): (key: string) => string {
  if (seed === undefined) return () => randomIfcGuid();
  const used = new Set<string>();
  return (key) => {
    let g = hashIfcGuid(`${seed}|${key}`);
    for (let i = 1; used.has(g); i++) g = hashIfcGuid(`${seed}|${key}|${i}`);
    used.add(g);
    return g;
  };
}
