/**
 * Mouse hover event lifecycle
 */
import type { ReadingSession } from '../../reading/state';
import { HOVER_CLASS } from './helpers';

const HOVER_SETTLE_MS = 100;
const MOUSE_CURRENT_CLASS = 'jri-mouse-current';

export interface HoverSelectionContext {
  session: ReadingSession;
  /** Called when a settled hover selects a new sentence. */
  onSelected(id: number): void;
}

export interface HoverController {
  show(id: number): void;
  clear(): void;
  scheduleSelection(id: number, currentId: number): void;
  isHovering(id: number): boolean;
  destroy(): void;
}

export function createHoverController(context: HoverSelectionContext): HoverController {
  const { session, onSelected } = context;
  let hoveredId: number | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  function clear(): void {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (hoveredId === null) return;
    for (const span of session.getSpans(hoveredId)) span.classList.remove(HOVER_CLASS);
    hoveredId = null;
  }

  function show(id: number): void {
    if (hoveredId === id) return;
    clear();
    hoveredId = id;
    for (const span of session.getSpans(id)) span.classList.add(HOVER_CLASS);
  }

  function scheduleSelection(id: number, currentId: number): void {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (hoveredId !== id || session.getCurrentId() !== currentId) return;
      clear();
      const spans = session.getSpans(id);
      for (const span of spans) span.classList.add(MOUSE_CURRENT_CLASS);
      session.setCurrent(id);
      onSelected(id);
      requestAnimationFrame(() => {
        for (const span of spans) span.classList.remove(MOUSE_CURRENT_CLASS);
      });
    }, HOVER_SETTLE_MS);
  }

  function isHovering(id: number): boolean {
    return hoveredId === id;
  }

  function destroy(): void {
    clear();
  }

  return { show, clear, scheduleSelection, isHovering, destroy };
}
