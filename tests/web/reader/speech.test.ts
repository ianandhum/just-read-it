import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReaderSpeech } from '../../../lib/web/reader/speech';
import { DEFAULT_SETTINGS, type JriSettings } from '../../../lib/types';
import type { ReadingSession } from '../../../lib/reading/state';

describe('reader speech completion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('releases narration before announcing a completed article', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const speak = vi.fn();
    const cancel = vi.fn();
    class TestUtterance {
      text: string;
      rate = 1;
      voice: SpeechSynthesisVoice | null = null;
      onboundary: ((event: SpeechSynthesisEvent) => void) | null = null;
      onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('SpeechSynthesisUtterance', TestUtterance);
    vi.stubGlobal('speechSynthesis', { speak, cancel, getVoices: () => [] });

    let currentId: number | null = 1;
    const session = {
      getCurrentId: () => currentId,
      getSpans: () => [Object.assign(document.createElement('span'), { textContent: 'The final sentence.' })],
      advance: vi.fn(() => {
        currentId = null;
        return null;
      }),
    } as unknown as ReadingSession;
    const speech = createReaderSpeech({
      getSession: () => session,
      getSettings: (): JriSettings => DEFAULT_SETTINGS,
      updateControls: vi.fn(),
      updateProgress: vi.fn(),
      scheduleSave: vi.fn(),
      scrollCurrentIntoView: vi.fn(),
      updateWakeLock: vi.fn(async () => {}),
      onListeningStarted: vi.fn(),
      onListeningStopped: vi.fn(),
      onReadingAloudStopped: vi.fn(),
      onMediaTransportStarted: vi.fn(),
    });
    speech.setBackend('web');
    speech.setAvailable(true);

    speech.startReadingAloud();
    const narration = speak.mock.calls[0]?.[0] as SpeechSynthesisUtterance;
    narration.onend?.({} as SpeechSynthesisEvent);

    expect(cancel).toHaveBeenCalledOnce();
    expect(speech.readingAloud).toBe(false);
    expect(speak).toHaveBeenCalledTimes(2);
    expect((speak.mock.calls[1]?.[0] as SpeechSynthesisUtterance).text).toBe('You finished the article. Nice work.');
  });
});
