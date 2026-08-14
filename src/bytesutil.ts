export const INITIAL_CHUNK = 1024 * 1024;
export const SCROLL_CHUNK = 1024 * 1024;
export const MAX_LOADED = 32 * 1024 * 1024;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function base64ToBytes(data: string): Uint8Array {
  if (!data) {
    return new Uint8Array(0);
  }
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) {
    return right;
  }
  if (right.length === 0) {
    return left;
  }
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

function utf8SeqLen(lead: number): number {
  if (lead < 0x80) {
    return 1;
  }
  if ((lead & 0xe0) === 0xc0) {
    return 2;
  }
  if ((lead & 0xf0) === 0xe0) {
    return 3;
  }
  if ((lead & 0xf8) === 0xf0) {
    return 4;
  }
  return 0;
}

function isUtf8Seq(bytes: Uint8Array, start: number, len: number): boolean {
  if (len <= 1 || start + len > bytes.length) {
    return false;
  }
  for (let i = 1; i < len; i++) {
    if ((bytes[start + i] & 0xc0) !== 0x80) {
      return false;
    }
  }
  return true;
}

const utf8Dump = new TextDecoder("utf-8", { fatal: false });

export function dumpChars(bytes: Uint8Array): string[] {
  const out: string[] = Array.from({ length: bytes.length }, () => ".");
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x20 || b === 0x7f) {
      out[i] = ".";
      i += 1;
      continue;
    }
    if (b < 0x80) {
      out[i] = String.fromCharCode(b);
      i += 1;
      continue;
    }
    const len = utf8SeqLen(b);
    if (isUtf8Seq(bytes, i, len)) {
      out[i] = utf8Dump.decode(bytes.subarray(i, i + len));
      for (let k = 1; k < len; k++) {
        out[i + k] = " ";
      }
      i += len;
      continue;
    }
    out[i] = utf8Dump.decode(Uint8Array.of(b));
    i += 1;
  }
  return out;
}

export function padHex(value: number, width: number): string {
  return value.toString(16).padStart(width, "0");
}
