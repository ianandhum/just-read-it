import { describe, expect, it } from 'vitest';
import { formatDuration, formatSeconds } from '../lib/format';

describe('formatDuration', () => {
  it('formats durations below one hour in minutes', () => {
    expect(formatDuration(59 * 60_000)).toBe('59m');
  });

  it('formats durations of one hour or more in hours and minutes', () => {
    expect(formatDuration(90 * 60_000)).toBe('1h 30m');
  });

  it('formats fractional minutes without introducing seconds', () => {
    expect(formatDuration(2.5 * 60_000)).toBe('2m');
  });
});

describe('formatSeconds', () => {
  it('formats milliseconds as seconds with one decimal place', () => {
    expect(formatSeconds(650)).toBe('0.7s');
  });
});
