import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReaderControls, rsvpFocusIndex, type ControlActions, type ReaderControlsState } from '../../../lib/web/reader/controls';

function actions(overrides: Partial<ControlActions> = {}): ControlActions {
  return {
    previous: () => {},
    next: () => {},
    markAllRead: () => {},
    toggleGuided: () => {},
    toggleRsvp: () => {},
    pauseGuidedForSettings: () => {},
    toggleReadAloud: () => {},
    toggleLightsOut: () => {},
    reset: () => {},
    toggleStarred: () => {},
    openHome: () => {},
    close: () => {},
    setRate: () => {},
    setGuidedRate: () => {},
    setTransientGuidedRate: () => {},
    setVoice: () => {},
    setFontScale: () => {},
    openProgressShare: () => {},
    shareProgressUrl: () => true,
    copyProgressUrl: () => {},
    ...overrides,
  };
}

function controlState(overrides: Partial<ReaderControlsState> = {}): ReaderControlsState {
  return {
    guidedReading: false,
    guidedReadingPaused: false,
    rsvpEnabled: false,
    readingAloud: false,
    readingAloudPaused: false,
    complete: false,
    status: { minutes: '', text: '' },
    speechAvailable: false,
    lightsOut: false,
    starred: false,
    rate: 1,
    guidedRate: 1,
    voiceURI: null,
    fontScale: 1,
    currentSentence: null,
    totalSentences: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('browser', { runtime: { getURL: (path: string) => path } });
  vi.stubGlobal('speechSynthesis', { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal('Option', function (this: HTMLOptionElement, text: string, value: string) {
    const option = document.createElement('option');
    option.text = text;
    option.value = value;
    return option;
  });
  vi.stubGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return { documentElement: { children: [] } };
      }
    },
  );
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.show = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  for (const proto of [HTMLElement.prototype, Element.prototype]) {
    if (!('setPointerCapture' in proto)) {
      (proto as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    }
    if (!('releasePointerCapture' in proto)) {
      (proto as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
    }
    if (!('hasPointerCapture' in proto)) {
      (proto as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
    }
  }
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('rsvpFocusIndex', () => {
  it.each([
    ['a', 0],
    ['read', 1],
    ['reading', 2],
    ['recognition', 3],
    ['extraordinarily', 4],
  ])('uses the ORP band for %s', (word, expected) => {
    expect(rsvpFocusIndex(word)).toBe(expected);
  });

  it.each([
    ['reading,', 2],
    ['“reading,”', 3],
    ['...extraordinary!', 6],
    ['12345.', 1],
  ])('does not let surrounding punctuation move the ORP for %s', (word, expected) => {
    expect(rsvpFocusIndex(word)).toBe(expected);
  });

  it('handles Unicode letters and a punctuation-only token', () => {
    expect(rsvpFocusIndex('“cafe”')).toBe(2);
    expect(rsvpFocusIndex('...')).toBe(0);
  });
});

describe('RSVP controls', () => {
  it('includes the current sentence in the reading status text', () => {
    const controls = createReaderControls(
      document,
      '',
      actions(),
      controlState({ currentSentence: 11, totalSentences: 84, status: { minutes: '~3m', text: '' } }),
    );
    const status = controls.root.querySelector<HTMLElement>('.jri-navigation-status')!;
    const readingStatus = controls.root.querySelector<HTMLElement>('.jri-reading-text')!;
    const navigation = controls.root.querySelector('.jri-navigation')!;

    expect(status.textContent).toBe('14%');
    expect(readingStatus.querySelector('.jri-reading-time')?.textContent).toBe('~3m left');
    expect(readingStatus.querySelector('.jri-reading-sentence-position')?.textContent).toBe('(12/84 sentences)');
    expect(controls.root.querySelector('.jri-reading-progress')?.textContent).toBe('14%');
    expect(controls.root.querySelector('.jri-reading-progress-ring')?.getAttribute('aria-label')).toBe('14% complete, sentence 12 of 84');
    expect(status.getAttribute('aria-label')).toBeNull();
    expect(navigation.querySelector('.jri-reading-progress-ring')).not.toBeNull();
    expect(navigation.querySelectorAll('button')).toHaveLength(2);
    expect(navigation.querySelectorAll('img')).toHaveLength(0);
    controls.destroy();
  });

  it('disables sentence navigation at the available boundaries', () => {
    const controls = createReaderControls(document, '', actions(), controlState({ currentSentence: 0, totalSentences: 2 }));
    const previous = controls.root.querySelector<HTMLButtonElement>('.jri-navigation button:first-child')!;
    const next = controls.root.querySelector<HTMLButtonElement>('.jri-navigation button:last-child')!;

    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    controls.update(controlState({ currentSentence: 1, totalSentences: 2 }));
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(true);
    controls.destroy();
  });

  it('renders large sentence positions in the status text', () => {
    const controls = createReaderControls(
      document,
      '',
      actions(),
      controlState({ currentSentence: 9270, totalSentences: 14443, status: { minutes: '~3m', text: '' } }),
    );
    const status = controls.root.querySelector<HTMLElement>('.jri-reading-text')!;

    expect(status.querySelector('.jri-reading-time')?.textContent).toBe('~3m left');
    expect(status.querySelector('.jri-reading-sentence-position')?.textContent).toBe('(9271/14443 sentences)');
    expect(controls.root.querySelector('.jri-reading-progress-ring')?.getAttribute('aria-label')).toBe(
      '64% complete, sentence 9271 of 14443',
    );
    controls.destroy();
  });

  it('keeps oversized sentence positions out of the compact progress ring', () => {
    const controls = createReaderControls(
      document,
      '',
      actions(),
      controlState({ currentSentence: 122443, totalSentences: 2339944, status: { minutes: '~3h', text: '' } }),
    );

    const progressRing = controls.root.querySelector<HTMLElement>('.jri-reading-progress-ring')!;
    expect(progressRing.textContent).toBe('5%');
    expect(progressRing.getAttribute('aria-label')).toBe('5% complete, sentence 122444 of 2339944');
    controls.destroy();
  });

  it('reports that no sentence is selected after the article is complete', () => {
    const controls = createReaderControls(
      document,
      '',
      actions(),
      controlState({ currentSentence: null, totalSentences: 2, complete: true }),
    );
    const status = controls.root.querySelector<HTMLElement>('.jri-navigation-status')!;

    expect(status.textContent).toBe('');
    expect(status.getAttribute('aria-label')).toBeNull();
    expect(controls.root.querySelector('.jri-navigation-position-text')).toBeNull();
    expect(controls.root.querySelectorAll<HTMLButtonElement>('.jri-navigation button:disabled')).toHaveLength(2);
    controls.destroy();
  });

  it('removes the sentence count from the status after the article is complete', () => {
    const controls = createReaderControls(document, '', actions(), controlState({ currentSentence: 48, totalSentences: 49 }));
    const status = controls.root.querySelector<HTMLElement>('.jri-reading-text')!;

    controls.update(
      controlState({ currentSentence: null, totalSentences: 49, complete: true, status: { minutes: 'Article complete', text: '' } }),
    );

    expect(status.textContent).toBe('Article complete');
    controls.destroy();
  });

  it('shows a left progress ring and centered remaining time', () => {
    const controls = createReaderControls(
      document,
      '',
      actions(),
      controlState({ currentSentence: 21, totalSentences: 34, status: { minutes: '~3m', text: '' } }),
    );

    expect(controls.root.querySelector('.jri-reading-time')?.textContent).toBe('~3m left');
    expect(controls.root.querySelector('.jri-reading-progress-ring')?.getAttribute('aria-label')).toBe('64% complete, sentence 22 of 34');
    const statusActions = controls.root.querySelector('.jri-status-actions')!;
    expect(statusActions.querySelectorAll('button')).toHaveLength(2);
    expect(statusActions.textContent).toBe('');
    controls.destroy();
  });

  it('uses percentage status updates to fill the progress ring', () => {
    const controls = createReaderControls(document, '', actions(), controlState());

    controls.setStatus('Preparing your reading view 38%');

    const progressRing = controls.root.querySelector<HTMLElement>('.jri-reading-progress-ring')!;
    expect(progressRing.textContent).toBe('38%');
    expect(progressRing.style.getPropertyValue('--jri-progress')).toBe('38%');
    expect(progressRing.getAttribute('aria-label')).toBe('38% complete');
    expect(controls.root.querySelector<HTMLElement>('.jri-reading-text')?.hidden).toBe(true);
    const loader = controls.root.querySelector<HTMLElement>('.jri-reading-loader')!;
    expect(loader.hidden).toBe(false);
    expect(loader.textContent).toBe('Preparing your reading view');
    controls.destroy();
  });

  it('replaces the loader with the reading text once the reader is ready', () => {
    const controls = createReaderControls(document, '', actions(), controlState());

    controls.setStatus('Preparing your reading view', { indefinite: true });
    controls.update(controlState({ currentSentence: 0, totalSentences: 10, status: { minutes: '~2m', text: '' } }));

    const text = controls.root.querySelector<HTMLElement>('.jri-reading-text')!;
    const loader = controls.root.querySelector<HTMLElement>('.jri-reading-loader')!;
    expect(text.hidden).toBe(false);
    expect(text.textContent).toBe('~2m left(1/10 sentences)');
    expect(loader.hidden).toBe(true);
    expect(loader.textContent).toBe('');
    controls.destroy();
  });

  it('supports an indefinite loading ring', () => {
    const controls = createReaderControls(document, '', actions(), controlState());

    controls.setStatus('Finding sentences', { indefinite: true });

    const progressRing = controls.root.querySelector<HTMLElement>('.jri-reading-progress-ring')!;
    expect(progressRing.dataset.indefinite).toBe('true');
    expect(progressRing.textContent).toBe('');
    expect(progressRing.getAttribute('aria-label')).toBe('Finding sentences');
    controls.destroy();
  });

  it('stops the indefinite ring when reading starts at zero percent', () => {
    const controls = createReaderControls(document, '', actions(), controlState());

    controls.setStatus('Preparing your reading view', { indefinite: true });
    controls.update(controlState({ currentSentence: 0, totalSentences: 10, status: { minutes: '~2m', text: '', progress: '0%' } }));

    const progressRing = controls.root.querySelector<HTMLElement>('.jri-reading-progress-ring')!;
    expect(progressRing.dataset.indefinite).toBe('false');
    expect(progressRing.textContent).toBe('0%');
    expect(progressRing.style.getPropertyValue('--jri-progress')).toBe('10%');
    controls.destroy();
  });

  it('shows the completion message with progress in navigation', () => {
    const controls = createReaderControls(
      document,
      '',
      actions(),
      controlState({ complete: true, status: { minutes: 'Article complete', text: '' } }),
    );
    const status = controls.root.querySelector('.jri-reading-status')!;

    expect(status.querySelector('.jri-reading-text')?.textContent).toBe('Article complete');
    expect(status.textContent).toBe('Article complete');
    expect(controls.root.querySelector('.jri-navigation-status')?.textContent).toBe('');
    controls.destroy();
  });

  it('marks the completion ring with the success state', () => {
    const controls = createReaderControls(
      document,
      '',
      actions(),
      controlState({ complete: true, status: { minutes: 'Article complete', text: '' } }),
    );

    expect(controls.root.querySelector<HTMLElement>('.jri-reading-progress-ring')?.dataset.complete).toBe('true');
    controls.destroy();
  });

  it('puts progress in navigation with time left and actions on opposite sides', () => {
    const toggleStarred = vi.fn();
    const openProgressShare = vi.fn();
    const controls = createReaderControls(
      document,
      '',
      actions({ toggleStarred, openProgressShare }),
      controlState({ currentSentence: 21, totalSentences: 34, status: { minutes: '~2h 5m', text: '' } }),
    );
    const status = controls.root.querySelector('.jri-reading-status')!;
    const [minutes, loader, statusActions] = Array.from(status.children);

    expect(controls.root.querySelector('.jri-navigation-status .jri-reading-progress-ring')).not.toBeNull();
    expect(minutes?.classList.contains('jri-reading-text')).toBe(true);
    expect(minutes?.querySelector('.jri-reading-time')?.textContent).toBe('~2h 5m left');
    expect(minutes?.querySelector('.jri-reading-sentence-position')?.textContent).toBe('(22/34 sentences)');
    expect(minutes?.textContent).toContain('~2h 5m left');
    expect(minutes?.textContent).toContain('22/34');
    expect((loader as HTMLElement | undefined)?.hidden).toBe(true);
    expect(statusActions?.classList.contains('jri-status-actions')).toBe(true);
    const [share, star] = Array.from(statusActions!.querySelectorAll<HTMLButtonElement>('button'));
    expect(share?.title).toBe('Continue on another device');
    expect(star?.title).toBe('Star article');
    star?.click();
    share?.click();
    expect(toggleStarred).toHaveBeenCalledTimes(1);
    expect(openProgressShare).toHaveBeenCalledTimes(1);
    controls.destroy();
  });

  it('hides the UI host despite its important style reset', () => {
    const controls = createReaderControls(document, '', actions(), controlState());
    const host = document.getElementById('jri-ui-host') as HTMLDivElement;

    controls.setVisible(false);
    expect(host.style.getPropertyValue('display')).toBe('none');
    expect(host.style.getPropertyPriority('display')).toBe('important');

    controls.setVisible(true);
    expect(host.style.getPropertyValue('display')).toBe('block');
    controls.destroy();
  });

  it('re-applies viewport constraints when the controls are first shown', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: query === '(max-width: 600px)' }) as MediaQueryList);
    const viewport = { offsetTop: 0, offsetLeft: 0, width: 360, height: 600, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('visualViewport', viewport);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const controls = createReaderControls(document, '', actions(), controlState());
    const host = document.getElementById('jri-ui-host') as HTMLDivElement;
    const bar = controls.root.querySelector<HTMLElement>('#jri-controls')!;

    Object.defineProperty(bar, 'offsetHeight', { get: () => 120, configurable: true });
    controls.setVisible(true);
    await vi.advanceTimersByTimeAsync(32);

    expect(host.style.getPropertyValue('display')).toBe('block');
    expect(bar.style.left).toBe('8px');
    expect(bar.style.width).toBe('344px');
    expect(bar.style.top).toBe('472px');
    expect(bar.style.bottom).toBe('auto');
    controls.destroy();
  });

  it('minimizes and restores mobile controls without changing the RSVP view', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: query === '(max-width: 600px)' }) as MediaQueryList);
    const viewport = { offsetTop: 0, offsetLeft: 0, width: 360, height: 600, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('visualViewport', viewport);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const controls = createReaderControls(document, '', actions(), controlState());
    controls.update(controlState({ rsvpEnabled: true }));
    const bar = controls.root.querySelector<HTMLElement>('#jri-controls')!;
    const minimized = controls.root.querySelector<HTMLElement>('#jri-minimized-controls')!;
    const overlay = controls.root.querySelector<HTMLElement>('#jri-rsvp-overlay')!;
    Object.defineProperty(bar, 'offsetHeight', { value: 120, configurable: true });

    controls.root.querySelector<HTMLButtonElement>('.jri-minimize-controls')!.click();
    expect(bar.hidden).toBe(true);
    expect(minimized.hidden).toBe(false);
    expect(overlay.hidden).toBe(false);
    expect(overlay.style.bottom).toBe('78px');
    const guided = minimized.querySelector<HTMLButtonElement>('.jri-minimized-guided')!;
    expect(guided.title).toBe('Enable Guided Reading');

    controls.update(controlState({ guidedReading: true, rsvpEnabled: true }));
    expect(guided.title).toBe('Disable Guided Reading');

    minimized.querySelector<HTMLButtonElement>('.jri-minimized-restore')!.click();
    await vi.advanceTimersByTimeAsync(32);
    expect(bar.hidden).toBe(false);
    expect(minimized.hidden).toBe(true);
    expect(bar.style.top).toBe('472px');
    expect(overlay.hidden).toBe(false);
    controls.destroy();
  });

  it('uses single sentence chevrons', () => {
    const controls = createReaderControls(document, '', actions(), controlState());
    const navigation = controls.root.querySelector('.jri-navigation')!;
    expect(navigation.querySelectorAll('button')).toHaveLength(2);
    expect(navigation.querySelectorAll('svg')).toHaveLength(2);
    expect(navigation.querySelector('.jri-navigation-center')).toBeNull();
    controls.destroy();
  });

  it('places Read Aloud after Auto Dimming', () => {
    const controls = createReaderControls(document, '', actions(), controlState({ speechAvailable: true }));
    const modes = controls.root.querySelector('.jri-reading-modes')!;
    const buttons = Array.from(modes.querySelectorAll<HTMLButtonElement>('button'));

    expect(buttons[0]?.title).toBe('Enable Guided Reading');
    expect(buttons[1]?.title).toBe('Turn Auto Dimming on');
    expect(buttons[2]?.title).toBe('Start reading aloud');
    controls.destroy();
  });

  it('shows resume while read aloud is paused', () => {
    const controls = createReaderControls(document, '', actions(), controlState({ speechAvailable: true }));
    controls.update(controlState({ readingAloud: true, readingAloudPaused: true, speechAvailable: true }));

    const readAloud = controls.root.querySelector<HTMLButtonElement>('.jri-read-aloud')!;
    expect(readAloud.title).toBe('Resume reading aloud');
    expect(readAloud.getAttribute('aria-pressed')).toBe('false');
    controls.destroy();
  });

  it('shows guided reading as paused while media narration is paused', () => {
    const controls = createReaderControls(document, '', actions(), controlState());
    controls.update(controlState({ guidedReading: true, guidedReadingPaused: true }));

    const guided = controls.root.querySelector<HTMLButtonElement>('.jri-reading-modes button:first-child')!;
    expect(guided.title).toBe('Resume Guided Reading');
    expect(guided.getAttribute('aria-pressed')).toBe('false');
    controls.destroy();
  });

  it('keeps the RSVP view enabled while guided playback is paused', () => {
    const controls = createReaderControls(document, '', actions(), controlState());
    controls.update(controlState({ guidedReading: true, rsvpEnabled: true }));
    controls.update(controlState({ guidedReading: false, rsvpEnabled: true }));

    const overlay = controls.root.querySelector<HTMLElement>('#jri-rsvp-overlay')!;
    const input = controls.root.querySelector<HTMLInputElement>('.jri-rsvp-control input')!;
    expect(overlay.hidden).toBe(false);
    expect(input.checked).toBe(true);
    controls.destroy();
  });

  it('enables RSVP without toggling guided playback', () => {
    const toggleRsvp = vi.fn();
    const toggleGuided = vi.fn();
    const controls = createReaderControls(document, '', actions({ toggleRsvp, toggleGuided }), controlState());
    const input = controls.root.querySelector<HTMLInputElement>('.jri-rsvp-control input')!;
    const settings = controls.root.querySelector<HTMLDialogElement>('#jri-speed-popover')!;
    const close = vi.spyOn(settings, 'close');

    input.checked = true;
    input.dispatchEvent(new Event('change'));

    expect(toggleRsvp).toHaveBeenCalledWith(true);
    expect(toggleGuided).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    controls.destroy();
  });

  it('pauses guided playback before opening reading settings', () => {
    const pauseGuidedForSettings = vi.fn();
    const controls = createReaderControls(document, '', actions({ pauseGuidedForSettings }), controlState());
    const settings = controls.root.querySelector<HTMLButtonElement>('.jri-speed-toggle')!;

    settings.click();

    expect(pauseGuidedForSettings).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(pauseGuidedForSettings).toHaveBeenCalledTimes(1);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    controls.destroy();
  });

  it('loads voices after opening the settings dialog', () => {
    const getVoices = vi.fn(() => []);
    vi.stubGlobal('speechSynthesis', { addEventListener: () => {}, removeEventListener: () => {}, getVoices });
    const controls = createReaderControls(document, '', actions(), controlState());

    controls.root.querySelector<HTMLButtonElement>('.jri-speed-toggle')!.click();
    expect(getVoices).not.toHaveBeenCalled();
    vi.runAllTimers();

    expect(getVoices).toHaveBeenCalledTimes(1);
    controls.destroy();
  });

  it('confirms before marking a document complete or exiting reading mode', () => {
    const markAllRead = vi.fn();
    const close = vi.fn();
    const controls = createReaderControls(document, '', actions({ markAllRead, close }), controlState());
    const buttons = Array.from(controls.root.querySelectorAll<HTMLButtonElement>('.jri-button'));
    const markAll = buttons.find((button) => button.title === 'Mark document as read')!;
    const exit = buttons.find((button) => button.title === 'Disable Web Reader')!;
    const cancel = () => controls.root.querySelector<HTMLButtonElement>('.jri-confirm-cancel')!.click();
    const submit = () => controls.root.querySelector<HTMLButtonElement>('.jri-confirm-submit')!.click();

    markAll.click();
    cancel();
    exit.click();
    cancel();
    expect(markAllRead).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();

    markAll.click();
    submit();
    exit.click();
    submit();
    expect(markAllRead).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    controls.destroy();
  });

  it('closes reading settings for its actions', () => {
    const controls = createReaderControls(document, '', actions(), controlState());
    const settings = controls.root.querySelector<HTMLDialogElement>('#jri-speed-popover')!;
    const close = vi.spyOn(settings, 'close');

    for (const button of controls.root.querySelectorAll<HTMLButtonElement>('.jri-action-button')) {
      button.click();
    }

    expect(close).toHaveBeenCalledTimes(3);
    controls.destroy();
  });

  it('orders Actions as reset, mark read, and home icons', () => {
    const controls = createReaderControls(document, '', actions(), controlState());
    const group = controls.root.querySelector('#jri-speed-popover .jri-actions-group')!;
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('.jri-action-button'));

    expect(buttons.map((button) => button.title)).toEqual(['Reset reading progress', 'Mark document as read', 'Open reading home']);
    expect(buttons.every((button) => button.textContent === '')).toBe(true);
    controls.destroy();
  });

  it('drags the RSVP view without moving its close button', () => {
    const controls = createReaderControls(document, '', actions(), controlState());
    controls.update(controlState({ rsvpEnabled: true }));
    const overlay = controls.root.querySelector<HTMLElement>('#jri-rsvp-overlay')!;
    const close = controls.root.querySelector<HTMLButtonElement>('.jri-rsvp-close')!;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, width: 300, height: 140 } as DOMRect);

    overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: 120, clientY: 120, button: 0, pointerId: 1, bubbles: true }));
    overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, clientY: 240, pointerId: 1, bubbles: true, cancelable: true }));
    overlay.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));

    expect(overlay.style.left).toBe('200px');
    expect(overlay.style.top).toBe('220px');
    expect(overlay.style.transform).toBe('none');
    close.dispatchEvent(new PointerEvent('pointerdown', { clientX: 220, clientY: 220, button: 0, pointerId: 2, bubbles: true }));
    expect(overlay.style.cursor).toBe('grab');
    controls.destroy();
  });

  it('changes guided reading speed from the RSVP view', () => {
    const setTransientGuidedRate = vi.fn();
    const controls = createReaderControls(
      document,
      '',
      actions({ setTransientGuidedRate }),
      controlState({ rsvpEnabled: true, guidedRate: 1.5 }),
    );
    const speed = controls.root.querySelector<HTMLElement>('.jri-rsvp-speed')!;
    const buttons = speed.querySelectorAll<HTMLButtonElement>('button');

    expect(speed.querySelector('output')?.textContent).toBe('1.5x');
    buttons[0]?.click();
    buttons[1]?.click();

    expect(setTransientGuidedRate).toHaveBeenNthCalledWith(1, 1.4);
    expect(setTransientGuidedRate).toHaveBeenNthCalledWith(2, 1.6);
    controls.destroy();
  });

  it('updates RSVP speed and disables controls at the supported limits', () => {
    const setTransientGuidedRate = vi.fn();
    const controls = createReaderControls(
      document,
      '',
      actions({ setTransientGuidedRate }),
      controlState({ rsvpEnabled: true, guidedRate: 0.5 }),
    );
    const speed = controls.root.querySelector<HTMLElement>('.jri-rsvp-speed')!;
    const [decrease, increase] = Array.from(speed.querySelectorAll('button'));
    expect(decrease!.disabled).toBe(true);
    decrease!.click();
    expect(setTransientGuidedRate).not.toHaveBeenCalled();
    increase!.click();
    expect(setTransientGuidedRate).toHaveBeenLastCalledWith(0.6);
    controls.update(controlState({ rsvpEnabled: true, guidedRate: 3 }));
    expect(speed.querySelector('output')!.textContent).toBe('3.0x');
    expect(increase!.disabled).toBe(true);
    expect(decrease!.disabled).toBe(false);
    decrease!.click();
    expect(setTransientGuidedRate).toHaveBeenLastCalledWith(2.9);
    expect(controls.root.querySelector('#jri-rsvp-overlay')!.getAttribute('aria-modal')).toBe('false');
    controls.destroy();
  });

  it('does not start dragging when pressing an RSVP speed control', () => {
    const controls = createReaderControls(document, '', actions(), controlState({ rsvpEnabled: true }));
    const overlay = controls.root.querySelector<HTMLElement>('#jri-rsvp-overlay')!;
    const capture = vi.spyOn(overlay, 'setPointerCapture');
    controls.root
      .querySelector('.jri-rsvp-speed button')!
      .dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, bubbles: true }));
    expect(capture).not.toHaveBeenCalled();
    controls.destroy();
  });

  it('fits long words into the measured space before the RSVP controls', async () => {
    document.body.innerHTML = '<span class="jri-word jri-word-current">extraordinarily</span>';
    const controls = createReaderControls(document, '', actions(), controlState({ rsvpEnabled: true }));
    const overlay = controls.root.querySelector<HTMLElement>('#jri-rsvp-overlay')!;
    const rect = (left: number, right: number) => ({ left, right, width: right - left, top: 0, bottom: 180, height: 180 }) as DOMRect;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(rect(0, 400));
    vi.spyOn(overlay.querySelector('.jri-rsvp-speed')!, 'getBoundingClientRect').mockReturnValue(rect(348, 392));
    vi.spyOn(overlay.querySelector('.jri-rsvp-close')!, 'getBoundingClientRect').mockReturnValue(rect(348, 392));
    for (const name of ['prefix', 'focus', 'suffix']) {
      vi.spyOn(overlay.querySelector(`.jri-rsvp-${name}`)!, 'getBoundingClientRect').mockReturnValue(rect(24, 504));
    }
    await vi.advanceTimersByTimeAsync(32);
    expect(overlay.querySelector<HTMLElement>('.jri-rsvp-word')!.style.getPropertyValue('--jri-rsvp-word-scale')).toBe('0.5');
    controls.destroy();
  });

  it('clears desktop drag coordinates when switching to a mobile viewport', () => {
    let mobile = false;
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: mobile && query === '(max-width: 600px)' }) as MediaQueryList,
    );
    const controls = createReaderControls(document, '', actions(), controlState({ rsvpEnabled: true }));
    const overlay = controls.root.querySelector<HTMLElement>('#jri-rsvp-overlay')!;
    overlay.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1 }));
    overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: 600, clientY: 200, pointerId: 1 }));
    overlay.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    expect(overlay.style.left).not.toBe('');
    mobile = true;
    window.dispatchEvent(new Event('resize'));
    expect(overlay.style.left).toBe('');
    expect(overlay.style.transform).toBe('');
    controls.destroy();
  });

  it('constrains mobile RSVP drags vertically within the visual viewport like jri-controls', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: query === '(max-width: 600px)' }) as MediaQueryList);
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    vi.stubGlobal('visualViewport', {
      offsetTop: 40,
      offsetLeft: 0,
      width: 360,
      height: 600,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const controls = createReaderControls(document, '', actions(), controlState());
    controls.update(controlState({ rsvpEnabled: true }));
    const overlay = controls.root.querySelector<HTMLElement>('#jri-rsvp-overlay')!;
    overlay.style.left = '42px';
    overlay.style.right = 'auto';
    overlay.style.transform = 'none';
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ left: 8, top: 100, width: 344, height: 140 } as DOMRect);
    Object.defineProperty(overlay, 'offsetHeight', { value: 140, configurable: true });

    overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 150, button: 0, pointerId: 1, bubbles: true }));
    // Horizontal positions stay CSS-controlled; vertical drags clamp to the visual
    // viewport top (40) plus the 8px edge gap, as with jri-controls.
    overlay.dispatchEvent(
      new PointerEvent('pointermove', { clientX: -5000, clientY: -5000, pointerId: 1, bubbles: true, cancelable: true }),
    );

    expect(overlay.style.left).toBe('');
    expect(overlay.style.right).toBe('');
    expect(overlay.style.transform).toBe('');
    expect(overlay.style.top).toBe('48px');

    overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 5000, pointerId: 1, bubbles: true, cancelable: true }));
    overlay.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    // Bottom clamp: visual viewport bottom (640) minus height (140) minus 8px edge gap.
    expect(overlay.style.top).toBe('492px');
    expect(overlay.style.bottom).toBe('auto');
    controls.destroy();
    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
  });

  it('places the RSVP view above manually positioned mobile controls when first shown', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: query === '(max-width: 600px)' }) as MediaQueryList);
    const controls = createReaderControls(document, '', actions(), controlState());
    const bar = controls.root.querySelector<HTMLElement>('#jri-controls')!;
    const overlay = controls.root.querySelector<HTMLElement>('#jri-rsvp-overlay')!;
    bar.hidden = false;
    bar.hidden = false;
    bar.classList.add('jri-controls-manually-positioned');
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ top: 500, bottom: 600 } as DOMRect);
    Object.defineProperty(overlay, 'offsetHeight', { value: 140, configurable: true });

    controls.update(controlState({ rsvpEnabled: true }));

    expect(overlay.style.top).toBe('348px');
    expect(overlay.style.bottom).toBe('auto');
    controls.destroy();
  });

  it('keeps a dragged mobile RSVP view separated from the controls', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: query === '(max-width: 600px)' }) as MediaQueryList);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const controls = createReaderControls(document, '', actions(), controlState());
    const bar = controls.root.querySelector<HTMLElement>('#jri-controls')!;
    const overlay = controls.root.querySelector<HTMLElement>('#jri-rsvp-overlay')!;
    bar.hidden = false;
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ top: 500, bottom: 600 } as DOMRect);
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ left: 8, top: 100, width: 344, height: 140 } as DOMRect);
    Object.defineProperty(overlay, 'offsetHeight', { value: 140, configurable: true });

    controls.update(controlState({ rsvpEnabled: true }));
    overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 150, button: 0, pointerId: 1, bubbles: true }));
    overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 560, pointerId: 1, bubbles: true, cancelable: true }));

    expect(overlay.style.top).toBe('612px');
    controls.destroy();
  });
});

describe('progress sharing', () => {
  it('opens a modal with a QR code and closes it after the desktop copy action settles', async () => {
    let settleCopy!: () => void;
    const copyProgressUrl = vi.fn(() => new Promise<void>((resolve) => (settleCopy = resolve)));
    const controls = createReaderControls(document, '', actions({ copyProgressUrl }), controlState());

    controls.openProgressShare('https://example.com/article#jri1.progress');
    await vi.waitFor(() => expect(controls.root.querySelector('.jri-progress-share-qr svg')).not.toBeNull());
    const popover = controls.root.querySelector<HTMLDialogElement>('#jri-progress-share-popover')!;
    const copy = controls.root.querySelector<HTMLButtonElement>('.jri-progress-share-desktop')!;
    const close = vi.spyOn(popover, 'close');

    expect(popover.open).toBe(true);
    expect(popover.getAttribute('aria-label')).toBe('Continue reading on another device');
    expect(popover.querySelector('h2')?.textContent).toBe('Continue on another device');
    expect(popover.querySelector('p')?.textContent).toContain('Web Reader should be enabled on the other device');
    copy.click();
    expect(copyProgressUrl).toHaveBeenCalledWith('https://example.com/article#jri1.progress');
    expect(close).not.toHaveBeenCalled();
    settleCopy();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    controls.destroy();
  });

  it('uses a modal dialog for mobile sharing', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: query === '(max-width: 600px)' }) as MediaQueryList);
    const controls = createReaderControls(document, '', actions(), controlState());

    controls.openProgressShare('https://example.com/article#jri1.progress');

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    expect(HTMLDialogElement.prototype.show).not.toHaveBeenCalled();
    controls.destroy();
  });

  it('uses copying after a mobile share failure', async () => {
    const shareProgressUrl = vi.fn(() => false);
    const copyProgressUrl = vi.fn();
    const controls = createReaderControls(document, '', actions({ shareProgressUrl, copyProgressUrl }), controlState());
    controls.openProgressShare('https://example.com/article#jri1.progress');
    const share = controls.root.querySelector<HTMLButtonElement>('.jri-progress-share-mobile')!;

    expect(share.textContent).toBe('Share link');
    share.click();
    await vi.waitFor(() => expect(share.textContent).toBe('Copy link'));
    controls.openProgressShare('https://example.com/article#jri1.progress');
    share.click();

    expect(shareProgressUrl).toHaveBeenCalledTimes(1);
    expect(copyProgressUrl).toHaveBeenCalledWith('https://example.com/article#jri1.progress');
    controls.destroy();
  });
});
