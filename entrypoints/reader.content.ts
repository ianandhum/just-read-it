import type { ContentCandidateInfo, RuntimeMessage, JriSettings } from '@/lib/types';
import confetti from 'canvas-confetti';
import { DEFAULT_SETTINGS } from '@/lib/types';
import { canAnnotateDocument, getContentCandidates, wrapSentencesAsync, type WrapResult } from '@/lib/sentence';
import { createReadingSession, type ReadingSession, type ReadingStats } from '@/lib/reading';
import {
  loadPageState,
  clearPageState,
  setPageStarred,
  loadSettings,
  saveSettings,
  loadContentCandidate,
  saveContentCandidate,
  loadPerSiteSettings,
  savePerSiteSettings,
} from '@/lib/storage';
import { createReaderLifecycle, type ReaderLifecycleContext } from '@/lib/web/reader/lifecycle';
import { createReaderPersistence, type ReaderPersistence } from '@/lib/web/reader/persistence';
import { createTimeTracking, type TimeTracking } from '@/lib/web/reader/time_tracking';
import { pageMetadata, type PageMetadata } from '@/lib/web/reader/page_metadata';
import { createReaderWakeLock, type ReaderWakeLock } from '@/lib/web/reader/wake_lock';
import { createReaderMediaSession, type ReaderMediaSession } from '@/lib/web/reader/media_session';
import { createReaderSpeech, randomCompletionAnnouncement } from '@/lib/web/reader/speech';
import { createReaderGuided } from '@/lib/web/reader/guided';
import { createReaderControls, type ReaderControls, type ReaderControlsState, type ReaderStatus } from '@/lib/web/reader/controls';
import { attachInteraction, type InteractionHandle } from '@/lib/web/reader/interaction';
import { createProgressBar, type ProgressBar } from '@/lib/web/reader/progress';
import { applyReaderAppearance, applyReaderFontScale, removeReaderStyle, resolveReaderUiTheme } from '@/lib/web/reader/presentation';
import { removeSharedProgressFromUrl, shareProgressUrl, sharedProgressFromUrl } from '@/lib/progress_share';
import { rangesToReadIds } from '@/lib/progress_share';

import accentCss from '@/styles/accent.css?raw';
import readerCss from '@/assets/reader-presentation.css?raw';
import '@/assets/reader-page.css';

declare global {
  interface Window {
    __jriActive?: boolean;
  }
}

const SAVE_DEBOUNCE_MS = 500;
const CSS = `${accentCss}\n${readerCss}`.trim();

export default defineContentScript({
  registration: 'runtime',
  cssInjectionMode: 'manual',
  main() {
    if (window.__jriActive) {
      console.log('[Just Read It] already active; skipping re-inject');
      return;
    }
    window.__jriActive = true;
    console.log('[Just Read It] content script activated');

    let wrap: WrapResult | null = null;
    let session: ReadingSession | null = null;
    let progress: ProgressBar | null = null;
    let controls: ReaderControls | null = null;
    let interaction: InteractionHandle | null = null;
    let activateTimer: ReturnType<typeof setTimeout> | null = null;
    let tornDown = false;
    let readerEnabled = false;
    let sessionUrl: string | null = null;
    let sessionTitle = '';
    let sessionMetadata: PageMetadata = {};
    let activationGen = 0;
    let unwatchUrl: (() => void) | null = null;
    let settings: JriSettings = DEFAULT_SETTINGS;
    let fontScale = 1;
    let hasPerSiteFontScale = false;
    let didCelebrate = false;
    let partyTimer: ReturnType<typeof setTimeout> | null = null;
    let lightsOutEnabled = false;
    let normalLightsOutEnabled = false;
    let starred = false;
    let readAloudEnabledGuided = false;
    let statusText: ReaderStatus = { minutes: '', text: 'Loading reader...' };
    let sessionToken: string | null = null;
    let activationTransition = Promise.resolve();
    let contentCandidateId: string | undefined;
    let cachedContentCandidates: ContentCandidateInfo[] = [];

    const timeTracking: TimeTracking = createTimeTracking({
      hasSession: () => session !== null,
      isVisible: () => document.visibilityState === 'visible',
    });
    const wakeLock: ReaderWakeLock = createReaderWakeLock({
      // Keep the display awake for either guided reading.
      shouldHold: () => settings.guidedReading || speech.readingAloud,
      isTornDown: () => tornDown,
    });
    const persistence: ReaderPersistence = createReaderPersistence(
      {
        enabled: () => settings.readingHistoryEnabled,
        isTornDown: () => tornDown,
        pageState: () =>
          session && sessionUrl
            ? session.toPageState(sessionUrl, sessionTitle, timeTracking.currentMs(), timeTracking.currentDailyMs(), {
              ...sessionMetadata,
              starred,
              listenTimeSpentMs: timeTracking.currentListenMs(),
              dailyListenTimeSpentMs: timeTracking.currentDailyListenMs(),
            })
            : null,
      },
      SAVE_DEBOUNCE_MS,
    );

    const speech = createReaderSpeech({
      getSession: () => session,
      getSettings: () => settings,
      updateControls,
      updateProgress,
      scheduleSave,
      scrollCurrentIntoView,
      updateWakeLock: () => wakeLock.update(),
      onListeningStarted: () => timeTracking.startListening(),
      onListeningStopped: () => {
        timeTracking.stopListening();
        scheduleSave();
      },
      onReadingAloudStopped: (preserveGuided) => {
        if (!preserveGuided && readAloudEnabledGuided) {
          readAloudEnabledGuided = false;
          guided.setGuided(false);
        }
      },
      onMediaTransportStarted: updateControls,
    });

    const guided = createReaderGuided({
      getSession: () => session,
      getSettings: () => settings,
      getInteraction: () => interaction,
      getSpeech: () => speech,
      isTornDown: () => tornDown,
      getLightsOutEnabled: () => lightsOutEnabled,
      setLightsOutEnabled: (enabled) => {
        lightsOutEnabled = enabled;
      },
      getNormalLightsOutEnabled: () => normalLightsOutEnabled,
      setNormalLightsOutEnabled: (enabled) => {
        normalLightsOutEnabled = enabled;
      },
      setGuidedSetting: (enabled) => {
        settings = { ...settings, guidedReading: enabled };
      },
      setBodyModes: (isGuided, lightsOut) => {
        document.body?.classList.toggle('jri-guided-mode', isGuided);
        document.body?.classList.toggle('jri-lights-out-mode', lightsOut);
      },
      updateControls,
      updateProgress,
      scheduleSave,
      scrollCurrentIntoView,
      updateWakeLock: () => wakeLock.update(),
    });

    function reportState(enabled: boolean): void {
      if (!sessionToken) return;
      void browser.runtime
        .sendMessage({
          type: 'CS_READING_MODE_STATE',
          enabled,
          token: sessionToken,
        } satisfies RuntimeMessage)
        .catch(() => { });
    }

    const updateWakeLock = (): Promise<void> => wakeLock.update();
    const releaseWakeLock = (): Promise<void> => wakeLock.release();

    function applySettings(next: Partial<JriSettings> & { fontScale?: number }, forceFontScale = false): void {
      const { fontScale: nextFontScale, ...settingsPatch } = next;
      const voiceChanged = settingsPatch.voiceURI !== undefined && settingsPatch.voiceURI !== settings.voiceURI;
      const rateChanged = settingsPatch.rate !== undefined && settingsPatch.rate !== settings.rate;
      if (nextFontScale !== undefined && (forceFontScale || !hasPerSiteFontScale) && nextFontScale !== fontScale) {
        fontScale = nextFontScale;
        applyReaderFontScale(document, fontScale);
      }
      settings = { ...settings, ...settingsPatch };
      applyReaderAppearance(document, settings);
      updateControls();
      void updateWakeLock();
      if (!speech.readingAloud || (!voiceChanged && !rateChanged) || !session) return;

      speech.stopReadingAloud(true);
      const current = session.getCurrentId();
      if (current !== null) session.setCurrent(current, { fresh: true, force: true });
      speech.startReadingAloud();
    }

    function readingStatus(stats: ReadingStats): ReaderStatus {
      if (stats.total > 0 && stats.readCount === stats.total) {
        return {
          minutes: '100% read, kudos!',
          text: '',
        };
      }
      const speed = speech.readingAloud ? settings.rate : settings.guidedReading ? settings.guidedRate : 1;
      const minutes = Math.max(1, Math.ceil(stats.unreadMs / speed / 60_000));
      const hours = Math.floor(minutes / 60);
      const remaining = hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
      const percent = stats.total > 0 ? Math.floor((stats.readCount / stats.total) * 100) : 0;
      return {
        minutes: `~${remaining}`,
        progress: `${percent}%`,
        text: '',
      };
    }

    function currentControlsState(stats?: ReadingStats): ReaderControlsState {
      const resolved = stats ?? session?.getStats();
      const complete = resolved !== undefined && resolved.total > 0 && resolved.readCount === resolved.total;
      return {
        guidedReading: settings.guidedReading,
        // A stale paused flag must not make Guided Reading look stopped after
        // closing RSVP when narration and the guided loop are still running.
        guidedReadingPaused: settings.guidedReading && speech.readingAloud && speech.paused,
        rsvpEnabled: settings.rsvpEnabled,
        readingAloud: speech.readingAloud,
        readingAloudPaused: speech.paused,
        complete,
        status: statusText,
        speechAvailable: speech.available,
        lightsOut: lightsOutEnabled,
        starred,
        rate: settings.rate,
        guidedRate: settings.guidedRate,
        voiceURI: settings.voiceURI,
        fontScale,
        currentSentence: resolved?.currentId ?? null,
        totalSentences: resolved?.total ?? 0,
      };
    }

    function updateProgress(): void {
      if (!session || !progress) return;
      const stats = session.getStats();
      const complete = stats.total > 0 && stats.readCount === stats.total;
      if (!complete || !didCelebrate) statusText = readingStatus(stats);
      progress.update(stats.readCount, stats.total);
      if (complete) {
        if (!didCelebrate) {
          didCelebrate = true;
          statusText = { minutes: randomCompletionAnnouncement(), text: '' };
          if (settings.completionCelebrationEnabled) showParty();
        }
      } else {
        didCelebrate = false;
      }
      controls?.update(currentControlsState(stats));
    }

    function scheduleSave(): void {
      persistence.schedule();
    }

    function flushSave(): void {
      persistence.flush();
    }

    async function copyText(text: string): Promise<boolean> {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('aria-hidden', 'true');
        input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body?.append(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        return copied;
      }
    }

    const pauseTimeTracking = (): void => timeTracking.pause();
    const resumeTimeTracking = (): void => timeTracking.resume();
    const recordReadingActivity = (): void => timeTracking.recordActivity();

    function scrollCurrentIntoView(): void {
      if (!session) return;
      const id = session.getCurrentId();
      if (id === null) return;
      const spans = session.getSpans(id);
      const first = spans[0];
      if (!first) return;
      const rsvpViewport = controls?.getRsvpViewport();
      if (!rsvpViewport) {
        first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }

      const rsvpTop = Math.max(0, rsvpViewport.top);
      const rsvpBottom = Math.min(window.innerHeight, rsvpViewport.bottom);
      if (rsvpBottom <= rsvpTop) {
        first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      const sentenceRect = first.getBoundingClientRect();
      const visibleCenter = rsvpTop >= window.innerHeight - rsvpBottom ? rsvpTop / 2 : (rsvpBottom + window.innerHeight) / 2;
      const sentenceCenter = sentenceRect.top + sentenceRect.height / 2;
      window.scrollBy({ top: sentenceCenter - visibleCenter, behavior: 'smooth' });
    }

    function updateControls(): void {
      if (session && !statusText.text) statusText = readingStatus(session.getStats());
      controls?.update(currentControlsState());
      mediaSession.update(
        speech.readingAloud && !speech.paused,
        sessionTitle,
        location.hostname,
        sessionMetadata.previewImageUrl ?? browser.runtime.getURL('/icons/just-read-it-128.png'),
      );
    }

    function startReadAloud(): void {
      if (!speech.available || !session || (speech.readingAloud && !speech.paused)) return;
      if (session.getCurrentId() === null && session.nextUnreadAfter(null) === null) return;
      readAloudEnabledGuided = !settings.guidedReading;
      guided.setGuided(true, true);
      speech.startReadingAloud();
      // Guided mode updates controls before narration starts. Publish the
      // active Media Session state again after speech has begun.
      updateControls();
    }

    function navigateSentence(direction: 'previous' | 'next'): void {
      if (!session) return;
      const resumeSpeech = speech.readingAloud;
      const wasPaused = speech.paused;
      // Pausing cancels the current utterance but retains the faux audio
      // transport, so MPRIS does not discard this Media Session on navigation.
      speech.pauseReadingAloud();
      if (direction === 'previous') session.prev();
      else session.moveNext();
      updateProgress();
      scheduleSave();
      scrollCurrentIntoView();
      guided.startLoop();
      if (resumeSpeech && !wasPaused && session.getCurrentId() !== null) speech.startReadingAloud();
    }

    const mediaSession: ReaderMediaSession = createReaderMediaSession({
      play: startReadAloud,
      pause: () => speech.pauseReadingAloud(),
      stop: () => speech.stopReadingAloud(),
      next: () => navigateSentence('next'),
      previous: () => navigateSentence('previous'),
    });

    function setStatus(status: string | ReaderStatus, options?: { progress?: number; indefinite?: boolean }): void {
      statusText = typeof status === 'string' ? { minutes: '', text: status } : status;
      updateControls();
      if (typeof status === 'string') controls?.setStatus(status, options);
    }

    function removeParty(): void {
      if (partyTimer !== null) {
        clearTimeout(partyTimer);
        partyTimer = null;
      }
      confetti.reset();
    }

    function showParty(): void {
      removeParty();
      const colors = ['#ffc72f', '#ff4e4e', '#37bcff', '#78f945', '#8b4dff', '#ff8127'];
      const statusRect = document.querySelector<HTMLElement>('.jri-reading-status')?.getBoundingClientRect();
      const origin = statusRect
        ? {
          x: (statusRect.left + statusRect.width / 2) / window.innerWidth,
          y: (statusRect.top + statusRect.height / 2) / window.innerHeight,
        }
        : { x: 0.5, y: 0.9 };

      var count = 300;
      var defaults: confetti.Options = {
        colors,
        origin,
        scalar: 1.3 
      };

      function fire(particleRatio: number, opts:confetti.Options) {
        confetti({
          ...defaults,
          ...opts,
          particleCount: Math.floor(count * particleRatio)
        });
      }

      fire(0.25, {
        spread: 26,
        startVelocity: 55,
      });
      fire(0.2, {
        spread: 60,
      });
      fire(0.35, {
        spread: 100,
        decay: 0.91,
        scalar: 0.8
      });
      fire(0.1, {
        spread: 120,
        startVelocity: 25,
        decay: 0.92,
        scalar: 1.2
      });
      fire(0.1, {
        spread: 120,
        startVelocity: 45,
      });
    }

    function markPreviousRead(): void {
      if (!session) return;
      session.markPreviousRead();
      updateProgress();
      scheduleSave();
    }

    async function startSession(url: string, gen: number): Promise<boolean> {
      if (!wrap || tornDown || !readerEnabled) return false;
      document.documentElement.classList.add('jri-reader-active');
      controls?.setVisible(true);
      setStatus('Restoring reading progress', { indefinite: true });
      let initial: { currentId: number | null; readIds: number[] } | null = null;
      let savedTotal: number | null = null;
      let savedTimeSpentMs = 0;
      let savedDailyTimeSpentMs: Record<string, number> = {};
      let savedListenTimeSpentMs = 0;
      let savedDailyListenTimeSpentMs: Record<string, number> = {};
      let importedProgress = sharedProgressFromUrl(url);
      try {
        const page = await loadPageState(url);
        if (page) {
          const imported = importedProgress;
          const importedMatchesPage = imported?.total === page.total;
          initial = {
            currentId: importedMatchesPage && page.currentId === null ? imported!.currentId : page.currentId,
            readIds: importedMatchesPage
              ? [...new Set([...rangesToReadIds(page.readRanges, page.total), ...imported!.readIds])]
              : rangesToReadIds(page.readRanges, page.total),
          };
          savedTotal = page.total;
          savedTimeSpentMs = page.timeSpentMs ?? 0;
          savedDailyTimeSpentMs = page.dailyTimeSpentMs ?? {};
          savedListenTimeSpentMs = page.listenTimeSpentMs ?? 0;
          savedDailyListenTimeSpentMs = page.dailyListenTimeSpentMs ?? {};
          starred = page.starred ?? false;
        }
      } catch (err) {
        console.error('[Just Read It] load state failed', err);
      }
      if (importedProgress?.total !== wrap.total) importedProgress = null;
      setStatus('Loading reader settings', { indefinite: true });
      const loadedSettings = await loadSettings();
      const siteSettings = await loadPerSiteSettings(url);
      if (tornDown || !readerEnabled || !wrap || gen !== activationGen || location.href !== url) return false;
      hasPerSiteFontScale = siteSettings?.fontScale !== undefined;
      settings = loadedSettings;
      applySettings({ fontScale: siteSettings?.fontScale ?? settings.fontScale }, true);

      try {
        setStatus('Checking Read Aloud', { indefinite: true });
        const status = (await browser.runtime.sendMessage({
          type: 'CS_TTS_STATUS',
        } satisfies RuntimeMessage)) as { backend?: 'extension' | 'web' | 'none' };
        speech.setBackend(status.backend ?? 'none');
        if (speech.backend === 'web') speech.setAvailable(await speech.testWebSpeech());
      } catch {
        speech.setBackend('none');
      }
      if (tornDown || !readerEnabled || !wrap || gen !== activationGen || location.href !== url) return false;

      if (initial && savedTotal !== wrap.total) initial = null;
      if (importedProgress) {
        initial = {
          currentId: initial?.currentId ?? importedProgress.currentId,
          readIds: [...new Set([...(initial?.readIds ?? []), ...importedProgress.readIds])],
        };
      }
      timeTracking.restore(savedTimeSpentMs, savedDailyTimeSpentMs, savedListenTimeSpentMs, savedDailyListenTimeSpentMs);
      if (settings.guidedReading) {
        normalLightsOutEnabled = lightsOutEnabled;
        lightsOutEnabled = true;
      }
      setStatus('Preparing your reading view', { indefinite: true });
      sessionTitle = document.title;
      sessionMetadata = pageMetadata(document);
      session = createReadingSession(wrap.spans, initial, {
        lightsOut: lightsOutEnabled,
        guidedMode: settings.guidedReading,
      });
      if (importedProgress) history.replaceState(history.state, '', removeSharedProgressFromUrl(url));
      session.setGuidedMode(settings.guidedReading);
      if (settings.guidedReading) {
        session.setLightsOut(true);
      } else {
        session.setLightsOut(lightsOutEnabled, true);
      }
      session.setWordFocus(settings.guidedReading);
      document.body?.classList.toggle('jri-guided-mode', settings.guidedReading);
      document.body?.classList.toggle('jri-lights-out-mode', lightsOutEnabled);
      didCelebrate = session.getStats().readCount === session.getStats().total;
      if (!controls) return false;
      if (!progress) progress = createProgressBar(document, controls.root);
      updateProgress();
      void updateWakeLock();
      setStatus(readingStatus(session.getStats()));

      if (session.getCurrentId() === null) {
        const first = session.nextUnreadAfter(null);
        if (first !== null) {
          session.setCurrent(first);
          scrollCurrentIntoView();
          scheduleSave();
        }
      } else {
        scrollCurrentIntoView();
      }

      interaction = attachInteraction(document.body, session, {
        onChange: () => {
          speech.stopReadingAloud(false);
          updateProgress();
          scheduleSave();
          guided.startLoop();
        },
        onNavigate: (fromKeyboard = false) => {
          const resumeSpeech = fromKeyboard && speech.readingAloud;
          // Keyboard navigation resumes narration immediately afterwards. Pause
          // instead of stopping so the Firefox Media Session transport survives.
          if (resumeSpeech) speech.pauseReadingAloud();
          else speech.stopReadingAloud();
          updateProgress();
          scheduleSave();
          scrollCurrentIntoView();
          guided.startLoop();
          if (resumeSpeech) {
            speech.scheduleRestore(() => {
              if (!tornDown) speech.startReadingAloud();
            });
          }
        },
        onToggleGuided: (fromKeyboard = false) => {
          if (fromKeyboard && settings.guidedReading && speech.readingAloud) {
            speech.setKeyboardSpeechRestore(true);
          } else if (!fromKeyboard) {
            speech.setKeyboardSpeechRestore(false);
          }
          guided.setGuided(!settings.guidedReading);
        },
        isGuidedReading: () => settings.guidedReading,
        onGuidedArrow: () => guided.manualPause(),
        onSentenceHover: (hovered) => {
          void browser.runtime.sendMessage({ type: 'CS_SENTENCE_HOVER', hovered } satisfies RuntimeMessage).catch(() => { });
        },
      });

      document.addEventListener('pointerdown', recordReadingActivity, { passive: true });
      document.addEventListener('mousemove', recordReadingActivity, { passive: true });
      document.addEventListener('scroll', recordReadingActivity, { passive: true, capture: true });
      document.addEventListener('keydown', recordReadingActivity);

      const snap = session.getSnapshot();
      updateControls();
      console.log(`[Just Read It] session ready: ${snap.total} sentences, ${snap.readIds.size} read, guided=${settings.guidedReading}`);

      // A previous visibility or retained-session teardown may have paused the
      // guided controller. A newly ready session must clear that pause before
      // its initial guided frame can run.
      if (session.getCurrentId() !== null) guided.resume();
      return true;
    }

    async function resetPage(): Promise<void> {
      if (tornDown || !readerEnabled) {
        try {
          await clearPageState(location.href);
        } catch (err) {
          console.error('[Just Read It] reset failed', err);
        }
        return;
      }
      const url = sessionUrl ?? location.href;
      activationGen++;
      const resetGeneration = activationGen;
      setStatus('Resetting reading progress', { indefinite: true });
      // Keep the sentence wrappers and controls in place. Resetting only
      // replaces reading state, avoiding an expensive unwrap and re-wrap.
      await deactivateSession(true);
      try {
        await persistence.wait();
        await clearPageState(url);
      } catch (err) {
        console.error('[Just Read It] reset failed', err);
      }
      if (!readerEnabled || tornDown || activationGen !== resetGeneration) return;
      const ready = await startSession(url, resetGeneration);
      if (!ready) return;
      console.log('[Just Read It] page reset');
    }

    async function activate(): Promise<number> {
      if (tornDown || !readerEnabled) return 0;
      if (wrap) {
        // A disabled reader can survive an SPA route change. Its retained
        // wrapper belongs to the previous URL and cannot be reused for the
        // new document, even though the controls host can be retained.
        if (sessionUrl && sessionUrl !== location.href) {
          setStatus('Preparing new page');
          await teardownSession(true, undefined, true);
          if (tornDown || !readerEnabled) return 0;
        }
      }
      if (wrap) {
        if (session) return wrap.total;
        if (sessionUrl) {
          const ready = await startSession(sessionUrl, activationGen);
          return ready && wrap ? wrap.total : 0;
        }
        return 0;
      }
      const activationUrl = location.href;
      const activationGeneration = activationGen;
      if (!canAnnotateDocument(document)) {
        console.warn('[Just Read It] reading mode is unavailable while editing this page');
        notifyState(false);
        return 0;
      }
      try {
        document.documentElement.classList.add('jri-reader-active');
        sessionUrl = location.href;
        setStatus('Preparing reader controls', { indefinite: true });
        controls?.destroy();
        controls = createReaderControls(
          document,
          CSS,
          {
            previous: () => navigateSentence('previous'),
            next: () => navigateSentence('next'),
            markAllRead: () => {
              if (!session) return;
              speech.stopReadingAloud();
              const targetSession = session;
              const targetGeneration = activationGen;
              void targetSession.markAllReadAsync().then(() => {
                if (tornDown || session !== targetSession || activationGen !== targetGeneration) return;
                updateProgress();
                scheduleSave();
              });
            },
            toggleGuided: () => {
              speech.clearKeyboardSpeechRestore();
              if (settings.guidedReading && speech.paused) {
                startReadAloud();
                return;
              }
              readAloudEnabledGuided = false;
              guided.setGuided(!settings.guidedReading);
            },
            toggleRsvp: (enabled) => {
              applySettings({ rsvpEnabled: enabled });
              void saveSettings({ rsvpEnabled: enabled });
            },
            pauseGuidedForSettings: () => {
              if (settings.guidedReading) guided.setGuided(false);
            },
            toggleReadAloud: () => {
              speech.clearKeyboardSpeechRestore();
              if (speech.readingAloud && !speech.paused) speech.stopReadingAloud();
              else startReadAloud();
            },
            toggleLightsOut: () => {
              if (!session) return;
              lightsOutEnabled = !lightsOutEnabled;
              if (!settings.guidedReading) normalLightsOutEnabled = lightsOutEnabled;
              void session.setLightsOutAsync(lightsOutEnabled, true);
              document.body?.classList.toggle('jri-lights-out-mode', lightsOutEnabled);
              updateProgress();
            },
            reset: () => {
              void resetPage();
            },
            toggleStarred: async () => {
              if (!session || !sessionUrl) return;
              const next = !starred;
              starred = next;
              updateControls();
              try {
                await setPageStarred(sessionUrl, next);
              } catch (err) {
                starred = !next;
                updateControls();
                console.error('[Just Read It] set starred failed', err);
              }
            },
            openHome: () => {
              void browser.runtime
                .sendMessage({
                  type: 'CS_OPEN_HOME',
                } satisfies RuntimeMessage)
                .catch(() => { });
            },
            openProgressShare: () => {
              if (!session) return;
              const snapshot = session.getSnapshot();
              const url = shareProgressUrl(location.href, {
                total: snapshot.total,
                readIds: Array.from(snapshot.readIds),
                currentId: snapshot.currentId,
              });
              if (!url) return;
              controls?.openProgressShare(url);
            },
            shareProgressUrl: async (url) => {
              if (window.matchMedia('(max-width: 600px)').matches && typeof navigator.share === 'function') {
                try {
                  await navigator.share({ title: document.title || 'Continue reading', url });
                  controls?.setStatus('Continuation link shared');
                  setTimeout(() => updateProgress(), 1800);
                  return true;
                } catch (error) {
                  controls?.setStatus(
                    error instanceof DOMException && error.name !== 'AbortError'
                      ? 'Unable to open share sheet; try again'
                      : 'Share cancelled',
                  );
                  return false;
                }
              }
              await copyText(url);
              return false;
            },
            copyProgressUrl: async (url) => {
              const copied = await copyText(url);
              if (copied) {
                controls?.setStatus('Continuation link copied');
                setTimeout(() => updateProgress(), 1800);
              } else {
                controls?.setStatus('Copy failed; try again');
              }
            },
            close: () => {
              // The content lifecycle owns the UI and active session. Do not
              // send a second disable request through the background here: on
              // SPA navigation it can race the pending navigation transition.
              void lifecycle.deactivate().catch((err) => {
                console.error('[Just Read It] disable failed', err);
                void lifecycle.cleanup().catch((cleanupErr) => console.error('[Just Read It] cleanup failed', cleanupErr));
              });
            },
            setRate: (rate) => {
              applySettings({ rate });
              void saveSettings({ rate });
            },
            setGuidedRate: (guidedRate) => {
              applySettings({ guidedRate });
              void saveSettings({ guidedRate });
            },
            setVoice: (voiceURI) => {
              applySettings({ voiceURI });
              void saveSettings({ voiceURI });
            },
            setFontScale: (nextFontScale) => {
              applySettings({ fontScale: nextFontScale }, true);
              hasPerSiteFontScale = true;
              if (sessionUrl) void savePerSiteSettings(sessionUrl, { fontScale: nextFontScale });
            },
            setReaderUiTheme: (readerUiTheme) => {
              controls?.setTheme(readerUiTheme === 'auto' ? resolveReaderUiTheme() : readerUiTheme);
            },
            selectContentCandidate: (candidateId) => selectContentCandidate(candidateId),
          },
          currentControlsState(),
          resolveReaderUiTheme(),
          'auto',
        );
        setStatus('Preparing reader controls', { indefinite: true });
        // Let the browser paint the controls before scanning and rewriting a
        // large document. A timer after rAF resumes in a later task, while a
        // bare rAF callback can continue before the current frame is painted.
        await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        if (tornDown || !readerEnabled) {
          await deactivateSession();
          return 0;
        }
        const contentCandidates = getContentCandidates(document);
        const savedCandidate = await loadContentCandidate(sessionUrl);
        if (tornDown || !readerEnabled || activationGeneration !== activationGen || location.href !== activationUrl) {
          await deactivateSession();
          return 0;
        }
        contentCandidateId = contentCandidates.some((candidate) => candidate.id === savedCandidate)
          ? (savedCandidate ?? undefined)
          : contentCandidates[0]?.id;
        cachedContentCandidates = contentCandidates.map(({ id, label, confidence }) => ({
          id,
          label,
          confidence,
          selected: id === contentCandidateId,
        }));
        controls?.setContentCandidates(cachedContentCandidates);
        void browser.runtime
          .sendMessage({
            type: 'CS_CONTENT_CANDIDATES',
            candidates: cachedContentCandidates,
          } satisfies RuntimeMessage)
          .catch(() => { });
        setStatus('Finding sentences', { indefinite: true });
        wrap = await wrapSentencesAsync(document, {
          batchSize: 24,
          isCancelled: () => tornDown || !readerEnabled || activationGeneration !== activationGen || location.href !== activationUrl,
          onProgress: (processed, total) => {
            if (total > 0) {
              setStatus('Preparing your reading view', { progress: Math.floor((processed / total) * 100) });
            }
          },
          contentCandidate: contentCandidateId,
        });
        if (!wrap) {
          await deactivateSession(true);
          return 0;
        }
        if (wrap.total < 3) {
          const candidates = cachedContentCandidates;
          await teardownSession(true, undefined, true);
          controls?.setContentCandidates(candidates);
          controls?.setVisible(true);
          setStatus('No long-form readable content found.');
          notifyState(false);
          return 0;
        }
        setStatus('Improving readability', { indefinite: true });
        setStatus('Wrapping up', { indefinite: true });
        console.log(`[Just Read It] wrapped ${wrap.total} sentences`);
        const ready = await startSession(sessionUrl, activationGen);
        if (!ready) {
          notifyState(false);
          return 0;
        }
        notifyState(true);
        return wrap?.total ?? 0;
      } catch (err) {
        console.error('[Just Read It] wrap failed', err);
        await teardownSession();
        notifyState(false);
        return 0;
      }
    }

    async function deactivateSession(keepUiVisible = false): Promise<void> {
      pauseTimeTracking();
      document.removeEventListener('pointerdown', recordReadingActivity);
      document.removeEventListener('mousemove', recordReadingActivity);
      document.removeEventListener('scroll', recordReadingActivity, true);
      document.removeEventListener('keydown', recordReadingActivity);
      speech.clearKeyboardSpeechRestore();
      speech.stopReadingAloud();
      mediaSession.clear();
      guided.teardown();
      persistence.clearTimer();
      if (interaction) {
        interaction.detach();
        interaction = null;
      }
      if (session) {
        // The wrapper is retained for fast reactivation. Its classes are
        // inert while the reader stylesheet is absent, so do not scan every
        // sentence just to remove them.
        session.dispose();
        session = null;
      }
      removeParty();
      document.body?.classList.remove('jri-guided-mode');
      document.body?.classList.remove('jri-lights-out-mode');
      if (!keepUiVisible) {
        controls?.setVisible(false);
        removeReaderStyle(document);
      }
    }

    async function teardownSession(
      preserveControls = false,
      onUnwrapProgress?: (processed: number, total: number) => void,
      keepUiVisible = false,
    ): Promise<void> {
      await deactivateSession(keepUiVisible);
      if (progress && !preserveControls) {
        progress.destroy();
        progress = null;
      }
      if (controls && !preserveControls) {
        controls.destroy();
        controls = null;
      }
      if (wrap) {
        await wrap.unwrapAsync(onUnwrapProgress);
        wrap = null;
      }
      cachedContentCandidates = [];
      contentCandidateId = undefined;
      sessionUrl = null;
      sessionTitle = '';
      sessionMetadata = {};
      if (!preserveControls) removeReaderStyle(document);
    }

    function notifyState(enabled: boolean): void {
      reportState(enabled);
    }

    function contentCandidates(): ContentCandidateInfo[] {
      return cachedContentCandidates;
    }

    function selectContentCandidate(candidateId: string): void {
      if (candidateId === contentCandidateId) return;
      const nextUrl = sessionUrl ?? location.href;
      void saveContentCandidate(nextUrl, candidateId)
        .then(async () => {
          activationGen++;
          const selectionGeneration = activationGen;
          setStatus('Switching reading content');
          // Preserve the controls and status while replacing the wrapped content.
          // Candidate changes still require unwrapping before selecting a new scope.
          await teardownSession(true, undefined, true);
          if (tornDown || !readerEnabled || activationGen !== selectionGeneration) return;
          contentCandidateId = candidateId;
          const total = await activate();
          if (total === 0 && readerEnabled) setStatus('Unable to load selected content.');
        })
        .catch((err) => {
          console.error('[Just Read It] content candidate switch failed', err);
          if (readerEnabled) setStatus('Unable to switch reading content.');
        });
    }

    const lifecycleContext: ReaderLifecycleContext = {
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
        return activationGen;
      },
      incrementActivationGeneration: () => {
        activationGen++;
      },
      get activationTimer() {
        return activateTimer;
      },
      setActivationTimer: (timer) => {
        activateTimer = timer;
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
      setUnwatchUrl: (unwatch) => {
        unwatchUrl = unwatch;
      },
      get sessionToken() {
        return sessionToken;
      },
      setSessionToken: (token) => {
        sessionToken = token;
      },
      isReaderReady: () => !tornDown && wrap !== null && session !== null,
      activate,
      teardownSession,
      deactivateSession,
      flushSave,
      pauseTimeTracking,
      resumeTimeTracking,
      pauseGuidedPlayback: () => guided.pause(),
      resumeGuidedPlayback: () => guided.resume(),
      stopSpeech: () => speech.stopReadingAloud(),
      isReadingAloud: () => speech.readingAloud,
      updateWakeLock,
      releaseWakeLock,
      applySettings,
      setStatus,
      reportState: notifyState,
      resetPage: () => {
        void resetPage();
      },
      contentCandidates,
      handleRuntimeMessage: (msg) => {
        if (msg.type === 'BG_MARK_PREVIOUS_READ') markPreviousRead();
        else if (msg.type === 'BG_TTS_EVENT') speech.handleTtsEvent(msg);
        else if (msg.type === 'BG_SELECT_CANDIDATE') selectContentCandidate(msg.candidateId);
      },
      setWindowActive: (active) => {
        window.__jriActive = active;
      },
    };
    const lifecycle = createReaderLifecycle(lifecycleContext);
    lifecycle.install();
  },
});
