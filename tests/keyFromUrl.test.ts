import { describe, it, expect } from 'vitest';
import { keyFromUrl } from '../lib/storage';

describe('keyFromUrl', () => {
  it('is synchronous (returns a string, not a Promise)', () => {
    const key = keyFromUrl('https://example.com/a');
    expect(typeof key).toBe('string');
    expect(key).not.toBeInstanceOf(Promise);
  });

  it('prefixes with jri:', () => {
    expect(keyFromUrl('https://example.com/a')).toBe('jri:https://example.com/a');
  });

  it('strips the fragment but keeps the rest', () => {
    expect(keyFromUrl('https://example.com/a?q=1#section')).toBe('jri:https://example.com/a?q=1');
  });

  it('treats url with and without fragment as the same key', () => {
    const withFrag = keyFromUrl('https://example.com/article#section1');
    const noFrag = keyFromUrl('https://example.com/article');
    expect(withFrag).toBe(noFrag);
  });

  it('different fragments on the same path share a key', () => {
    expect(keyFromUrl('https://example.com/a#one')).toBe(keyFromUrl('https://example.com/a#two'));
  });

  it('preserves query strings', () => {
    expect(keyFromUrl('https://example.com/a?x=1&y=2#f')).toBe('jri:https://example.com/a?x=1&y=2');
  });

  it('falls back to prefix + raw for invalid URLs', () => {
    expect(keyFromUrl('not-a-url')).toBe('jri:not-a-url');
  });
});
