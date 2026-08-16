import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReaderMediaSession } from '../../../lib/web/reader/media_session';
import { createMediaSessionQuirk } from '../../../lib/web/reader/media_session_quirk';

describe('reader media session', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps transport controls and publishes playback state', () => {
    const handlers = new Map<string, () => void>();
    const mediaSession = {
      setActionHandler: vi.fn((action: string, handler: () => void) => handlers.set(action, handler)),
      playbackState: 'none',
      metadata: null,
    };
    vi.stubGlobal('navigator', { mediaSession });
    const play = vi.fn();
    const pause = vi.fn();
    const stop = vi.fn();
    const next = vi.fn();
    const previous = vi.fn();
    const session = createReaderMediaSession({ play, pause, stop, next, previous });

    session.update(true, 'An article', 'example.com', 'icon.png');
    handlers.get('play')!();
    handlers.get('pause')!();
    handlers.get('stop')!();
    handlers.get('nexttrack')!();
    handlers.get('previoustrack')!();

    expect(mediaSession.playbackState).toBe('playing');
    expect(play).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    expect(previous).toHaveBeenCalledOnce();
  });

  it('does nothing when Media Session is unavailable', () => {
    vi.stubGlobal('navigator', {});

    const session = createReaderMediaSession({ play: vi.fn(), pause: vi.fn(), stop: vi.fn(), next: vi.fn(), previous: vi.fn() });

    expect(() => session.update(true, 'An article', 'example.com', 'icon.png')).not.toThrow();
    expect(() => session.clear()).not.toThrow();
  });
});

describe('media session quirk', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps an inaudible, non-silent faux audio transport at the reading position', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const audio = document.createElement('audio');
    Object.assign(audio, { play, pause });
    vi.stubGlobal(
      'Audio',
      vi.fn(function () {
        return audio;
      }),
    );
    const createObjectURL = vi.fn<(...args: [Blob]) => string>(() => 'blob:transport');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });

    const quirk = createMediaSessionQuirk();
    await quirk.play(60_000, 15_000);
    expect(document.body.contains(audio)).toBe(true);
    expect(audio.currentTime).toBe(15);
    quirk.pause();
    quirk.seek(30_000);
    expect(audio.currentTime).toBe(30);
    quirk.stop();

    expect(Audio).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledTimes(2);
    const [source] = createObjectURL.mock.calls[0]!;
    const samples = new Uint8Array(await source.arrayBuffer()).slice(44);
    expect(samples.every((sample) => sample === 129)).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:transport');
    expect(document.body.contains(audio)).toBe(false);
  });

  it('does not play a transport that was paused during creation', async () => {
    let resolveUrl!: (url: string) => void;
    const createObjectURL = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveUrl = resolve;
        }),
    );
    const play = vi.fn().mockResolvedValue(undefined);
    const audio = document.createElement('audio');
    Object.assign(audio, { play, pause: vi.fn() });
    vi.stubGlobal(
      'Audio',
      vi.fn(function () {
        return audio;
      }),
    );
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });

    const quirk = createMediaSessionQuirk();
    const starting = quirk.play(60_000, 15_000);
    await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    quirk.pause();
    resolveUrl('blob:transport');
    await starting;

    expect(play).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:transport');
  });

  it('uses a looping ten-second source for narrations longer than ten hours', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const audio = document.createElement('audio');
    Object.assign(audio, { play, pause: vi.fn() });
    const createObjectURL = vi.fn((...args: [Blob]) => {
      void args;
      return 'blob:transport';
    });
    vi.stubGlobal(
      'Audio',
      vi.fn(function () {
        return audio;
      }),
    );
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });

    const quirk = createMediaSessionQuirk();
    await quirk.play(10 * 60 * 60 * 1000 + 1, 10 * 60 * 60 * 1000 + 5_000);

    const source = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(source.size).toBe(10_044);
    expect(audio.loop).toBe(true);
    expect(audio.currentTime).toBe(5);
  });
});
