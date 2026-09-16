import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeMessage } from '../lib/types';

describe('background activation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('reports pending activation and tears it down before readiness completes', async () => {
    vi.useFakeTimers();
    let onMessage!: (message: RuntimeMessage, sender: object) => Promise<unknown>;
    let finishActivation!: (value: { ready: boolean }) => void;
    const event = { addListener: vi.fn() };
    const sendMessage = vi.fn(async (_tabId: number, message: RuntimeMessage) => {
      if (message.type === 'BG_PROBE') return { injected: true };
      if (message.type === 'BG_SET_SESSION')
        return new Promise((resolve) => {
          finishActivation = resolve;
        });
      if (message.type === 'BG_PING_STATE') return { active: false };
      return { ok: true };
    });
    vi.stubGlobal('defineBackground', (initialize: () => void) => initialize());
    vi.stubGlobal('browser', {
      runtime: {
        onMessage: {
          addListener: (listener: typeof onMessage) => {
            onMessage = listener;
          },
        },
      },
      tabs: { query: async () => [{ id: 1 }], sendMessage, onRemoved: event, onUpdated: event, onActivated: event },
      scripting: { executeScript: vi.fn(), insertCSS: vi.fn(), removeCSS: vi.fn() },
      storage: {
        session: { get: async () => ({}), set: vi.fn(), remove: vi.fn() },
        sync: { get: async () => ({}) },
        local: { get: async () => ({}) },
      },
    });
    await import('../entrypoints/background');
    expect(await onMessage({ type: 'UI_SET_READING_MODE', enabled: true }, {})).toMatchObject({ enabled: true });
    expect(await onMessage({ type: 'UI_GET_STATE' }, {})).toMatchObject({ tab: { enabled: true } });
    expect(await onMessage({ type: 'UI_SET_READING_MODE', enabled: false }, {})).toMatchObject({ enabled: false });
    expect(sendMessage).toHaveBeenCalledWith(1, { type: 'BG_TEARDOWN' });
    expect(browser.scripting.removeCSS).toHaveBeenCalled();
    finishActivation({ ready: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(await onMessage({ type: 'UI_GET_STATE' }, {})).toMatchObject({ tab: { enabled: false } });
    expect(sendMessage).toHaveBeenCalledWith(1, { type: 'BG_PING_STATE' });
  });
});
