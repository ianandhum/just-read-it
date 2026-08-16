import { describe, it, expect } from 'vitest';
import { estimateReadingMs } from '../../lib/reading/reading_time';

describe('estimateReadingMs', () => {
  it('returns the minimum for empty input', () => {
    expect(estimateReadingMs('')).toBe(600);
  });

  it('returns the minimum for whitespace-only input', () => {
    expect(estimateReadingMs('   \n\t  ')).toBe(600);
  });

  it('returns the minimum for a single short word', () => {
    expect(estimateReadingMs('Go.')).toBe(600);
  });

  it('scales with word count at 400ms/word', () => {
    // 10 words -> 4000ms (within the clamp window).
    const ten = 'one two three four five six seven eight nine ten';
    expect(estimateReadingMs(ten)).toBe(4000);
  });

  it('clamps very short multi-word sentences to the minimum', () => {
    // 1 word -> 400ms, clamped up to 600ms.
    expect(estimateReadingMs('Hello.')).toBe(600);
    // 2 words -> 800ms.
    expect(estimateReadingMs('Hello world.')).toBe(800);
  });

  it('does not cap very long sentences', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
    expect(estimateReadingMs(fifty)).toBe(20000);
  });

  it('is deterministic for the same input', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    expect(estimateReadingMs(text)).toBe(estimateReadingMs(text));
  });

  it('counts hyphenated tokens as single words', () => {
    // "state-of-the-art" is one whitespace-delimited token -> 1 word.
    expect(estimateReadingMs('state-of-the-art')).toBe(600);
  });

  it('ignores leading/trailing whitespace when counting', () => {
    expect(estimateReadingMs('  one two  ')).toBe(800); // 2 words -> 800
  });
});
