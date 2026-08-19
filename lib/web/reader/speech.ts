import type { JriSettings, RuntimeMessage } from '../../types';
import type { ReadingSession } from '../../reading/state';
import { createMediaSessionQuirk } from './media_session_quirk';

type SpeechBackend = 'extension' | 'web' | 'none';

export const COMPLETION_ANNOUNCEMENTS = [
  'You finished the article. Nice work.',
  "That's the article. Nicely done.",
  'Article complete. Well read.',
  'You made it to the end. Nice work.',
  'Finished. Take a moment to enjoy that.',
  "That's a wrap. Great reading.",
  'Article complete. The next one can wait.',
  "You've finished this one. Well done.",
] as const;

export function randomCompletionAnnouncement(): string {
  const announcementIndex = Math.floor(Math.random() * COMPLETION_ANNOUNCEMENTS.length);
  return COMPLETION_ANNOUNCEMENTS[announcementIndex]!;
}

export interface ReaderSpeechContext {
  getSession(): ReadingSession | null;
  getSettings(): JriSettings;
  updateControls(): void;
  updateProgress(): void;
  scheduleSave(): void;
  scrollCurrentIntoView(): void;
  updateWakeLock(): Promise<void>;
  onListeningStarted(): void;
  onListeningStopped(): void;
  onReadingAloudStopped(preserveGuided: boolean): void;
  onMediaTransportStarted(): void;
}

export interface ReaderSpeech {
  readonly available: boolean;
  readonly backend: SpeechBackend;
  readonly readingAloud: boolean;
  readonly paused: boolean;
  readonly generation: number;
  readonly restoreSpeechForKeyboardGuided: boolean;
  testWebSpeech(): Promise<boolean>;
  setBackend(backend: SpeechBackend): void;
  setAvailable(available: boolean): void;
  stopReadingAloud(preserveGuided?: boolean): void;
  pauseReadingAloud(): void;
  speakCurrentSentence(): void;
  startReadingAloud(): void;
  clearKeyboardSpeechRestore(): void;
  setKeyboardSpeechRestore(enabled: boolean): void;
  scheduleRestore(callback: () => void): void;
  handleTtsEvent(message: Extract<RuntimeMessage, { type: 'BG_TTS_EVENT' }>): void;
}

// createReaderSpeech why does this look complicated? well, chrome and firefox diverge here.
// Chrome uses browser.tts in the extension context; Firefox, allow contentScripts to use
// the regular speech API.
export function createReaderSpeech(context: ReaderSpeechContext): ReaderSpeech {
  let speechAvailable = false;
  let speechBackend: SpeechBackend = 'none';
  let readingAloud = false;
  let paused = false;
  let speechGeneration = 0;
  let activeUtterance: SpeechSynthesisUtterance | null = null;
  let restoreSpeechForKeyboardGuided = false;
  let restoreSpeechTimer: ReturnType<typeof setTimeout> | null = null;
  const mediaSessionQuirk = createMediaSessionQuirk();

  function startMediaTransport(session: ReadingSession): void {
    try {
      const { durationMs, positionMs } = session.getSpeechTiming();
      const rate = speechRate();
      void mediaSessionQuirk.play(durationMs / rate, positionMs / rate).then(() => {
        if (!readingAloud || paused) return;
        try {
          context.onMediaTransportStarted();
        } catch {
          // Media Session setup must not interfere with narration.
        }
      });
    } catch {
      // The faux transport is optional.
    }
  }

  function speechRate(): number {
    return Math.max(0.1, Math.min(10, context.getSettings().rate));
  }

  function testWebSpeech(): Promise<boolean> {
    if (typeof window.speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return Promise.resolve(false);
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(' ');
      let settled = false;
      const finish = (available: boolean): void => {
        if (settled) return;
        settled = true;
        window.speechSynthesis.cancel();
        resolve(available);
      };
      const timeout = window.setTimeout(() => finish(false), 1500);
      utterance.volume = 0;
      utterance.onend = () => {
        window.clearTimeout(timeout);
        finish(true);
      };
      utterance.onerror = () => {
        window.clearTimeout(timeout);
        finish(false);
      };
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        window.clearTimeout(timeout);
        finish(false);
      }
    });
  }

  function stopReadingAloud(preserveGuided = false): void {
    speechGeneration++;
    if (!readingAloud) {
      void context.updateWakeLock();
      return;
    }
    readingAloud = false;
    const wasPaused = paused;
    paused = false;
    activeUtterance = null;
    mediaSessionQuirk.stop();
    if (!wasPaused) context.onListeningStopped();
    if (speechBackend === 'extension') void browser.runtime.sendMessage({ type: 'CS_TTS_STOP' } satisfies RuntimeMessage).catch(() => {});
    else if (speechBackend === 'web') window.speechSynthesis.cancel();
    context.onReadingAloudStopped(preserveGuided);
    context.updateControls();
    void context.updateWakeLock();
  }

  function announceCompletion(): void {
    const settings = context.getSettings();
    const text = randomCompletionAnnouncement();
    if (speechBackend === 'extension') {
      void browser.runtime
        .sendMessage({
          type: 'CS_TTS_SPEAK',
          text,
          rate: settings.rate,
          voiceURI: settings.voiceURI,
          requestId: speechGeneration,
        } satisfies RuntimeMessage)
        .catch(() => {});
      return;
    }
    if (speechBackend !== 'web') return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speechRate();
    const voice = window.speechSynthesis.getVoices().find((item) => item.voiceURI === settings.voiceURI);
    if (voice) utterance.voice = voice;
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      // Completing the article must not depend on an optional announcement.
    }
  }

  function speakCurrentSentence(): void {
    const session = context.getSession();
    if (!readingAloud || !session) return;
    const id = session.getCurrentId();
    if (id === null) {
      stopReadingAloud();
      announceCompletion();
      return;
    }
    const text = session
      .getSpans(id)
      .map((span) => span.textContent ?? '')
      .join('')
      .trim();
    if (!text) {
      session.advance();
      context.updateProgress();
      context.scheduleSave();
      speakCurrentSentence();
      return;
    }
    const settings = context.getSettings();
    if (speechBackend === 'extension') {
      void browser.runtime
        .sendMessage({
          type: 'CS_TTS_SPEAK',
          text,
          rate: settings.rate,
          voiceURI: settings.voiceURI,
          requestId: speechGeneration,
        } satisfies RuntimeMessage)
        .catch((err) => {
          console.warn('[Just Read It] extension speech synthesis failed', err);
          stopReadingAloud();
        });
      return;
    }
    if (speechBackend !== 'web') return;
    const generation = speechGeneration;
    const utterance = new SpeechSynthesisUtterance(text);
    activeUtterance = utterance;
    utterance.rate = speechRate();
    const voice = window.speechSynthesis.getVoices().find((item) => item.voiceURI === settings.voiceURI);
    if (voice) utterance.voice = voice;
    utterance.onboundary = (event) => {
      if (activeUtterance !== utterance || !readingAloud || generation !== speechGeneration || !context.getSession()) return;
      if (event.name === 'word') {
        session.setProgress(Math.min(0.999999, event.charIndex / Math.max(1, text.length)));
        try {
          mediaSessionQuirk.seek(session.getSpeechTiming().positionMs / speechRate());
        } catch {
          // The faux transport is optional.
        }
        context.updateProgress();
      }
    };
    utterance.onend = () => {
      if (activeUtterance !== utterance || !readingAloud || generation !== speechGeneration || !context.getSession()) return;
      activeUtterance = null;
      session.advance();
      context.updateProgress();
      context.scheduleSave();
      context.scrollCurrentIntoView();
      speakCurrentSentence();
    };
    utterance.onerror = (event) => {
      if (activeUtterance !== utterance) return;
      activeUtterance = null;
      console.warn(`[Just Read It] web speech synthesis failed: ${event.error}`);
      if (generation === speechGeneration) stopReadingAloud();
    };
    window.speechSynthesis.speak(utterance);
  }

  function startReadingAloud(): void {
    const session = context.getSession();
    if (!speechAvailable || !session) return;
    if (readingAloud) {
      if (!paused) return;
      paused = false;
      session.setProgress(0);
      startMediaTransport(session);
      context.onListeningStarted();
      context.updateControls();
      void context.updateWakeLock();
      speakCurrentSentence();
      return;
    }
    const current = session.getCurrentId() ?? session.nextUnreadAfter(null);
    if (current === null) return;
    if (session.getCurrentId() !== current) session.setCurrent(current, { fresh: true, force: true });
    readingAloud = true;
    startMediaTransport(session);
    context.onListeningStarted();
    context.updateControls();
    void context.updateWakeLock();
    context.scrollCurrentIntoView();
    speakCurrentSentence();
  }

  function pauseReadingAloud(): void {
    if (!readingAloud || paused) return;
    speechGeneration++;
    paused = true;
    activeUtterance = null;
    mediaSessionQuirk.pause();
    context.onListeningStopped();
    if (speechBackend === 'extension') void browser.runtime.sendMessage({ type: 'CS_TTS_STOP' } satisfies RuntimeMessage).catch(() => {});
    else if (speechBackend === 'web') window.speechSynthesis.cancel();
    context.updateControls();
    void context.updateWakeLock();
  }

  function clearKeyboardSpeechRestore(): void {
    restoreSpeechForKeyboardGuided = false;
    if (restoreSpeechTimer) {
      clearTimeout(restoreSpeechTimer);
      restoreSpeechTimer = null;
    }
  }

  function handleTtsEvent(message: Extract<RuntimeMessage, { type: 'BG_TTS_EVENT' }>): void {
    const session = context.getSession();
    if (!readingAloud || paused || message.requestId !== speechGeneration) return;
    if (message.event === 'word') {
      if (typeof message.charIndex === 'number' && session) {
        const id = session.getCurrentId();
        const text =
          id === null
            ? ''
            : session
                .getSpans(id)
                .map((span) => span.textContent ?? '')
                .join('')
                .trim();
        if (text) session.setProgress(Math.min(0.999999, message.charIndex / Math.max(1, text.length)));
        context.updateProgress();
      }
      return;
    }
    if (message.event === 'error') {
      console.warn(`[Just Read It] speech synthesis failed: ${message.error ?? 'unknown error'}`);
      stopReadingAloud();
      return;
    }
    session?.advance();
    context.updateProgress();
    context.scheduleSave();
    context.scrollCurrentIntoView();
    speakCurrentSentence();
  }

  return {
    get available() {
      return speechAvailable;
    },
    get backend() {
      return speechBackend;
    },
    get readingAloud() {
      return readingAloud;
    },
    get paused() {
      return paused;
    },
    get generation() {
      return speechGeneration;
    },
    get restoreSpeechForKeyboardGuided() {
      return restoreSpeechForKeyboardGuided;
    },
    testWebSpeech,
    setBackend: (backend) => {
      speechBackend = backend;
      speechAvailable = backend === 'extension';
    },
    setAvailable: (available) => {
      speechAvailable = available;
    },
    stopReadingAloud,
    pauseReadingAloud,
    speakCurrentSentence,
    startReadingAloud,
    clearKeyboardSpeechRestore,
    setKeyboardSpeechRestore: (enabled) => {
      restoreSpeechForKeyboardGuided = enabled;
    },
    scheduleRestore: (callback) => {
      restoreSpeechTimer = setTimeout(() => {
        restoreSpeechTimer = null;
        callback();
      }, 0);
    },
    handleTtsEvent,
  };
}
