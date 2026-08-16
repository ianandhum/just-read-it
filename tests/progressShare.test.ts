import { describe, expect, it } from 'vitest';
import {
  decodeSharedProgress,
  encodeSharedProgress,
  rangesToReadIds,
  readIdsToRanges,
  removeSharedProgressFromUrl,
  shareProgressUrl,
  sharedProgressFromUrl,
} from '../lib/progress_share';

describe('progress sharing', () => {
  it('compacts continuous and duplicate read IDs into ranges', () => {
    expect(readIdsToRanges([7, 1, 2, 3, 3, 9], 10)).toEqual([
      [1, 3],
      [7, 1],
      [9, 1],
    ]);
  });

  it('expands ranges back into read IDs', () => {
    expect(
      rangesToReadIds(
        [
          [1, 3],
          [7, 1],
        ],
        10,
      ),
    ).toEqual([1, 2, 3, 7]);
  });

  it('round trips a compact versioned payload', () => {
    const encoded = encodeSharedProgress({ total: 12, readIds: [0, 1, 2, 8, 9], currentId: 8 });
    expect(encoded.startsWith('jri.v2.')).toBe(true);
    expect(decodeSharedProgress(`#${encoded}`)).toEqual({ total: 12, readIds: [0, 1, 2, 8, 9], currentId: 8 });
  });

  it('uses a shorter binary payload for new jri.v2 continuation links', () => {
    const progress = { total: 120, readIds: [...Array(18).keys(), 25, 26, 27, 28, 29, 30, 31, 40, 41, 42], currentId: 42 };
    const encoded = encodeSharedProgress(progress);
    const jsonPayload = btoa(JSON.stringify([120, 42, [[0, 18], [25, 7], [40, 3]]]))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');

    expect(encoded).toBe(`jri.v2.AngrAwASBwcIAw`);
    expect(encoded.length).toBeLessThan(`jri.v2.${jsonPayload}`.length);
  });

  it('reads previously generated JSON jri.v2 continuation links', () => {
    const previousV2 = 'https://example.com/article#jri.v2.WzIsMSxbWzEsMV1dXQ';
    expect(sharedProgressFromUrl(previousV2)).toEqual({ total: 2, readIds: [1], currentId: 1 });
  });

  it('reads and removes legacy jri1 continuation links', () => {
    const legacy = 'https://example.com/article#jri1.WzIsMSxbWzEsMV1dXQ';
    expect(sharedProgressFromUrl(legacy)).toEqual({ total: 2, readIds: [1], currentId: 1 });
    expect(removeSharedProgressFromUrl(legacy)).toBe('https://example.com/article');
  });

  it('reads progress from a URL and removes only the share fragment', () => {
    const url = `https://example.com/article?mode=reader#${encodeSharedProgress({ total: 2, readIds: [1], currentId: 1 })}`;
    expect(sharedProgressFromUrl(url)).toEqual({ total: 2, readIds: [1], currentId: 1 });
    expect(removeSharedProgressFromUrl(url)).toBe('https://example.com/article?mode=reader');
  });

  it('replaces an existing page fragment with the private continuation payload', () => {
    const progress = { total: 2, readIds: [1], currentId: 1 };
    const shared = shareProgressUrl('https://example.com/article#comments', progress);
    expect(shared).toContain('#jri.v2.');
    expect(shared).not.toContain('#comments');
    expect(shared && sharedProgressFromUrl(shared)).toEqual(progress);
  });

  it('rejects malformed, overlapping, and out-of-bounds ranges', () => {
    expect(decodeSharedProgress('#jri1.not-valid!')).toBeNull();
    const invalid = btoa(
      JSON.stringify([
        5,
        null,
        [
          [0, 3],
          [2, 1],
        ],
      ]),
    )
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    expect(decodeSharedProgress(`#jri1.${invalid}`)).toBeNull();
    const outOfBounds = btoa(JSON.stringify([5, null, [[4, 2]]]))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    expect(decodeSharedProgress(`#jri1.${outOfBounds}`)).toBeNull();
  });
});
