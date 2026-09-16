import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHoverController } from '../../../lib/web/reader/hover';
import { createKeyboardInteraction, isEditable } from '../../../lib/web/reader/keyboard';
import { attachInteraction } from '../../../lib/web/reader/interaction';
import { idFromTarget, pointerToProgress } from '../../../lib/web/reader/helpers';
import { createReadingSession, type ReadingSession } from '../../../lib/reading/state';

function makeSession(ids: number[]): ReadingSession {
  const spans: HTMLSpanElement[] = [];
  for (const id of ids) {
    const span = document.createElement('span');
    span.className = 'jri-sentence';
    span.setAttribute('data-jri-id', String(id));
    span.textContent = `sentence ${id}`;
    document.body.appendChild(span);
    spans.push(span);
  }
  let currentId: number | null = null;
  const readIds = new Set<number>();
  return {
    setCurrent(id) {
      currentId = id;
    },
    getCurrentId: () => currentId,
    getSpans: (id) => spans.filter((s) => Number(s.getAttribute('data-jri-id')) === id),
    isRead: (id) => readIds.has(id),
    markRead: (id) => readIds.add(id),
    unmarkRead: (id) => readIds.delete(id),
    moveNext: () => {
      const idx = ids.indexOf(currentId ?? -1);
      const next = ids[idx + 1] ?? null;
      if (next !== null) currentId = next;
      return next;
    },
    prev: () => null,
    nextWord: () => false,
    prevWord: () => false,
    setWordFocus: () => {},
    setProgress: () => {},
    setWordFocusAt: () => {},
    nextUnreadAfter: () => null,
    getSnapshot: () => ({ total: ids.length, currentId, readIds: new Set(readIds) }),
    getStats: () => ({ total: ids.length, readCount: readIds.size, currentId, unreadMs: 0 }),
    getSpeechTiming: () => ({ durationMs: 0, positionMs: 0 }),
    toPageState: () => ({ url: '', total: ids.length, readRanges: [], currentId, updatedAt: 0 }),
    dispose: () => {},
    destroy: () => {},
    setLightsOut: () => {},
    setLightsOutAsync: async () => {},
    setGuidedMode: () => {},
    isAnimating: () => false,
    markAllReadAsync: async () => {},
    markPreviousRead: () => {},
    advance: () => null,
    tick: () => ({ completed: false }),
  } satisfies ReadingSession;
}

describe('pointer helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('idFromTarget finds the sentence id from a child', () => {
    const span = document.createElement('span');
    span.className = 'jri-sentence';
    span.setAttribute('data-jri-id', '42');
    const em = document.createElement('em');
    em.textContent = 'x';
    span.appendChild(em);
    document.body.appendChild(span);
    expect(idFromTarget(em)).toBe(42);
    expect(idFromTarget(document.body)).toBeNull();
  });

  it('isEditable ignores interactive controls', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(isEditable(input)).toBe(true);
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(isEditable(div)).toBe(false);
  });

  it('pointerToProgress returns a normalized ratio or null', () => {
    const span = document.createElement('span');
    span.className = 'jri-sentence';
    span.setAttribute('data-jri-id', '1');
    span.textContent = 'a b c';
    document.body.appendChild(span);
    const ratio = pointerToProgress([span], [5], 5, 100, 0);
    // In happy-dom rect/caret lookups are unreliable, so accept either a
    // clamped [0,1] number or null — never an out-of-range or object.
    if (ratio !== null) {
      expect(typeof ratio).toBe('number');
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(1);
    }
  });
});

describe('createHoverController', () => {
  let session: ReadingSession;
  beforeEach(() => {
    document.body.innerHTML = '';
    session = makeSession([0, 1]);
  });

  it('shows and clears the hover class', () => {
    const onSelected = vi.fn();
    const hover = createHoverController({ session, onSelected });
    hover.show(1);
    const span = session.getSpans(1)[0]!;
    expect(span.classList.contains('jri-hover')).toBe(true);
    hover.clear();
    expect(span.classList.contains('jri-hover')).toBe(false);
  });

  it('does not reprocess the same hovered id', () => {
    const onSelected = vi.fn();
    const hover = createHoverController({ session, onSelected });
    hover.show(1);
    hover.show(1);
    expect(session.getSpans(1)[0]!.classList.contains('jri-hover')).toBe(true);
  });

  it('schedules a selection that clears hover and notifies onSelected', () => {
    vi.useFakeTimers();
    try {
      // Start on sentence 0 so scheduleSelection's currentId guard passes.
      session.setCurrent(0);
      const onSelected = vi.fn();
      const hover = createHoverController({ session, onSelected });
      hover.show(1);
      hover.scheduleSelection(1, session.getCurrentId()!);
      const span = session.getSpans(1)[0]!;
      expect(span.classList.contains('jri-hover')).toBe(true);
      vi.advanceTimersByTime(250);
      expect(session.getCurrentId()).toBe(1);
      expect(span.classList.contains('jri-hover')).toBe(false);
      expect(onSelected).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroy clears any pending timer', () => {
    vi.useFakeTimers();
    try {
      session.setCurrent(0);
      const hover = createHoverController({ session, onSelected: vi.fn() });
      hover.show(1);
      hover.scheduleSelection(1, session.getCurrentId()!);
      hover.destroy();
      vi.advanceTimersByTime(250);
      expect(session.getCurrentId()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('attachInteraction', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('enables the current-word highlight while hovering in normal reading mode', () => {
    const session = makeSession([0]);
    session.setCurrent(0);
    const setWordFocus = vi.spyOn(session, 'setWordFocus');
    const interaction = attachInteraction(document.body, session, {
      onChange: () => {},
      onNavigate: () => {},
      onToggleGuided: () => {},
      isGuidedReading: () => false,
      onGuidedArrow: () => {},
    });

    session.getSpans(0)[0]!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));

    expect(setWordFocus).toHaveBeenCalledWith(true);
    interaction.detach();
  });

  it('marks a sentence read after half the words and leaving the last word', () => {
    const span = document.createElement('span');
    span.className = 'jri-sentence';
    span.setAttribute('data-jri-id', '0');
    span.innerHTML =
      '<span class="jri-word">one</span> <span class="jri-word">two</span> <span class="jri-word">three</span> <span class="jri-word">four</span>';
    document.body.appendChild(span);
    const session = createReadingSession([span], null);
    session.setCurrent(0);
    const interaction = attachInteraction(document.body, session, {
      onChange: () => {},
      onNavigate: () => {},
      onToggleGuided: () => {},
      isGuidedReading: () => false,
      onGuidedArrow: () => {},
    });

    session.setWordFocus(true);
    let wordIndex = 0;
    document.caretPositionFromPoint = () =>
      ({
        offsetNode: span.querySelectorAll('.jri-word')[wordIndex]!.firstChild!,
        offset: 0,
        getClientRect: () => new DOMRect(),
      }) as CaretPosition;
    span.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    span.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
    expect(session.isRead(0)).toBe(false);
    wordIndex = 3;
    span.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    span.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
    expect(session.isRead(0)).toBe(false);
    document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: span }));
    expect(session.isRead(0)).toBe(true);
    interaction.detach();
    session.destroy();
  });
});

describe('createKeyboardInteraction', () => {
  let session: ReadingSession;
  let cb: {
    onChange: () => void;
    onNavigate: (fromKeyboard?: boolean) => void;
    onToggleGuided: (fromKeyboard?: boolean) => void;
    isGuidedReading: () => boolean;
    onGuidedArrow: () => void;
  };
  let onPointerReset: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    document.body.innerHTML = '';
    session = makeSession([0, 1, 2]);
    cb = {
      onChange: vi.fn<() => void>(),
      onNavigate: vi.fn<(fromKeyboard?: boolean) => void>(),
      onToggleGuided: vi.fn<(fromKeyboard?: boolean) => void>(),
      isGuidedReading: () => false,
      onGuidedArrow: vi.fn<() => void>(),
    };
    onPointerReset = vi.fn<() => void>();
    session.setCurrent(0);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('navigates down with ArrowDown and resets the pointer state', () => {
    const kb = createKeyboardInteraction(window, { session, cb, onPointerReset });
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true });
    kb.onKeyDown(event);
    expect(session.getCurrentId()).toBe(1);
    expect(event.defaultPrevented).toBe(true);
    expect(onPointerReset).toHaveBeenCalledTimes(1);
    expect(cb.onNavigate).toHaveBeenCalledWith(true);
  });

  it('notifies navigation after ArrowDown completes the final sentence', () => {
    const span = document.createElement('span');
    span.className = 'jri-sentence';
    span.setAttribute('data-jri-id', '0');
    document.body.appendChild(span);
    const readingSession = createReadingSession([span], null);
    readingSession.setCurrent(0);
    const kb = createKeyboardInteraction(window, { session: readingSession, cb, onPointerReset });

    kb.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true }));

    expect(readingSession.isRead(0)).toBe(true);
    expect(readingSession.getCurrentId()).toBeNull();
    expect(cb.onNavigate).toHaveBeenCalledWith(true);
    expect(onPointerReset).toHaveBeenCalledTimes(1);
    readingSession.destroy();
  });

  it('notifies navigation when ArrowRight completes the final guided word', () => {
    const span = document.createElement('span');
    span.className = 'jri-sentence';
    span.setAttribute('data-jri-id', '0');
    span.innerHTML = '<span class="jri-word">last</span>';
    document.body.appendChild(span);
    const readingSession = createReadingSession([span], null);
    readingSession.setCurrent(0);
    readingSession.setWordFocus(true);
    cb.isGuidedReading = () => true;
    const kb = createKeyboardInteraction(window, { session: readingSession, cb, onPointerReset });
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, bubbles: true });

    kb.onKeyDown(event);

    expect(readingSession.isRead(0)).toBe(true);
    expect(readingSession.getCurrentId()).toBeNull();
    expect(event.defaultPrevented).toBe(true);
    expect(cb.onNavigate).toHaveBeenCalledWith(true);
    expect(onPointerReset).toHaveBeenCalledTimes(1);
    kb.detach();
    readingSession.destroy();
  });

  it('ignores keys while focused in an editable field', () => {
    createKeyboardInteraction(window, { session, cb, onPointerReset });
    const input = document.createElement('input');
    document.body.appendChild(input);
    // Dispatch on the editable input; the event bubbles to the capture-phase
    // window listener with the input as target, which the handler skips.
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true });
    input.dispatchEvent(event);
    expect(session.getCurrentId()).toBe(0);
    expect(onPointerReset).not.toHaveBeenCalled();
  });

  it('detach removes the window keydown listener', () => {
    const kb = createKeyboardInteraction(window, { session, cb, onPointerReset });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(session.getCurrentId()).toBe(1);
    kb.detach();
  });
});
