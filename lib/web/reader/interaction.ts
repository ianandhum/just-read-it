/**
 * Reader view interactions
 */
import type { ReadingSession } from '../../reading/state';
import { idFromTarget, pointerToProgress, SENTENCE_SELECTOR, ID_ATTR } from './helpers';
import { createHoverController, type HoverController } from './hover';
import { createKeyboardInteraction, type KeyboardInteraction } from './keyboard';

export interface InteractionCallbacks {
  onChange: () => void;
  onNavigate: (fromKeyboard?: boolean) => void;
  onToggleGuided: (fromKeyboard?: boolean) => void;
  isGuidedReading: () => boolean;
  onGuidedArrow: () => void;
  onSentenceHover?: (hovered: boolean) => void;
}

export interface InteractionHandle {
  detach: () => void;
  isMouseInside: () => boolean;
  lastMouseMoveAt: () => number;
}

const HOVER_AUTO_READ_THRESHOLD = 0.3;

export function attachInteraction(root: Element, session: ReadingSession, cb: InteractionCallbacks): InteractionHandle {
  let mouseInside = false;
  let lastMoveAt = 0;
  let pointerMovedSinceScroll = false;
  let sentenceHovered = false;
  let spanCache: { id: number; spans: HTMLSpanElement[]; lengths: number[]; total: number } | null = null;
  const hoveredWordsById = new Map<number, Set<HTMLElement>>();

  function markHoveredSentenceRead(id: number): boolean {
    if (cb.isGuidedReading()) return false;
    const spans = session.getSpans(id);
    const words = spans.flatMap((span) => Array.from(span.querySelectorAll<HTMLElement>('.jri-word')));
    const hoveredWords = hoveredWordsById.get(id);
    const lastWord = words.at(-1);
    if (!hoveredWords || !lastWord || !hoveredWords.has(lastWord) || hoveredWords.size < Math.ceil(words.length * HOVER_AUTO_READ_THRESHOLD)) return false;
    session.markRead(id);
    hoveredWordsById.delete(id);
    spanCache = null;
    mouseInside = false;
    cb.onChange();
    return true;
  }
  let touchStart: { pointerId: number; id: number; x: number; y: number } | null = null;
  let suppressTouchClick = false;

  function setSentenceHover(hovered: boolean): void {
    if (sentenceHovered === hovered) return;
    sentenceHovered = hovered;
    cb.onSentenceHover?.(hovered);
  }

  const hover: HoverController = createHoverController({
    session,
    onSelected: () => {
      spanCache = null;
      cb.onChange();
    },
  });

  function currentSpans(): { spans: HTMLSpanElement[]; lengths: number[]; total: number } | null {
    const id = session.getCurrentId();
    if (id === null) return null;
    if (spanCache?.id === id) return spanCache;
    const spans = session.getSpans(id);
    const lengths = spans.map((span) => span.textContent?.length ?? 0);
    spanCache = {
      id,
      spans,
      lengths,
      total: lengths.reduce((sum, length) => sum + length, 0),
    };
    return spanCache;
  }

  function onMouseOver(e: Event): void {
    // Scrolling can trigger mouseover without a pointer move.
    if (!pointerMovedSinceScroll) return;
    if (!(e.target instanceof Element)) return;
    const span = e.target.closest(SENTENCE_SELECTOR);
    if (!span) {
      const currentId = session.getCurrentId();
      if (currentId !== null) markHoveredSentenceRead(currentId);
      mouseInside = false;
      hover.clear();
      setSentenceHover(false);
      return;
    }
    const attr = span.getAttribute(ID_ATTR);
    if (attr === null) return;
    const id = Number(attr);
    if (Number.isNaN(id)) return;
    setSentenceHover(true);
    const currentId = session.getCurrentId();
    if (currentId !== null && id !== currentId) markHoveredSentenceRead(currentId);
    if (!cb.isGuidedReading() && currentId !== null && id !== currentId) {
      hover.show(id);
      mouseInside = true;
      lastMoveAt = performance.now();
      return;
    }
    if (cb.isGuidedReading()) {
      hover.show(id);
      mouseInside = true;
      lastMoveAt = performance.now();
      return;
    }
    const prev = session.getCurrentId();
    if (prev !== id) {
      session.setCurrent(id);
      spanCache = null;
      cb.onChange();
    }
    mouseInside = true;
    lastMoveAt = performance.now();
  }

  function onMouseMove(e: Event): void {
    pointerMovedSinceScroll = true;
    if (!mouseInside) {
      onMouseOver(e);
    }
    if (!mouseInside) return;
    const id = session.getCurrentId();
    if (id === null) return;
    const targetId = idFromTarget(e.target);
    if (targetId !== id) {
      if (targetId !== null) hover.scheduleSelection(targetId, id);
      return;
    }
    // Guided hover previews must not move the active sentence’s word focus.
    // Only pointer movement within the active sentence may update progress.
    if (cb.isGuidedReading() && targetId !== id) return;
    if (!cb.isGuidedReading()) session.setWordFocus(true);
    const spanInfo = currentSpans();
    if (!spanInfo || spanInfo.spans.length === 0) return;
    const me = e as MouseEvent;
    const ratio = pointerToProgress(spanInfo.spans, spanInfo.lengths, spanInfo.total, me.clientX, me.clientY);
    if (ratio === null) return;
    session.setProgress(ratio);
    lastMoveAt = performance.now();
    if (cb.isGuidedReading()) return;
    const words = spanInfo.spans.flatMap((span) => Array.from(span.querySelectorAll<HTMLElement>('.jri-word')));
    const hoveredWord = e.target instanceof Element ? e.target.closest<HTMLElement>('.jri-word') : null;
    if (hoveredWord) session.setWordFocusAt(words.indexOf(hoveredWord));
    const currentWord = hoveredWord ?? words.find((word) => word.classList.contains('jri-word-current'));
    if (!currentWord) return;
    const hoveredWords = hoveredWordsById.get(id) ?? new Set<HTMLElement>();
    hoveredWords.add(currentWord);
    hoveredWordsById.set(id, hoveredWords);
  }

  function onClick(e: Event): void {
    if (suppressTouchClick) {
      suppressTouchClick = false;
      e.preventDefault();
      return;
    }
    const id = idFromTarget(e.target);
    if (id === null) return;
    hover.clear();
    if (session.isRead(id)) {
      session.unmarkRead(id);
      spanCache = null;
      cb.onChange();
      return;
    }
    if (cb.isGuidedReading()) {
      session.setCurrent(id, { force: true, fresh: true });
      spanCache = null;
      cb.onNavigate();
      return;
    }
    session.markRead(id);
    spanCache = null;
    cb.onChange();
  }

  function onPointerDown(event: Event): void {
    const e = event as PointerEvent;
    if (e.pointerType !== 'touch') return;
    const id = idFromTarget(e.target);
    touchStart = id === null ? null : { pointerId: e.pointerId, id, x: e.clientX, y: e.clientY };
  }

  function onPointerUp(event: Event): void {
    const e = event as PointerEvent;
    if (e.pointerType !== 'touch' || touchStart?.pointerId !== e.pointerId) return;
    const touch = touchStart;
    touchStart = null;
    if (Math.hypot(e.clientX - touch.x, e.clientY - touch.y) >= 8 || idFromTarget(e.target) !== touch.id) return;
    hover.clear();
    session.setCurrent(touch.id, { force: true, fresh: true });
    spanCache = null;
    suppressTouchClick = true;
    cb.onNavigate();
    e.preventDefault();
  }

  function onPointerCancel(event: Event): void {
    const e = event as PointerEvent;
    if (touchStart?.pointerId === e.pointerId) touchStart = null;
  }

  function resetPointerFromKeyboard(): void {
    mouseInside = false;
    hover.clear();
    spanCache = null;
    setSentenceHover(false);
  }

  function onScroll(): void {
    pointerMovedSinceScroll = false;
    mouseInside = false;
    spanCache = null;
    hover.clear();
    setSentenceHover(false);
  }

  const keyboard: KeyboardInteraction = createKeyboardInteraction(window, {
    session,
    cb,
    onPointerReset: resetPointerFromKeyboard,
  });

  root.addEventListener('mouseover', onMouseOver);
  root.addEventListener('mousemove', onMouseMove);
  root.addEventListener('click', onClick);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('scroll', onScroll, { passive: true });

  return {
    detach: () => {
      hover.destroy();
      keyboard.detach();
      root.removeEventListener('mouseover', onMouseOver);
      root.removeEventListener('mousemove', onMouseMove);
      root.removeEventListener('click', onClick);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointerup', onPointerUp);
      root.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('scroll', onScroll);
    },
    isMouseInside: () => mouseInside,
    lastMouseMoveAt: () => lastMoveAt,
  };
}

export {};
