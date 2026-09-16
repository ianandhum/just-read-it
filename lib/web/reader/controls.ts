import { getReadableVoices } from '../../voices';
import { BrowserQRCodeSvgWriter } from '@zxing/browser';
import { createDocking, type Docking } from './docking';
import { createSvg } from '../svg';
import { clampToViewport, mobileViewportBounds } from './viewport';

export interface ReaderStatus {
  minutes: string;
  text: string;
  progress?: string;
}

export interface ReaderControlsState {
  guidedReading: boolean;
  guidedReadingPaused: boolean;
  rsvpEnabled: boolean;
  readingAloud: boolean;
  readingAloudPaused: boolean;
  complete: boolean;
  status: ReaderStatus;
  speechAvailable: boolean;
  lightsOut: boolean;
  starred: boolean;
  rate: number;
  guidedRate: number;
  voiceURI: string | null;
  fontScale: number;
  currentSentence: number | null;
  totalSentences: number;
}

export interface ReaderControls {
  root: ShadowRoot;
  setVisible(visible: boolean): void;
  update(state: ReaderControlsState): void;
  getRsvpViewport(): { top: number; bottom: number } | null;
  openProgressShare(url: string): void;
  destroy(): void;
  setStatus(status: string, options?: { progress?: number; indefinite?: boolean }): void;
  setContentCandidates(candidates: { id: string; label: string; confidence: number; selected: boolean }[]): void;
  setTheme(theme: 'light' | 'dark'): void;
}

interface ConfirmDialog {
  ask(message: string, onConfirm: () => void): void;
  destroy(): void;
}

export interface ControlActions {
  previous(): void;
  next(): void;
  markAllRead(): void;
  toggleGuided(): void;
  toggleRsvp(enabled: boolean): void;
  pauseGuidedForSettings(): void;
  toggleReadAloud(): void;
  toggleLightsOut(): void;
  reset(): void;
  toggleStarred(): void;
  openHome(): void;
  selectContentCandidate?(candidateId: string): void;
  close(): void;
  setRate(rate: number): void;
  setGuidedRate(rate: number): void;
  setTransientGuidedRate(rate: number): void;
  setVoice(voiceURI: string | null): void;
  setFontScale(fontScale: number): void;
  setReaderUiTheme?(theme: 'auto' | 'light' | 'dark'): void;
  openProgressShare(): void;
  shareProgressUrl(url: string): Promise<boolean> | boolean;
  copyProgressUrl(url: string): Promise<void> | void;
}

const CONTROLS_ID = 'jri-controls';
const STATUS_ID = 'jri-status-pane';

const ICONS = {
  checkCheck: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  grip: '<circle cx="12" cy="5" r="1"/><circle cx="19" cy="5" r="1"/><circle cx="5" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="12" cy="19" r="1"/><circle cx="19" cy="19" r="1"/><circle cx="5" cy="19" r="1"/>',
  partyPopper:
    '<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-2.83-2-5 .83-.83 3.07.07 5 2Z"/>',
  chevronsDown: '<path d="m7 6 5 5 5-5"/><path d="m7 13 5 5 5-5"/>',
  chevronsLeft: '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>',
  chevronsRight: '<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>',
  chevronsUp: '<path d="m17 11-5-5-5 5"/><path d="m17 18-5-5-5 5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m6 15 6-6 6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  rotateCw: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  spotlight:
    '<path d="M15.295 19.562 16 22"/><path d="m17 16 3.758 2.098"/><path d="m19 12.5 3.026-.598"/><path d="M7.61 6.3a3 3 0 0 0-3.92 1.3l-1.38 2.79a3 3 0 0 0 1.3 3.91l6.89 3.597a1 1 0 0 0 1.342-.447l3.106-6.211a1 1 0 0 0-.447-1.341z"/><path d="M8 9V2"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  volume2:
    '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  play: '<polygon points="7 3 21 12 7 21 7 3"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  settings: '<path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  layoutGrid:
    '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minimize2: '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
  maximize2: '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>',
  extension: '<path d="M7 3h10v18H7z"/><path d="M9.5 7h5M9.5 11h5M9.5 15h3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  share:
    '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
} as const;

function iconSvg(paths: string): SVGSVGElement {
  const svg = createSvg(document, paths, {
    width: '24',
    height: '24',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  svg.classList.add('jri-icon');
  return svg;
}

function createReaderUiHost(doc: Document, css: string, theme: 'light' | 'dark'): { host: HTMLDivElement; root: ShadowRoot } {
  doc.getElementById('jri-ui-host')?.remove();
  const host = doc.createElement('div');
  host.id = 'jri-ui-host';
  host.setAttribute('aria-label', 'Just Read It extension interface');
  host.dataset.readerTheme = theme;
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');
  host.style.setProperty('inset', '0', 'important');
  host.style.setProperty('pointer-events', 'none', 'important');
  const root = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = css;
  root.appendChild(style);
  doc.body?.appendChild(host);
  return { host, root };
}

function syncUiHostToVisualViewport(host: HTMLDivElement): void {
  const viewport = window.visualViewport;
  if (!viewport || !window.matchMedia('(max-width: 600px)').matches) {
    host.style.removeProperty('width');
    host.style.removeProperty('height');
    host.style.removeProperty('left');
    host.style.removeProperty('top');
    return;
  }
  host.style.setProperty('left', `${viewport.offsetLeft}px`, 'important');
  host.style.setProperty('top', `${viewport.offsetTop}px`, 'important');
  host.style.setProperty('width', `${viewport.width}px`, 'important');
  host.style.setProperty('height', `${viewport.height}px`, 'important');
}

function createToolbar(doc: Document): {
  bar: HTMLDivElement;
  titleRow: HTMLDivElement;
  firstRow: HTMLDivElement;
} {
  const bar = doc.createElement('div');
  bar.id = CONTROLS_ID;
  bar.dataset.browser = navigator.userAgent.includes('Firefox') ? 'firefox' : 'chromium';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Just Read It controls');
  const titleRow = doc.createElement('div');
  titleRow.className = 'jri-title-row';
  const firstRow = doc.createElement('div');
  firstRow.className = 'jri-row';
  bar.append(titleRow, firstRow);
  return { bar, titleRow, firstRow };
}

function createStatusElement(
  doc: Document,
  actions: ControlActions,
): {
  element: HTMLDivElement;
  text: HTMLElement;
  loader: HTMLElement;
  progress: HTMLElement;
  progressRing: HTMLElement;
  actions: HTMLSpanElement;
  star: HTMLButtonElement;
  share: HTMLButtonElement;
} {
  const element = doc.createElement('div');
  element.id = STATUS_ID;
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  const text = doc.createElement('strong');
  text.className = 'jri-reading-text';
  const loader = doc.createElement('strong');
  loader.className = 'jri-reading-loader';
  loader.hidden = true;
  const progressRing = doc.createElement('span');
  progressRing.className = 'jri-reading-progress-ring';
  progressRing.setAttribute('role', 'img');
  const progress = doc.createElement('span');
  progress.className = 'jri-reading-progress';
  progressRing.append(progress);
  const star = addIconButton(doc, ICONS.star, 'Star article', actions.toggleStarred);
  star.classList.add('jri-status-action', 'jri-status-star');
  const share = addIconButton(doc, ICONS.share, 'Continue on another device', actions.openProgressShare);
  share.classList.add('jri-status-action');
  const actionGroup = doc.createElement('span');
  actionGroup.className = 'jri-status-actions';
  actionGroup.append(share, star);
  const copy = doc.createElement('span');
  copy.className = 'jri-reading-status';
  copy.append(text, loader, actionGroup);
  element.append(copy);
  return { element, text, loader, progress, progressRing, actions: actionGroup, star, share };
}

function createMinimizedControls(
  doc: Document,
  actions: ControlActions,
): { element: HTMLDivElement; restore: HTMLButtonElement; guided: HTMLButtonElement } {
  const element = doc.createElement('div');
  element.id = 'jri-minimized-controls';
  element.hidden = true;
  const icon = doc.createElement('img');
  icon.className = 'jri-minimized-icon';
  icon.src = browser.runtime.getURL('/icons/just-read-it-32.png');
  icon.alt = 'Just Read It';
  icon.addEventListener('error', () => icon.replaceWith(iconSvg(ICONS.extension)), { once: true });
  const guided = addIconButton(doc, ICONS.play, 'Enable Guided Reading', actions.toggleGuided);
  guided.classList.add('jri-minimized-guided');
  const restore = addIconButton(doc, ICONS.maximize2, 'Restore reading controls');
  restore.classList.add('jri-minimized-restore');
  element.append(icon, guided, restore);
  return { element, restore, guided };
}

function placeReaderStatus(root: ShadowRoot, bar: HTMLDivElement, firstRow: HTMLDivElement, statusElement: HTMLDivElement): void {
  if (window.matchMedia('(max-width: 600px)').matches) {
    const progress = bar.querySelector('#jri-progress');
    bar.insertBefore(statusElement, progress ?? firstRow);
  } else {
    root.appendChild(statusElement);
  }
  statusElement.style.removeProperty('left');
  statusElement.style.removeProperty('top');
  statusElement.style.removeProperty('bottom');
  statusElement.style.removeProperty('transform');
}

function recognitionPointIndex(length: number): number {
  if (length <= 1) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  if (length <= 13) return 3;
  return 4;
}

export function rsvpFocusIndex(word: string): number {
  const characters = Array.from(word);
  const first = characters.findIndex((character) => /[\p{L}\p{N}]/u.test(character));
  if (first === -1) return 0;
  let last = characters.length - 1;
  while (last >= first && !/[\p{L}\p{N}]/u.test(characters[last]!)) last -= 1;
  return first + Math.min(last - first, recognitionPointIndex(last - first + 1));
}

function createControlGroup(doc: Document, className: string, label: string, content: Node): HTMLDivElement {
  const group = doc.createElement('div');
  group.className = `jri-control-group ${className}`;
  const groupLabel = doc.createElement('span');
  groupLabel.className = 'jri-group-label';
  groupLabel.textContent = label;
  group.append(groupLabel, content);
  return group;
}

interface SettingsControls {
  popover: HTMLDialogElement;
  toggle: HTMLButtonElement;
  rsvp: HTMLInputElement;
  readAloud: HTMLButtonElement;
  guidedSpeed: { input: HTMLInputElement; output: HTMLOutputElement };
  aloudSpeed: { input: HTMLInputElement; output: HTMLOutputElement };
  voiceSelect: HTMLSelectElement;
  decreaseFontSize: HTMLButtonElement;
  increaseFontSize: HTMLButtonElement;
  fontScaleOutput: HTMLOutputElement;
  loadVoices(): void;
  setVoiceURI(voiceURI: string | null): void;
  setFontScale(fontScale: number): void;
  setContentCandidates(candidates: { id: string; label: string; confidence: number; selected: boolean }[]): void;
}

interface RsvpControls {
  overlay: HTMLElement;
  setVisible(visible: boolean): void;
  setGuidedRate(rate: number): void;
  syncPosition(): void;
  getViewport(): { top: number; bottom: number } | null;
  destroy(): void;
}

export function createReaderControls(
  doc: Document,
  css: string,
  actions: ControlActions,
  initialState: ReaderControlsState,
  theme: 'light' | 'dark' = 'light',
  readerUiTheme: 'auto' | 'light' | 'dark' = 'auto',
): ReaderControls {
  const { host, root } = createReaderUiHost(doc, css, theme);
  const confirm = createConfirmDialog(doc, root);
  const toolbar = createToolbar(doc);
  const {
    element: statusElement,
    text: statusText,
    loader: statusLoader,
    progress: statusProgress,
    progressRing: statusProgressRing,
    actions: statusActions,
    star: statusStar,
  } = createStatusElement(doc, actions);
  const minimized = createMinimizedControls(doc, actions);
  const settings = createSettingsControls(
    doc,
    actions,
    confirm,
    initialState.rate,
    initialState.guidedRate,
    initialState.voiceURI,
    initialState.fontScale,
    readerUiTheme,
  );
  const progressShare = createProgressShareControls(doc, actions);
  const rsvp = createRsvpControls(doc, toolbar.bar, minimized.element, actions, initialState.guidedRate);
  const toolbarControls = createToolbarControls(
    doc,
    root,
    toolbar,
    settings,
    progressShare,
    rsvp,
    actions,
    confirm,
    initialState.speechAvailable,
    statusProgressRing,
  );
  root.append(minimized.element);
  const placeStatus = (): void => placeReaderStatus(root, toolbar.bar, toolbar.firstRow, statusElement);
  const setNavigationIcons = (): void => updateNavigationIcons(toolbarControls.previous, toolbarControls.next);
  const docking: Docking = createDocking({
    bar: toolbar.bar,
    statusElement,
    dragHandle: toolbarControls.drag,
    onMediaChange: setNavigationIcons,
    onResize: placeStatus,
  });
  const syncHost = (): void => syncUiHostToVisualViewport(host);
  window.visualViewport?.addEventListener('resize', syncHost);
  window.visualViewport?.addEventListener('scroll', syncHost);
  window.addEventListener('resize', syncHost);
  syncHost();
  placeStatus();
  docking.sync();
  const setMinimized = (value: boolean): void => {
    toolbar.bar.hidden = value;
    minimized.element.hidden = !value;
    rsvp.syncPosition();
    if (!value) {
      requestAnimationFrame(() => {
        docking.sync();
        rsvp.syncPosition();
      });
    }
  };
  toolbarControls.minimize.addEventListener('click', () => setMinimized(true));
  minimized.restore.addEventListener('click', () => setMinimized(false));

  const update = (state: ReaderControlsState): void => {
    updateReaderControls(
      toolbarControls,
      settings,
      rsvp,
      statusText,
      statusLoader,
      statusProgress,
      statusProgressRing,
      statusActions,
      statusStar,
      state,
      minimized.guided,
    );
  };
  update(initialState);

  // The initial update can change the toolbar's height (status text, button
  // visibility, and mobile wrapping). Pin once after that layout has settled,
  // rather than relying on the pre-update measurement above.
  requestAnimationFrame(() => {
    placeStatus();
    docking.sync();
  });

  let constraintsApplied = false;
  return {
    root,
    setVisible(visible) {
      // The host resets every property with !important, including display,
      // so the HTML hidden attribute alone cannot hide it.
      const wasVisible = host.style.getPropertyValue('display') !== 'none';
      host.style.setProperty('display', visible ? 'block' : 'none', 'important');
      if (visible && (!constraintsApplied || !wasVisible)) {
        // Re-apply the viewport constraints once now that the controls are
        // painted and properly sized. createReaderControls applies them before
        // first paint, when the bar/status have no reliable layout metrics.
        constraintsApplied = true;
        syncHost();
        requestAnimationFrame(() => {
          placeStatus();
          docking.sync();
        });
      }
    },
    getRsvpViewport: rsvp.getViewport,
    openProgressShare: progressShare.open,
    setStatus(status, options = {}) {
      const text = status.replace(/\s+/g, ' ').trim();
      const progressMatch = text.match(/(?:^|\s)(\d{1,3})%\s*$/u);
      const progress = options.progress ?? (progressMatch ? Math.min(100, Number(progressMatch[1])) : null);
      const loaderText = progressMatch ? text.slice(0, progressMatch.index).trimEnd() : text;
      statusText.hidden = true;
      statusLoader.hidden = false;
      statusLoader.textContent = loaderText;
      statusLoader.title = text;
      statusProgress.textContent = progress === null ? '' : `${progress}%`;
      if (progress === null) statusProgressRing.style.removeProperty('--jri-progress');
      else statusProgressRing.style.setProperty('--jri-progress', `${progress}%`);
      statusProgressRing.dataset.indefinite = String(options.indefinite === true && progress === null);
      statusProgressRing.setAttribute('aria-label', progress === null ? text : `${progress}% complete`);
      statusActions.hidden = true;
    },
    setContentCandidates(candidates) {
      settings.setContentCandidates(candidates);
    },
    setTheme(theme) {
      host.dataset.readerTheme = theme;
    },
    update,
    destroy() {
      confirm.destroy();
      docking.destroy();
      rsvp.destroy();
      settings.destroy();
      window.visualViewport?.removeEventListener('resize', syncHost);
      window.visualViewport?.removeEventListener('scroll', syncHost);
      window.removeEventListener('resize', syncHost);
      host.remove();
    },
  };
}

function addButton(doc: Document, label: string, title: string, action?: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'jri-button jri-ui-control';
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', (event) => {
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    button.blur();
    action();
  });
  return button;
}

function addIconButton(doc: Document, paths: string, title: string, action?: () => void): HTMLButtonElement {
  const button = addButton(doc, '', title, action);
  button.replaceChildren(iconSvg(paths));
  return button;
}

function createConfirmDialog(doc: Document, root: ShadowRoot): ConfirmDialog {
  const dialog = doc.createElement('dialog');
  dialog.className = 'jri-confirm-dialog';
  dialog.setAttribute('aria-label', 'Confirm action');
  const message = doc.createElement('p');
  const cancel = addButton(doc, 'Cancel', 'Cancel action', () => {
    pendingAction = null;
    dialog.close();
  });
  const confirm = addButton(doc, 'Confirm', 'Confirm action', () => {
    const action = pendingAction;
    pendingAction = null;
    dialog.close();
    action?.();
  });
  cancel.classList.add('jri-confirm-cancel');
  confirm.classList.add('jri-confirm-submit');
  const actions = doc.createElement('div');
  actions.className = 'jri-confirm-actions';
  actions.append(cancel, confirm);
  dialog.append(message, actions);
  dialog.addEventListener('cancel', () => {
    pendingAction = null;
  });
  root.append(dialog);

  let pendingAction: (() => void) | null = null;
  return {
    ask(text, action) {
      pendingAction = action;
      message.textContent = text;
      dialog.showModal();
      confirm.focus();
    },
    destroy() {
      pendingAction = null;
      dialog.close();
      dialog.remove();
    },
  };
}

function createSettingsControls(
  doc: Document,
  actions: ControlActions,
  confirm: ConfirmDialog,
  rate: number,
  guidedRate: number,
  voiceURI: string | null,
  fontScale: number,
  readerUiTheme: 'auto' | 'light' | 'dark',
): SettingsControls & { destroy(): void } {
  let currentFontScale = fontScale;
  let currentVoiceURI = voiceURI;
  const popover = doc.createElement('dialog');
  popover.className = 'jri-speed-popover';
  popover.setAttribute('aria-label', 'Reading speed controls');
  const aloudSpeed = createSpeedControl(doc, 'Read Aloud', 'Read aloud speed', rate, actions.setRate);
  const guidedSpeed = createSpeedControl(doc, 'Guided Reading', 'Guided reading speed', guidedRate, actions.setGuidedRate, 3);
  const { control: rsvpControl, input: rsvp } = createRsvpControl(doc, actions);
  const {
    control: fontSizeControl,
    decreaseFontSize,
    increaseFontSize,
    output: fontScaleOutput,
    updateOutput: updateFontScaleOutput,
  } = createFontSizeControl(doc, actions, () => currentFontScale);
  const { control: voiceSection, select: voiceSelect, load: loadVoices } = createVoiceControl(doc, actions, () => currentVoiceURI);
  const contentSection = createContentCandidateControl(doc, actions);
  const themeSection = createReaderUiThemeControl(doc, readerUiTheme, actions);
  voiceSection.classList.add('jri-read-aloud-section');
  const home = addIconButton(doc, ICONS.layoutGrid, 'Open reading home', () => {
    popover.close();
    actions.openHome();
  });
  home.classList.add('jri-action-button');
  const markAll = addIconButton(doc, ICONS.checkCheck, 'Mark document as read', () => {
    popover.close();
    confirm.ask('Mark the entire document as read?', actions.markAllRead);
  });
  markAll.classList.add('jri-action-button');
  const reset = addIconButton(doc, ICONS.rotateCw, 'Reset reading progress', () => {
    popover.close();
    confirm.ask('Reset reading progress for this page?', actions.reset);
  });
  reset.classList.add('jri-action-button');
  const group = doc.createElement('div');
  group.className = 'jri-speed-group';
  group.append(
    createSettingsHeader(doc),
    createSettingsGroup(doc, 'Reading', contentSection, fontSizeControl, themeSection),
    createSettingsGroup(doc, 'Guided Reading', guidedSpeed.control, rsvpControl, voiceSection, aloudSpeed.control),
  );
  const actionsGroup = createSettingsGroup(doc, 'Actions', reset, markAll, home);
  actionsGroup.classList.add('jri-actions-group');
  group.append(actionsGroup);
  const close = addButton(doc, 'Done', 'Close reading settings', () => popover.close());
  close.classList.add('jri-settings-close');
  group.append(close);
  popover.append(group);
  const refreshVoices = (): void => {
    loadVoices();
  };
  const onVoicesChanged = (): void => {
    window.setTimeout(refreshVoices, 0);
  };
  speechSynthesis?.addEventListener('voiceschanged', onVoicesChanged);
  const toggle = addIconButton(doc, ICONS.settings, 'Show reading settings', () => {
    popover.showModal();
    toggle.setAttribute('aria-expanded', 'true');
    window.setTimeout(actions.pauseGuidedForSettings, 0);
    // Voice enumeration can be slow on platforms with remote/system voices. Let
    // the dialog paint first, then refresh it without delaying the open action.
    window.setTimeout(refreshVoices, 0);
  });
  toggle.classList.add('jri-speed-toggle');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'jri-speed-popover');
  popover.id = 'jri-speed-popover';
  popover.addEventListener('close', () => toggle.setAttribute('aria-expanded', 'false'));
  return {
    popover,
    toggle,
    rsvp,
    readAloud: addIconButton(doc, ICONS.volume2, 'Start reading aloud', actions.toggleReadAloud),
    guidedSpeed,
    aloudSpeed,
    voiceSelect,
    decreaseFontSize,
    increaseFontSize,
    fontScaleOutput,
    loadVoices,
    setVoiceURI(value) {
      currentVoiceURI = value;
      if (popover.open) refreshVoices();
    },
    setFontScale(value) {
      currentFontScale = value;
      updateFontScaleOutput();
    },
    setContentCandidates(candidates) {
      contentSection.hidden = candidates.length < 2;
      const select = contentSection.querySelector('select');
      if (!(select instanceof HTMLSelectElement)) return;
      select.replaceChildren();
      for (const candidate of candidates) {
        const option = new Option(
          `${candidate.label} (${candidate.confidence}% match)`,
          candidate.id,
          candidate.selected,
          candidate.selected,
        );
        select.append(option);
      }
    },
    destroy() {
      speechSynthesis?.removeEventListener('voiceschanged', onVoicesChanged);
    },
  };
}

function createContentCandidateControl(doc: Document, actions: ControlActions): HTMLLabelElement {
  const label = doc.createElement('label');
  label.className = 'jri-content-candidate-control';
  label.hidden = true;
  label.textContent = 'Reading section';
  const select = doc.createElement('select');
  select.setAttribute('aria-label', 'Reading section');
  select.addEventListener('change', () => {
    const candidateId = select.value;
    if (candidateId) actions.selectContentCandidate?.(candidateId);
  });
  label.append(select);
  return label;
}

function createSettingsHeader(doc: Document): HTMLDivElement {
  const header = doc.createElement('div');
  header.className = 'jri-settings-header';
  const icon = doc.createElement('img');
  icon.className = 'jri-settings-icon';
  icon.src = browser.runtime.getURL('/icons/just-read-it-48.png');
  icon.alt = '';
  icon.addEventListener('error', () => icon.replaceWith(iconSvg(ICONS.extension)), { once: true });
  const brand = doc.createElement('span');
  brand.textContent = 'Just Read It';
  const title = doc.createElement('h2');
  title.textContent = 'Reader View';
  const heading = doc.createElement('div');
  heading.append(brand, title);
  header.append(icon, heading);
  return header;
}

function createProgressShareControls(doc: Document, actions: ControlActions): { popover: HTMLDialogElement; open(url: string): void } {
  const popover = doc.createElement('dialog');
  popover.id = 'jri-progress-share-popover';
  popover.className = 'jri-progress-share-popover';
  popover.setAttribute('aria-label', 'Continue reading on another device');
  const group = doc.createElement('div');
  group.className = 'jri-progress-share-group';
  const heading = doc.createElement('h2');
  heading.textContent = 'Continue on another device';
  const description = doc.createElement('p');
  description.textContent =
    'Scan or copy this link to continue from the same place. Just Read It should be enabled on the other device to continue the reading.';
  const qr = doc.createElement('div');
  qr.className = 'jri-progress-share-qr';
  qr.setAttribute('role', 'img');
  qr.setAttribute('aria-label', 'QR code to continue reading on another device');
  const close = addIconButton(doc, ICONS.x, 'Close device continuation', () => popover.close());
  close.classList.add('jri-progress-share-close');
  let useCopyFallback = false;
  const shareProgressUrl = () => {
    if (useCopyFallback) {
      void Promise.resolve(actions.copyProgressUrl(url)).finally(() => popover.close());
      return;
    }
    void Promise.resolve(actions.shareProgressUrl(url))
      .then((shared) => {
        if (!shared) {
          useCopyFallback = true;
          share.textContent = 'Copy link';
          share.title = 'Copy progress link';
          share.setAttribute('aria-label', 'Copy progress link');
        }
      })
      .finally(() => popover.close());
  };
  const share = addButton(doc, 'Share link', 'Open share sheet', shareProgressUrl);
  share.classList.add('jri-progress-share-action', 'jri-progress-share-mobile');
  const copy = addButton(doc, 'Copy link', 'Copy progress link', () => {
    void Promise.resolve(actions.copyProgressUrl(url)).finally(() => popover.close());
  });
  copy.classList.add('jri-progress-share-action', 'jri-progress-share-desktop');
  group.append(close, heading, description, qr, share, copy);
  popover.append(group);
  let url = '';
  return {
    popover,
    open(nextUrl) {
      url = nextUrl;
      qr.replaceChildren();
      popover.showModal();
      new BrowserQRCodeSvgWriter().writeToDom(qr, nextUrl, 280, 280);
    },
  };
}

function createSpeedControl(
  doc: Document,
  label: string,
  title: string,
  value: number,
  action: (rate: number) => void,
  maximum = 2,
): { control: HTMLLabelElement; input: HTMLInputElement; output: HTMLOutputElement } {
  const control = doc.createElement('label');
  control.className = 'jri-speed-control';
  const name = doc.createElement('span');
  name.textContent = label;
  const output = doc.createElement('output');
  output.textContent = `${value.toFixed(1)}x`;
  const input = doc.createElement('input');
  input.type = 'range';
  input.min = '0.5';
  input.max = String(maximum);
  input.step = '0.1';
  input.value = String(value);
  input.setAttribute('aria-label', title);
  input.addEventListener('input', () => action(Number(input.value)));
  const range = doc.createElement('div');
  range.className = 'jri-speed-range';
  const decrease = addIconButton(doc, ICONS.minus, `Decrease ${title.toLowerCase()}`, () => {
    action(Math.max(Number(input.min), Math.round((Number(input.value) - Number(input.step)) * 10) / 10));
  });
  const increase = addIconButton(doc, ICONS.plus, `Increase ${title.toLowerCase()}`, () => {
    action(Math.min(Number(input.max), Math.round((Number(input.value) + Number(input.step)) * 10) / 10));
  });
  decrease.classList.add('jri-speed-step');
  increase.classList.add('jri-speed-step');
  range.append(decrease, input, increase);
  control.append(name, output, range);
  return { control, input, output };
}

function createFontSizeControl(doc: Document, actions: ControlActions, getFontScale: () => number) {
  const control = doc.createElement('div');
  control.className = 'jri-font-size-control';
  const label = doc.createElement('span');
  label.className = 'jri-font-size-label';
  label.textContent = 'Text Size';
  const decreaseFontSize = addButton(doc, 'A-', 'Decrease text size', () => {
    actions.setFontScale(Math.max(0.5, Math.round((getFontScale() - 0.1) * 10) / 10));
  });
  const increaseFontSize = addButton(doc, 'A+', 'Increase text size', () => {
    actions.setFontScale(Math.min(5, Math.round((getFontScale() + 0.1) * 10) / 10));
  });
  const output = doc.createElement('output');
  const updateOutput = (): void => {
    output.textContent = `${getFontScale().toFixed(1)}x`;
  };
  updateOutput();
  control.append(label, decreaseFontSize, output, increaseFontSize);
  return { control, decreaseFontSize, increaseFontSize, output, updateOutput };
}

function createVoiceControl(doc: Document, actions: ControlActions, getVoiceURI: () => string | null) {
  const control = doc.createElement('label');
  control.className = 'jri-voice-control';
  control.textContent = 'Voice';
  const select = doc.createElement('select');
  select.setAttribute('aria-label', 'Read aloud voice');
  const load = (): void => {
    const selected = getVoiceURI() ?? '';
    select.replaceChildren(new Option('Default voice', ''));
    for (const voice of getReadableVoices(selected)) select.append(new Option(`${voice.name} (${voice.lang})`, voice.voiceURI));
    select.value = selected;
    if (select.value !== selected) select.value = '';
  };
  select.addEventListener('change', () => actions.setVoice(select.value || null));
  control.append(select);
  return { control, select, load };
}

function createSettingsGroup(doc: Document, label: string, ...controls: Node[]): HTMLDivElement {
  const group = doc.createElement('div');
  group.className = 'jri-settings-group';
  const groupLabel = doc.createElement('span');
  groupLabel.className = 'jri-settings-group-label';
  groupLabel.textContent = label;
  group.append(groupLabel, ...controls);
  return group;
}

function createReaderUiThemeControl(doc: Document, theme: 'auto' | 'light' | 'dark', actions: ControlActions): HTMLLabelElement {
  const label = doc.createElement('label');
  label.className = 'jri-reader-ui-theme-control';
  label.textContent = 'Controls appearance';
  const select = doc.createElement('select');
  select.setAttribute('aria-label', 'Reader View controls appearance');
  select.append(new Option('Auto', 'auto'), new Option('Light', 'light'), new Option('Dark', 'dark'));
  select.value = theme;
  select.addEventListener('change', () => actions.setReaderUiTheme?.(select.value as 'auto' | 'light' | 'dark'));
  label.append(select);
  return label;
}

function createRsvpControl(doc: Document, actions: ControlActions) {
  const control = doc.createElement('label');
  control.className = 'jri-rsvp-control';
  const text = doc.createElement('span');
  text.textContent = 'Rapid Serial Visual Presentation';
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('aria-label', 'Enable Rapid Serial Visual Presentation');
  input.addEventListener('change', () => {
    actions.toggleRsvp(input.checked);
  });
  control.append(text, input);
  return { control, input };
}

function createRsvpControls(
  doc: Document,
  bar: HTMLDivElement,
  minimized: HTMLDivElement,
  actions: ControlActions,
  guidedRate: number,
): RsvpControls {
  const overlay = doc.createElement('section');
  overlay.id = 'jri-rsvp-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'false');
  overlay.setAttribute('aria-label', 'Rapid Serial Visual Presentation');
  const wordElement = doc.createElement('div');
  wordElement.className = 'jri-rsvp-word';
  const prefix = doc.createElement('span');
  prefix.className = 'jri-rsvp-prefix';
  const focus = doc.createElement('span');
  focus.className = 'jri-rsvp-focus';
  const suffix = doc.createElement('span');
  suffix.className = 'jri-rsvp-suffix';
  wordElement.append(prefix, focus, suffix);
  const close = addIconButton(doc, ICONS.x, 'Exit Rapid Serial Visual Presentation', () => actions.toggleRsvp(false));
  close.classList.add('jri-rsvp-close');
  const speed = doc.createElement('div');
  speed.className = 'jri-rsvp-speed';
  speed.setAttribute('role', 'group');
  speed.setAttribute('aria-label', 'Guided reading speed for this session');
  const decreaseSpeed = addIconButton(doc, ICONS.minus, 'Decrease guided reading speed', () => {
    actions.setTransientGuidedRate(Math.max(0.5, Math.round((guidedRate - 0.1) * 10) / 10));
  });
  const speedOutput = doc.createElement('output');
  speedOutput.textContent = `${guidedRate.toFixed(1)}x`;
  speedOutput.setAttribute('aria-label', 'Guided reading speed');
  const increaseSpeed = addIconButton(doc, ICONS.plus, 'Increase guided reading speed', () => {
    actions.setTransientGuidedRate(Math.min(3, Math.round((guidedRate + 0.1) * 10) / 10));
  });
  decreaseSpeed.disabled = guidedRate <= 0.5;
  increaseSpeed.disabled = guidedRate >= 3;
  speed.append(decreaseSpeed, speedOutput, increaseSpeed);
  for (const control of [speed, close]) control.addEventListener('pointerdown', (event) => event.stopPropagation());
  overlay.append(wordElement, speed, close);
  let frame: number | null = null;
  let fitFrame: number | null = null;
  let displayedWord: string | null = null;
  let dragging = false;
  let hasBeenDragged = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  const isMobile = (): boolean => window.matchMedia('(max-width: 600px)').matches;
  const constrainMobileTop = (desiredTop: number): number => {
    const bounds = mobileViewportBounds();
    const overlayHeight = overlay.offsetHeight;
    const edgeGap = 12;
    const minimumTop = bounds.top + 8;
    const maximumTop = bounds.top + bounds.height - overlayHeight - 8;
    let top = Math.max(minimumTop, Math.min(maximumTop, desiredTop));
    if (bar.hidden) return top;

    const controlsRect = bar.getBoundingClientRect();
    const overlaps = top < controlsRect.bottom + edgeGap && top + overlayHeight > controlsRect.top - edgeGap;
    if (!overlaps) return top;

    const above = controlsRect.top - overlayHeight - edgeGap;
    const below = controlsRect.bottom + edgeGap;
    const aboveDistance = Math.abs(desiredTop - above);
    const belowDistance = Math.abs(desiredTop - below);
    top = aboveDistance <= belowDistance ? above : below;
    return Math.max(minimumTop, Math.min(maximumTop, top));
  };
  const separateFromControls = (): void => {
    if (!isMobile()) return;
    const bounds = mobileViewportBounds();
    if (bar.hidden && !minimized.hidden && !hasBeenDragged) {
      overlay.style.top = 'auto';
      overlay.style.right = '12px';
      overlay.style.bottom = '78px';
      return;
    }
    if (hasBeenDragged) return;
    overlay.style.removeProperty('top');
    overlay.style.removeProperty('right');
    overlay.style.removeProperty('bottom');
    if (!bar.classList.contains('jri-controls-manually-positioned')) return;
    const controlsRect = bar.getBoundingClientRect();
    const overlayHeight = overlay.offsetHeight;
    const edgeGap = 12;
    const above = controlsRect.top - overlayHeight - edgeGap;
    const below = controlsRect.bottom + edgeGap;
    const top = above >= bounds.top + edgeGap ? above : Math.min(below, bounds.top + bounds.height - overlayHeight - edgeGap);
    overlay.style.top = `${Math.max(bounds.top + edgeGap, top)}px`;
    overlay.style.bottom = 'auto';
  };
  const fitWord = (): void => {
    fitFrame = null;
    if (overlay.hidden) return;
    wordElement.style.setProperty('--jri-rsvp-word-scale', '1');
    const overlayRect = overlay.getBoundingClientRect();
    const wordRects = [prefix, focus, suffix].map((element) => element.getBoundingClientRect());
    const wordLeft = Math.min(...wordRects.map((rect) => rect.left));
    const wordRight = Math.max(...wordRects.map((rect) => rect.right));
    const anchor = overlayRect.left + overlayRect.width * 0.42;
    const availableLeft = Math.max(0, anchor - (overlayRect.left + 24));
    const controlsLeft = Math.min(speed.getBoundingClientRect().left, close.getBoundingClientRect().left);
    const availableRight = Math.max(0, controlsLeft - 12 - anchor);
    const wordLeftExtent = anchor - wordLeft;
    const wordRightExtent = wordRight - anchor;
    const scale = Math.min(
      1,
      wordLeftExtent > 0 ? availableLeft / wordLeftExtent : 1,
      wordRightExtent > 0 ? availableRight / wordRightExtent : 1,
    );
    wordElement.style.setProperty('--jri-rsvp-word-scale', `${scale}`);
  };
  const updateWord = (): void => {
    frame = null;
    if (overlay.hidden) return;
    const word = doc.querySelector('.jri-word.jri-word-current')?.textContent?.trim() ?? '';
    if (word === displayedWord) return;
    const characters = Array.from(word);
    const focusIndex = rsvpFocusIndex(word);
    prefix.textContent = characters.slice(0, focusIndex).join('');
    focus.textContent = characters[focusIndex] ?? '';
    suffix.textContent = characters.slice(focusIndex + 1).join('');
    wordElement.style.setProperty('--jri-rsvp-word-scale', '1');
    wordElement.style.setProperty('--jri-rsvp-focus-half-width', `${focus.getBoundingClientRect().width / 2}px`);
    if (fitFrame !== null) cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(fitWord);
    displayedWord = word;
  };
  const scheduleWordUpdate = (): void => {
    if (overlay.hidden) return;
    if (frame === null) frame = requestAnimationFrame(updateWord);
  };
  let mobileLayout = isMobile();
  const onViewportChange = (): void => {
    const mobile = isMobile();
    if (mobile !== mobileLayout) {
      mobileLayout = mobile;
      hasBeenDragged = false;
      for (const property of ['top', 'right', 'bottom', 'left', 'transform']) overlay.style.removeProperty(property);
    }
    if (hasBeenDragged) {
      const rect = overlay.getBoundingClientRect();
      overlay.style.top = `${mobile ? constrainMobileTop(rect.top) : clampToViewport(rect.top, overlay.offsetHeight, window.innerHeight)}px`;
      if (!mobile) overlay.style.left = `${clampToViewport(rect.left, overlay.offsetWidth, window.innerWidth)}px`;
    } else {
      separateFromControls();
    }
    displayedWord = null;
    scheduleWordUpdate();
  };
  window.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('scroll', onViewportChange);
  const syncDock = (): void => {
    // A minimized toolbar must not change the RSVP overlay's placement.
    if (!bar.hidden) overlay.style.setProperty('--jri-controls-offset', `${bar.getBoundingClientRect().height}px`);
  };
  const dockObserver = new ResizeObserver(syncDock);
  dockObserver.observe(bar);
  const overlayObserver = new ResizeObserver(() => {
    displayedWord = null;
    scheduleWordUpdate();
  });
  overlayObserver.observe(overlay);
  const wordObserver = new MutationObserver(scheduleWordUpdate);
  wordObserver.observe(doc.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  overlay.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button, .jri-rsvp-speed'))) return;
    if (isMobile()) {
      // Restore CSS-controlled full-width pinning before a mobile drag; a previous
      // desktop drag may have left absolute positioning behind.
      overlay.style.removeProperty('left');
      overlay.style.removeProperty('right');
      overlay.style.removeProperty('transform');
    }
    const rect = overlay.getBoundingClientRect();
    dragging = true;
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    overlay.setPointerCapture(event.pointerId);
    overlay.style.cursor = 'grabbing';
    event.preventDefault();
  });
  overlay.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    hasBeenDragged = true;
    if (isMobile()) {
      // On mobile the overlay stays pinned to the viewport edges (left/right are owned by CSS);
      // dragging only moves it vertically, clamped into the visible viewport like jri-controls.
      const bounds = mobileViewportBounds();
      const desiredTop = bounds.top + clampToViewport(event.clientY - dragOffsetY - bounds.top, overlay.offsetHeight, bounds.height);
      const top = constrainMobileTop(desiredTop);
      overlay.style.top = `${top}px`;
      overlay.style.bottom = 'auto';
      event.preventDefault();
      return;
    }
    const left = clampToViewport(event.clientX - dragOffsetX, overlay.offsetWidth, window.innerWidth);
    const top = clampToViewport(event.clientY - dragOffsetY, overlay.offsetHeight, window.innerHeight);
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.right = 'auto';
    overlay.style.bottom = 'auto';
    overlay.style.transform = 'none';
    event.preventDefault();
  });
  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
    overlay.style.cursor = 'grab';
  };
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);
  syncDock();
  return {
    overlay,
    setVisible(visible) {
      const wasHidden = overlay.hidden;
      overlay.hidden = !visible;
      if (visible) {
        if (wasHidden) separateFromControls();
        displayedWord = null;
        updateWord();
      }
    },
    setGuidedRate(rate) {
      guidedRate = rate;
      const label = `${rate.toFixed(1)}x`;
      if (speedOutput.textContent !== label) speedOutput.textContent = label;
      decreaseSpeed.disabled = rate <= 0.5;
      increaseSpeed.disabled = rate >= 3;
    },
    syncPosition: separateFromControls,
    getViewport: () => {
      if (overlay.hidden) return null;
      const rect = overlay.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    },
    destroy() {
      window.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('scroll', onViewportChange);
      dockObserver.disconnect();
      overlayObserver.disconnect();
      wordObserver.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      if (fitFrame !== null) cancelAnimationFrame(fitFrame);
    },
  };
}

function createToolbarControls(
  doc: Document,
  root: ShadowRoot,
  toolbar: { bar: HTMLDivElement; titleRow: HTMLDivElement; firstRow: HTMLDivElement },
  settings: SettingsControls,
  progressShare: { popover: HTMLDialogElement },
  rsvp: RsvpControls,
  actions: ControlActions,
  confirm: ConfirmDialog,
  speechAvailable: boolean,
  progressRing: HTMLElement,
) {
  const drag = addIconButton(doc, ICONS.grip, 'Move controls', () => {});
  drag.classList.add('jri-drag');
  const previous = addIconButton(doc, ICONS.chevronUp, 'Previous sentence', actions.previous);
  const next = addIconButton(doc, ICONS.chevronDown, 'Next sentence', actions.next);

  const navigationStatus = doc.createElement('span');
  navigationStatus.className = 'jri-navigation-status';
  navigationStatus.setAttribute('role', 'status');
  navigationStatus.setAttribute('aria-live', 'polite');
  navigationStatus.append(progressRing);
  const navigation = doc.createElement('div');
  navigation.className = 'jri-navigation';
  navigation.append(previous, navigationStatus, next);
  const guided = addIconButton(doc, ICONS.play, 'Enable Guided Reading', actions.toggleGuided);
  settings.readAloud.classList.add('jri-read-aloud');
  settings.readAloud.disabled = !speechAvailable;
  settings.readAloud.hidden = !speechAvailable;
  const lightsOut = addIconButton(doc, ICONS.spotlight, 'Turn Auto Dimming on', actions.toggleLightsOut);
  lightsOut.classList.add('jri-lights-out');
  const readingModes = doc.createElement('div');
  readingModes.className = 'jri-reading-modes';
  readingModes.append(guided, lightsOut, settings.readAloud);
  const minimize = addIconButton(doc, ICONS.minimize2, 'Minimize reading controls');
  minimize.classList.add('jri-minimize-controls');
  const close = addIconButton(doc, ICONS.power, 'Disable Just Read It', () => {
    confirm.ask('Exit reading mode? Your progress is saved.', actions.close);
  });
  close.classList.add('jri-exit-button');
  const brand = doc.createElement('span');
  brand.className = 'jri-brand';
  brand.textContent = 'Just Read It - Extension';
  const secondaryActions = doc.createElement('div');
  secondaryActions.className = 'jri-secondary-actions';
  toolbar.firstRow.append(
    drag,
    createControlGroup(doc, 'jri-modes-group', 'Modes', readingModes),
    createControlGroup(doc, 'jri-navigation-group', 'Move', navigation),
    createControlGroup(doc, 'jri-actions-group', 'Actions', secondaryActions),
    createControlGroup(doc, 'jri-exit-group', 'Exit', close),
  );
  toolbar.titleRow.append(brand);
  secondaryActions.append(settings.toggle, minimize);
  root.append(toolbar.bar, settings.popover, progressShare.popover, rsvp.overlay);
  return {
    drag,
    previous,
    next,
    navigationStatus,
    guided,
    lightsOut,
    minimize,
  };
}

function updateNavigationIcons(previous: HTMLButtonElement, next: HTMLButtonElement): void {
  const mobile = window.matchMedia('(max-width: 600px)').matches;
  previous.replaceChildren(iconSvg(mobile ? ICONS.chevronLeft : ICONS.chevronUp));
  next.replaceChildren(iconSvg(mobile ? ICONS.chevronRight : ICONS.chevronDown));
}

function updateReaderControls(
  toolbar: ReturnType<typeof createToolbarControls>,
  settings: SettingsControls,
  rsvp: RsvpControls,
  statusCopy: HTMLElement,
  statusLoader: HTMLElement,
  statusProgress: HTMLElement,
  statusProgressRing: HTMLElement,
  statusActions: HTMLElement,
  statusStar: HTMLButtonElement,
  state: ReaderControlsState,
  minimizedGuided: HTMLButtonElement,
): void {
  const guidedActive = state.guidedReading && !state.guidedReadingPaused;
  updateIconButton(
    toolbar.guided,
    guidedActive,
    'Disable Guided Reading',
    state.guidedReadingPaused ? 'Resume Guided Reading' : 'Enable Guided Reading',
    ICONS.pause,
    ICONS.play,
    true,
  );
  updateIconButton(
    minimizedGuided,
    guidedActive,
    'Disable Guided Reading',
    state.guidedReadingPaused ? 'Resume Guided Reading' : 'Enable Guided Reading',
    ICONS.pause,
    ICONS.play,
    true,
  );
  settings.rsvp.checked = state.rsvpEnabled;
  rsvp.setVisible(state.rsvpEnabled && !state.complete);
  settings.readAloud.hidden = !state.speechAvailable;
  settings.readAloud.disabled = !state.speechAvailable;
  if (state.speechAvailable)
    updateIconButton(
      settings.readAloud,
      state.readingAloud && !state.readingAloudPaused,
      'Stop reading aloud',
      state.readingAloudPaused ? 'Resume reading aloud' : 'Start reading aloud',
      state.readingAloudPaused ? ICONS.play : ICONS.stop,
      ICONS.volume2,
      true,
    );
  updateIconButton(toolbar.lightsOut, state.lightsOut, 'Turn Auto Dimming off', 'Turn Auto Dimming on', ICONS.spotlight, ICONS.spotlight);
  updateIconButton(statusStar, state.starred, 'Unstar article', 'Star article', ICONS.star, ICONS.star);
  const currentSentence = state.currentSentence === null ? null : state.currentSentence + 1;
  const progress = state.complete
    ? 100
    : state.totalSentences > 0 && currentSentence !== null
      ? (currentSentence / state.totalSentences) * 100
      : 0;
  toolbar.previous.disabled = state.currentSentence === null || state.currentSentence <= 0;
  toolbar.next.disabled = state.currentSentence === null || state.currentSentence >= state.totalSentences - 1;
  updateSpeedControl(settings.aloudSpeed, state.rate);
  updateSpeedControl(settings.guidedSpeed, state.guidedRate);
  rsvp.setGuidedRate(state.guidedRate);
  settings.setVoiceURI(state.voiceURI);
  settings.setFontScale(state.fontScale);
  settings.decreaseFontSize.disabled = state.fontScale <= 0.5;
  settings.increaseFontSize.disabled = state.fontScale >= 5;
  const statusText = state.status.text
    ? state.status.text.replace(/\s+/g, ' ').trim()
    : state.complete
      ? state.status.minutes
      : state.status.minutes
        ? `${state.status.minutes} left`
        : '';
  const sentencePosition =
    !state.status.text && !state.complete && currentSentence !== null && state.totalSentences > 0
      ? `${currentSentence}/${state.totalSentences}`
      : '';
  const time = document.createElement('span');
  time.className = 'jri-reading-time';
  time.textContent = statusText;
  const position = document.createElement('span');
  position.className = 'jri-reading-sentence-position';
  position.textContent = sentencePosition ? `(${sentencePosition} sentences)` : '';
  position.hidden = !sentencePosition;
  statusCopy.hidden = false;
  statusCopy.replaceChildren(time, position);
  statusCopy.title = statusText;
  statusLoader.hidden = true;
  statusLoader.replaceChildren();
  statusLoader.removeAttribute('title');
  statusProgress.textContent = state.status.text || state.complete ? '' : (state.status.progress ?? `${Math.floor(progress)}%`);
  statusProgressRing.style.setProperty('--jri-progress', `${progress}%`);
  statusProgressRing.dataset.indefinite = 'false';
  statusProgressRing.dataset.complete = String(state.complete);
  statusProgressRing.setAttribute(
    'aria-label',
    state.status.text || state.complete
      ? statusText
      : `${state.status.progress ?? Math.floor(progress)}% complete, sentence ${currentSentence || '--'} of ${state.totalSentences}`,
  );
  statusActions.hidden = false;
}

function updateIconButton(
  button: HTMLButtonElement,
  active: boolean,
  activeLabel: string,
  inactiveLabel: string,
  activeIcon: string,
  inactiveIcon: string,
  pressed = false,
): void {
  button.dataset.active = String(active);
  if (pressed) button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', active ? activeLabel : inactiveLabel);
  button.title = active ? activeLabel : inactiveLabel;
  button.replaceChildren(iconSvg(active ? activeIcon : inactiveIcon));
}

function updateSpeedControl(control: SettingsControls['guidedSpeed'], rate: number): void {
  control.input.value = String(rate);
  control.output.textContent = `${rate.toFixed(1)}x`;
}
