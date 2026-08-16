import { describe, it, expect } from 'vitest';
import { shouldMarkReadByMouse } from '../../lib/web/reader/helpers';

// Mouse-driven read rule (Guided Reading off; NOTES 2a):
//   read := coverage > 0.2  AND  ratio > 0.9
//
// `coverage` is how much of the sentence the pointer swept, measured from
// where it entered (not the absolute position) — see state.test.ts.
// A click also marks read, but that path lives in onClick, not here.
// Reaching the end (ratio > 0.9) alone is NOT enough — both must hold.

describe('shouldMarkReadByMouse', () => {
  it('marks read when >30% covered AND past the 97% mark', () => {
    expect(shouldMarkReadByMouse(0.41, 0.91)).toBe(true);
    expect(shouldMarkReadByMouse(1.0, 0.98)).toBe(true);
    expect(shouldMarkReadByMouse(1.0, 1.0)).toBe(true);
  });

  it('does not mark read at the 30% covered boundary (strict >)', () => {
    // 0.2 exactly is not "more than 30%".
    expect(shouldMarkReadByMouse(0.2, 0.98)).toBe(false);
    expect(shouldMarkReadByMouse(0.2, 1.0)).toBe(false);
  });

  it('does not mark read at the 0.9 end boundary (strict >)', () => {
    // ratio 0.9 exactly is not "past 90%".
    expect(shouldMarkReadByMouse(0.7, 0.9)).toBe(false);
    expect(shouldMarkReadByMouse(0.7, 0.91)).toBe(true);
  });

  it('does not mark read when only one of the two conditions holds', () => {
    // Enough covered but not at the end.
    expect(shouldMarkReadByMouse(0.9, 0.5)).toBe(false);
    // At the end but not enough covered.
    expect(shouldMarkReadByMouse(0.2, 0.99)).toBe(false);
    expect(shouldMarkReadByMouse(0.2, 1.0)).toBe(false);
  });

  it('reaching the very end alone is NOT a read (no >0.95 fallback)', () => {
    // The old inconsistent >0.95 rule is gone: a flick to the end with little
    // covered must not mark read.
    expect(shouldMarkReadByMouse(0.0, 0.8)).toBe(false);
    expect(shouldMarkReadByMouse(0.1, 1.0)).toBe(false);
    expect(shouldMarkReadByMouse(0.2, 0.99)).toBe(false);
  });

  it('does not mark read for early / mid-sentence positions', () => {
    expect(shouldMarkReadByMouse(0.0, 0.0)).toBe(false);
    expect(shouldMarkReadByMouse(0.1, 0.2)).toBe(false);
    expect(shouldMarkReadByMouse(0.2, 0.5)).toBe(false);
    expect(shouldMarkReadByMouse(0.59, 0.8)).toBe(false);
  });
});
