import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watchUrlChanges } from '../lib/history_watch';

const BASE = 'https://example.com/start';

// happy-dom's History.pushState/replaceState are no-op stubs (v14), so tests
// simulate same-document URL changes via happyDOM.setURL + a synthetic event
// (real browsers update the URL and only then fire popstate/hashchange;
// pushState/replaceState fire no events at all).
function setUrl(url: string): void {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
}

describe('watchUrlChanges', () => {
  beforeEach(() => {
    setUrl(BASE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('detects an eventless URL change (pushState/replaceState) via polling', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const unwatch = watchUrlChanges(onChange, { pollMs: 100 });

    setUrl('https://example.com/next'); // no event, like pushState
    expect(onChange).not.toHaveBeenCalled(); // nothing synchronous

    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('https://example.com/next');
    unwatch();
  });

  it('detects back/forward via popstate immediately, without a poll tick', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const unwatch = watchUrlChanges(onChange, { pollMs: 100 });

    setUrl('https://example.com/two'); // browser updates URL first...
    window.dispatchEvent(new Event('popstate')); // ...then fires popstate

    expect(onChange).toHaveBeenCalledTimes(1); // no vi.advanceTimersByTime
    expect(onChange).toHaveBeenCalledWith('https://example.com/two');
    unwatch();
  });

  it('detects hash navigation via hashchange immediately', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const unwatch = watchUrlChanges(onChange, {
      pollMs: 100,
      normalize: (url) => url, // keep the fragment
    });

    setUrl('https://example.com/start#section');
    window.dispatchEvent(new Event('hashchange'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('https://example.com/start#section');
    unwatch();
  });

  it('ignores hash-only changes by default (same storage key)', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const unwatch = watchUrlChanges(onChange, { pollMs: 100 });

    setUrl('https://example.com/start#section');
    window.dispatchEvent(new Event('hashchange'));
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    unwatch();
  });

  it('does not fire twice for the same URL', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const unwatch = watchUrlChanges(onChange, { pollMs: 100 });

    setUrl('https://example.com/once');
    vi.advanceTimersByTime(100); // poll consumes the change
    window.dispatchEvent(new Event('popstate')); // late event for same nav
    expect(onChange).toHaveBeenCalledTimes(1);
    unwatch();
  });

  it('tracks successive navigations', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const unwatch = watchUrlChanges(onChange, { pollMs: 100 });

    setUrl('https://example.com/a1');
    vi.advanceTimersByTime(100);
    setUrl('https://example.com/a2');
    window.dispatchEvent(new Event('popstate'));

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, 'https://example.com/a1');
    expect(onChange).toHaveBeenNthCalledWith(2, 'https://example.com/a2');
    unwatch();
  });

  it('stops after unwatch', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const unwatch = watchUrlChanges(onChange, { pollMs: 100 });
    unwatch();

    setUrl('https://example.com/later');
    window.dispatchEvent(new Event('popstate'));
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
  });
});
