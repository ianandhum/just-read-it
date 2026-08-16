import type { ReadRange } from './types';

const SHARED_PROGRESS_PREFIX = 'jri.v2.';
const LEGACY_SHARED_PROGRESS_PREFIX = 'jri1.';
const MAX_SHARED_PROGRESS_LENGTH = 16_384;
const BINARY_SHARED_PROGRESS_VERSION = 2;

export interface SharedProgress {
  total: number;
  readIds: number[];
  currentId: number | null;
}

function toBase64Url(value: string): string {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string | null {
  try {
    if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
    const base64 = value
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    return atob(base64);
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return toBase64Url(binary);
}

function base64UrlToBytes(value: string): Uint8Array | null {
  const binary = fromBase64Url(value);
  if (binary === null) return null;
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function writeVarint(value: number, bytes: number[]): boolean {
  if (!Number.isSafeInteger(value) || value < 0) return false;
  while (value >= 0x80) {
    bytes.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  bytes.push(value);
  return true;
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; nextOffset: number } | null {
  let value = 0;
  let multiplier = 1;
  for (let count = 0; count < 8 && offset < bytes.length; count++, offset++) {
    const byte = bytes[offset]!;
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) return null;
    if ((byte & 0x80) === 0) return { value, nextOffset: offset + 1 };
    multiplier *= 0x80;
  }
  return null;
}

function encodeBinarySharedProgress(progress: SharedProgress): string {
  const ranges = readIdsToRanges(progress.readIds, progress.total);
  const currentId =
    Number.isInteger(progress.currentId) && progress.currentId !== null && progress.currentId >= 0 && progress.currentId < progress.total
      ? progress.currentId + 1
      : 0;
  const bytes = [BINARY_SHARED_PROGRESS_VERSION];
  writeVarint(progress.total, bytes);
  writeVarint(currentId, bytes);
  writeVarint(ranges.length, bytes);
  let previousEnd = 0;
  for (const [start, length] of ranges) {
    writeVarint(start - previousEnd, bytes);
    writeVarint(length, bytes);
    previousEnd = start + length;
  }
  return bytesToBase64Url(Uint8Array.from(bytes));
}

function decodeBinarySharedProgress(encoded: string): SharedProgress | null {
  const bytes = base64UrlToBytes(encoded);
  if (!bytes || bytes[0] !== BINARY_SHARED_PROGRESS_VERSION) return null;
  let offset = 1;
  const total = readVarint(bytes, offset);
  if (!total || total.value < 0) return null;
  offset = total.nextOffset;
  const current = readVarint(bytes, offset);
  if (!current || current.value > total.value) return null;
  offset = current.nextOffset;
  const rangeCount = readVarint(bytes, offset);
  if (!rangeCount || rangeCount.value > total.value) return null;
  offset = rangeCount.nextOffset;
  const ranges: ReadRange[] = [];
  let previousEnd = 0;
  for (let index = 0; index < rangeCount.value; index++) {
    const delta = readVarint(bytes, offset);
    if (!delta) return null;
    offset = delta.nextOffset;
    const length = readVarint(bytes, offset);
    if (!length || length.value < 1) return null;
    offset = length.nextOffset;
    const start = previousEnd + delta.value;
    if (!Number.isSafeInteger(start) || start + length.value > total.value) return null;
    ranges.push([start, length.value]);
    previousEnd = start + length.value;
  }
  if (offset !== bytes.length) return null;
  return { total: total.value, currentId: current.value === 0 ? null : current.value - 1, readIds: rangesToReadIds(ranges, total.value) };
}

export function readIdsToRanges(readIds: number[], total: number): ReadRange[] {
  const ids = [...new Set(readIds)].filter((id) => Number.isInteger(id) && id >= 0 && id < total).sort((a, b) => a - b);
  const ranges: ReadRange[] = [];
  for (const id of ids) {
    const previous = ranges[ranges.length - 1];
    if (previous && previous[0] + previous[1] === id) {
      previous[1]++;
    } else {
      ranges.push([id, 1]);
    }
  }
  return ranges;
}

export function rangesToReadIds(ranges: ReadRange[], total: number): number[] {
  const ids: number[] = [];
  for (const [start, length] of ranges) {
    for (let offset = 0; offset < length && start + offset < total; offset++) ids.push(start + offset);
  }
  return ids;
}

export function encodeSharedProgress(progress: SharedProgress): string {
  return `${SHARED_PROGRESS_PREFIX}${encodeBinarySharedProgress(progress)}`;
}

export function decodeSharedProgress(hash: string): SharedProgress | null {
  const prefix = [SHARED_PROGRESS_PREFIX, LEGACY_SHARED_PROGRESS_PREFIX].find((candidate) => hash.startsWith(`#${candidate}`));
  if (!prefix) return null;
  const encoded = hash.slice(prefix.length + 1);
  if (encoded.length === 0 || encoded.length > MAX_SHARED_PROGRESS_LENGTH) return null;
  if (prefix === SHARED_PROGRESS_PREFIX) {
    const binary = decodeBinarySharedProgress(encoded);
    if (binary) return binary;
  }
  const decoded = fromBase64Url(encoded);
  if (!decoded) return null;
  try {
    const value: unknown = JSON.parse(decoded);
    if (!Array.isArray(value) || value.length !== 3) return null;
    const [total, currentId, rawRanges] = value;
    if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(rawRanges)) return null;
    const ranges: ReadRange[] = [];
    let previousEnd = 0;
    for (const rawRange of rawRanges) {
      if (!Array.isArray(rawRange) || rawRange.length !== 2) return null;
      const [start, length] = rawRange;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(length) ||
        start < 0 ||
        length < 1 ||
        start < previousEnd ||
        start + length > total
      ) {
        return null;
      }
      ranges.push([start, length]);
      previousEnd = start + length;
    }
    if (currentId !== null && (!Number.isSafeInteger(currentId) || currentId < 0 || currentId >= total)) return null;
    return { total, currentId, readIds: rangesToReadIds(ranges, total) };
  } catch {
    return null;
  }
}

export function sharedProgressFromUrl(url: string): SharedProgress | null {
  try {
    return decodeSharedProgress(new URL(url).hash);
  } catch {
    return null;
  }
}

export function removeSharedProgressFromUrl(url: string): string {
  try {
    const next = new URL(url);
    if (!decodeSharedProgress(next.hash)) return url;
    next.hash = '';
    return next.href;
  } catch {
    return url;
  }
}

export function shareProgressUrl(url: string, progress: SharedProgress): string | null {
  try {
    const next = new URL(url);
    // The progress payload lives in the fragment so it is not sent to the
    // article's server. Replacing an existing page anchor lets every article
    // produce a continuation link, including pages with #comments-style URLs.
    next.hash = encodeSharedProgress(progress);
    return next.href;
  } catch {
    return null;
  }
}
