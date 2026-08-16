/**
 * Keyboard navigation for the reader
 *
 */
import type { ReadingSession } from '../../reading/state';
import type { InteractionCallbacks } from './interaction';

export interface KeyboardContext {
  session: ReadingSession;
  cb: InteractionCallbacks;
  /** Dismiss hover/preview state after a handled key. */
  onPointerReset(): void;
}

export interface KeyboardInteraction {
  onKeyDown(e: Event): void;
  detach(): void;
}

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'input, textarea, select, button, a, audio, video, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [role="menuitem"], [role="textbox"]',
    ) !== null
  );
}

export function createKeyboardInteraction(win: Window, context: KeyboardContext): KeyboardInteraction {
  const { session, cb, onPointerReset } = context;

  function onKeyDown(e: Event): void {
    const ke = e as KeyboardEvent;
    if (isEditable(ke.target)) return;
    let handled = false;
    let wordArrow = false;
    let navigationKey = false;
    if (!ke.ctrlKey && !ke.metaKey && !ke.altKey) {
      switch (ke.key) {
        case 'ArrowDown':
        case 's':
          // moveNext returns null after marking the final sentence read. That
          // is still a navigation event so the reader can update completion UI.
          handled = session.getCurrentId() !== null;
          session.moveNext();
          navigationKey = handled;
          break;
        case 'ArrowUp':
        case 'w':
          session.prev();
          handled = true;
          navigationKey = true;
          break;
        case 'ArrowRight':
        case 'd':
          session.setWordFocus(true);
          handled = session.nextWord();
          wordArrow = handled;
          navigationKey = handled;
          break;
        case 'ArrowLeft':
        case 'a':
          session.setWordFocus(true);
          handled = session.prevWord();
          wordArrow = handled;
          navigationKey = handled;
          break;
        case 'r':
        case 'R': {
          const current = session.getCurrentId();
          if (current !== null) {
            session.markRead(current);
            session.moveNext();
            handled = true;
            navigationKey = true;
          }
          break;
        }
        case ' ':
          cb.onToggleGuided(true);
          handled = true;
          break;
      }
    }
    if (handled) {
      ke.preventDefault();
      ke.stopPropagation();
      onPointerReset();
      if (wordArrow && cb.isGuidedReading()) cb.onGuidedArrow();
      if (navigationKey) cb.onNavigate(true);
    }
  }

  win.addEventListener('keydown', onKeyDown, true);

  function detach(): void {
    win.removeEventListener('keydown', onKeyDown, true);
  }

  return { onKeyDown, detach };
}
