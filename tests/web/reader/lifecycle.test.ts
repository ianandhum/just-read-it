import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReaderLifecycle, type ReaderLifecycleContext } from '../../../lib/web/reader/lifecycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function context(overrides: Partial<ReaderLifecycleContext> = {}): ReaderLifecycleContext {
  let tornDown = false;
  let readerEnabled = false;
  let activationTransition = Promise.resolve();
  let activationTimer: ReturnType<typeof setTimeout> | null = null;
  let unwatchUrl: (() => void) | null = null;
  let sessionToken: string | null = null;
  return {
    get tornDown() {
      return tornDown;
    },
    setTornDown: (value) => {
      tornDown = value;
    },
    get readerEnabled() {
      return readerEnabled;
    },
    setReaderEnabled: (value) => {
      readerEnabled = value;
    },
    get activationGeneration() {
      return 0;
    },
    incrementActivationGeneration: vi.fn(),
    get activationTimer() {
      return activationTimer;
    },
    setActivationTimer: (timer) => {
      activationTimer = timer;
    },
    get activationTransition() {
      return activationTransition;
    },
    setActivationTransition: (transition) => {
      activationTransition = transition;
    },
    get unwatchUrl() {
      return unwatchUrl;
    },
    setUnwatchUrl: (value) => {
      unwatchUrl = value;
    },
    get sessionToken() {
      return sessionToken;
    },
    setSessionToken: (value) => {
      sessionToken = value;
    },
    isReaderReady: () => false,
    activate: vi.fn(async () => 0),
    teardownSession: vi.fn(async () => {}),
    deactivateSession: vi.fn(async () => {}),
    flushSave: vi.fn(),
    pauseTimeTracking: vi.fn(),
    resumeTimeTracking: vi.fn(),
    pauseGuidedPlayback: vi.fn(),
    resumeGuidedPlayback: vi.fn(),
    stopSpeech: vi.fn(),
    isReadingAloud: () => false,
    updateWakeLock: vi.fn(async () => {}),
    releaseWakeLock: vi.fn(async () => {}),
    applySettings: vi.fn(),
    setStatus: vi.fn(),
    reportState: vi.fn(),
    resetPage: vi.fn(),
    contentCandidates: () => [],
    handleRuntimeMessage: vi.fn(),
    setWindowActive: vi.fn(),
    ...overrides,
  };
}

describe('reader lifecycle', () => {
  let onRuntimeMessage: ((message: unknown) => unknown) | undefined;

  beforeEach(() => {
    vi.stubGlobal('browser', {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => {
            onRuntimeMessage = listener;
          }),
          removeListener: vi.fn(),
        },
      },
      storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('disables immediately while an activation is pending', async () => {
    const pendingActivation = deferred<void>();
    const state = context({ activationTransition: pendingActivation.promise });
    state.setReaderEnabled(true);
    const lifecycle = createReaderLifecycle(state);
    lifecycle.install();

    const reply = onRuntimeMessage!({ type: 'BG_TEARDOWN' }) as Promise<{ ok: true }>;
    await expect(reply).resolves.toEqual({ ok: true });
    expect(state.flushSave).toHaveBeenCalledOnce();
    expect(state.deactivateSession).toHaveBeenCalledOnce();
    expect(state.releaseWakeLock).toHaveBeenCalledOnce();
    expect(state.readerEnabled).toBe(false);

    pendingActivation.resolve();
  });

  it('only activates after receiving a background session', async () => {
    const activate = vi.fn(async () => 3);
    const state = context({ activate, isReaderReady: () => true });
    const lifecycle = createReaderLifecycle(state);
    lifecycle.install();

    await Promise.resolve();
    expect(activate).not.toHaveBeenCalled();

    const reply = onRuntimeMessage!({ type: 'BG_SET_SESSION', token: 'session' }) as Promise<{ ready: boolean }>;
    await Promise.resolve();
    await Promise.resolve();
    await expect(reply).resolves.toEqual({ ready: true });
    expect(state.readerEnabled).toBe(true);
    expect(activate).toHaveBeenCalledOnce();
  });

  it('does not restore navigation status after disable', async () => {
    const state = context();
    state.setReaderEnabled(true);
    const lifecycle = createReaderLifecycle(state);
    lifecycle.handleUrlChange(location.href);
    await Promise.resolve();

    await lifecycle.deactivate();
    await Promise.resolve();

    expect(state.setStatus).not.toHaveBeenCalledWith('Loading new page...');
    expect(state.setStatus).not.toHaveBeenCalledWith('Preparing new page...');
  });

  it('reports disabled state directly from the controls lifecycle', async () => {
    const state = context();
    state.setReaderEnabled(true);
    const lifecycle = createReaderLifecycle(state);

    await lifecycle.deactivate();

    expect(state.readerEnabled).toBe(false);
    expect(state.reportState).toHaveBeenCalledWith(false);
    expect(state.deactivateSession).toHaveBeenCalledOnce();
  });

  it('releases the wake lock and pauses reading time when the document becomes hidden', () => {
    const state = context();
    state.setReaderEnabled(true);
    const lifecycle = createReaderLifecycle(state);
    lifecycle.install();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    document.dispatchEvent(new Event('visibilitychange'));

    expect(state.pauseTimeTracking).toHaveBeenCalledOnce();
    expect(state.pauseGuidedPlayback).toHaveBeenCalledOnce();
    expect(state.stopSpeech).toHaveBeenCalledOnce();
    expect(state.releaseWakeLock).toHaveBeenCalledOnce();
  });

  it('keeps narration running when the document becomes hidden', () => {
    const state = context({ isReadingAloud: () => true });
    state.setReaderEnabled(true);
    const lifecycle = createReaderLifecycle(state);
    lifecycle.install();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    document.dispatchEvent(new Event('visibilitychange'));

    expect(state.pauseTimeTracking).toHaveBeenCalledOnce();
    expect(state.pauseGuidedPlayback).toHaveBeenCalledOnce();
    expect(state.stopSpeech).not.toHaveBeenCalled();
    expect(state.releaseWakeLock).toHaveBeenCalledOnce();
  });

  it('resumes guided playback when the document becomes visible again', () => {
    const state = context();
    state.setReaderEnabled(true);
    const lifecycle = createReaderLifecycle(state);
    lifecycle.install();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

    document.dispatchEvent(new Event('visibilitychange'));

    expect(state.resumeTimeTracking).toHaveBeenCalledOnce();
    expect(state.resumeGuidedPlayback).toHaveBeenCalledOnce();
  });

  it('cleanup removes the visibilitychange listener', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const state = context();
    state.setReaderEnabled(true);
    const lifecycle = createReaderLifecycle(state);
    lifecycle.install();
    const handler = addSpy.mock.calls.find(([type]) => type === 'visibilitychange')?.[1];
    expect(handler).toBeDefined();

    await lifecycle.cleanup();

    expect(removeSpy.mock.calls.some(([type, listener]) => type === 'visibilitychange' && listener === handler)).toBe(true);
  });

  it('resumes guided playback after an initially hidden document becomes visible', () => {
    const state = context();
    state.setReaderEnabled(true);
    const lifecycle = createReaderLifecycle(state);
    lifecycle.install();
    const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

    document.dispatchEvent(new Event('visibilitychange'));

    expect(state.resumeGuidedPlayback).toHaveBeenCalledOnce();
    visibilityState.mockRestore();
  });
});
