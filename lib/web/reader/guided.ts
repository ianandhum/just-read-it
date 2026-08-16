import type { JriSettings } from '../../types';
import type { ReadingSession } from '../../reading/state';
import type { InteractionHandle } from './interaction';
import type { ReaderSpeech } from './speech';

const MOUSE_IDLE_DELAY_MS = 300;

export interface ReaderGuidedContext {
  getSession(): ReadingSession | null;
  getSettings(): JriSettings;
  getInteraction(): InteractionHandle | null;
  getSpeech(): ReaderSpeech;
  isTornDown(): boolean;
  getLightsOutEnabled(): boolean;
  setLightsOutEnabled(enabled: boolean): void;
  getNormalLightsOutEnabled(): boolean;
  setNormalLightsOutEnabled(enabled: boolean): void;
  setGuidedSetting(enabled: boolean): void;
  setBodyModes(guided: boolean, lightsOut: boolean): void;
  updateControls(): void;
  updateProgress(): void;
  scheduleSave(): void;
  scrollCurrentIntoView(): void;
  updateWakeLock(): Promise<void>;
}

export interface ReaderGuided {
  scheduleGuidedAdvance(fromId: number | null): void;
  startLoop(): void;
  setGuided(guidedReading: boolean, immediateDimming?: boolean): void;
  pause(): void;
  resume(): void;
  manualPause(): void;
  teardown(): void;
}

export function createReaderGuided(context: ReaderGuidedContext): ReaderGuided {
  let advanceTimer: ReturnType<typeof setTimeout> | null = null;
  let rafId: number | null = null;
  let lastFrameAt = 0;
  let guidedPauseUntil = 0;
  let paused = false;
  let pendingGuidedAdvanceFrom: number | null = null;

  function scheduleGuidedAdvance(fromId: number | null): void {
    if (advanceTimer) clearTimeout(advanceTimer);
    pendingGuidedAdvanceFrom = fromId;
    advanceTimer = setTimeout(
      () => {
        advanceTimer = null;
        const session = context.getSession();
        if (context.isTornDown() || !session) return;
        if (!context.getSettings().guidedReading) return;
        const next = session.nextUnreadAfter(fromId);
        pendingGuidedAdvanceFrom = null;
        if (next === null) {
          // Keep the prior sentence status during normal transitions, but
          // refresh at the end so the completed article state is rendered.
          context.updateProgress();
          return;
        }
        session.setCurrent(next, { fresh: true, force: true });
        context.scrollCurrentIntoView();
        context.updateProgress();
        context.scheduleSave();
        startLoop();
      },
      Math.max(0, context.getSettings().guidedAdvanceDelay),
    );
  }

  function loop(now: number): void {
    const session = context.getSession();
    if (context.isTornDown() || !session) {
      rafId = null;
      return;
    }
    if (paused || !context.getSettings().guidedReading || context.getSpeech().readingAloud) {
      rafId = null;
      return;
    }
    const dt = lastFrameAt === 0 ? 0 : now - lastFrameAt;
    lastFrameAt = now;

    if (session.isAnimating()) {
      const interaction = context.getInteraction();
      const mouseBusy = interaction !== null && interaction.isMouseInside() && now - interaction.lastMouseMoveAt() < MOUSE_IDLE_DELAY_MS;
      if (!mouseBusy && now >= guidedPauseUntil) {
        const id = session.getCurrentId();
        const result = session.tick(dt * Math.max(0.1, context.getSettings().guidedRate));
        if (result.completed) {
          context.scheduleSave();
          scheduleGuidedAdvance(id);
        }
      }
    }

    if (session.getCurrentId() !== null) {
      rafId = requestAnimationFrame(loop);
    } else {
      rafId = null;
    }
  }

  function startLoop(): void {
    if (paused || !context.getSettings().guidedReading || rafId !== null) return;
    lastFrameAt = 0;
    rafId = requestAnimationFrame(loop);
  }

  function setGuided(guidedReading: boolean, immediateDimming = false): void {
    const speech = context.getSpeech();
    const session = context.getSession();
    if (!guidedReading) speech.stopReadingAloud();
    if (guidedReading !== context.getSettings().guidedReading) {
      if (guidedReading) {
        context.setNormalLightsOutEnabled(context.getLightsOutEnabled());
        context.setLightsOutEnabled(true);
      } else {
        context.setLightsOutEnabled(context.getNormalLightsOutEnabled());
      }
      session?.setGuidedMode(guidedReading);
      session?.setLightsOut(context.getLightsOutEnabled(), !guidedReading || immediateDimming);
    } else if (guidedReading && immediateDimming) {
      session?.setLightsOut(true, true);
    }
    context.setGuidedSetting(guidedReading);
    context.setBodyModes(guidedReading, context.getLightsOutEnabled());
    session?.setWordFocus(guidedReading);
    context.updateControls();
    void context.updateWakeLock();
    if (guidedReading) {
      if (session?.getCurrentId() === null && pendingGuidedAdvanceFrom !== null) {
        scheduleGuidedAdvance(pendingGuidedAdvanceFrom);
      } else {
        startLoop();
      }
      if (speech.restoreSpeechForKeyboardGuided) {
        speech.clearKeyboardSpeechRestore();
        speech.scheduleRestore(() => {
          if (!context.isTornDown() && context.getSettings().guidedReading) speech.startReadingAloud();
        });
      }
    }
    console.log(`[Just Read It] guided reading ${guidedReading ? 'on' : 'off'}`);
  }

  function manualPause(): void {
    guidedPauseUntil = performance.now() + 600;
  }

  function pause(): void {
    paused = true;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
    pendingGuidedAdvanceFrom = null;
  }

  function resume(): void {
    paused = false;
    guidedPauseUntil = 0;
    startLoop();
  }

  function teardown(): void {
    pause();
  }

  return { scheduleGuidedAdvance, startLoop, setGuided, pause, resume, manualPause, teardown };
}
