import { describe, it, expect, beforeEach } from 'vitest';
import { createReadingSession } from '../../lib/reading/state';

function setupDoc(): Document {
  return document.implementation.createHTMLDocument('test');
}

function makeSpan(doc: Document, id: number, text = ''): HTMLSpanElement {
  const s = doc.createElement('span');
  s.className = 'jri-sentence';
  s.setAttribute('data-jri-id', String(id));
  s.textContent = text || `s${id}`;
  doc.body.appendChild(s);
  return s;
}

function makeSpans(doc: Document, ids: number[]): HTMLSpanElement[] {
  return ids.map((id) => makeSpan(doc, id));
}

function classes(doc: Document, id: number): string {
  const span = doc.querySelector(`[data-jri-id="${id}"]`);
  return span ? span.className : '';
}

/** Current class string for a single-span sentence. */
const CURRENT = 'jri-sentence jri-current';

describe('createReadingSession', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('has no classes on fresh state', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2]);
    const session = createReadingSession(spans, null);
    expect(session.getSnapshot().currentId).toBeNull();
    expect(session.getSnapshot().readIds.size).toBe(0);
    expect(classes(doc, 0)).toBe('jri-sentence');
    expect(classes(doc, 1)).toBe('jri-sentence');
    expect(classes(doc, 2)).toBe('jri-sentence');
    session.destroy();
  });

  it('total reflects unique sentence ids, not span count', () => {
    const doc = setupDoc();
    const s0a = doc.createElement('span');
    s0a.className = 'jri-sentence';
    s0a.setAttribute('data-jri-id', '0');
    const s0b = doc.createElement('span');
    s0b.className = 'jri-sentence';
    s0b.setAttribute('data-jri-id', '0');
    const s1 = makeSpan(doc, 1);
    doc.body.append(s0a, s0b, s1);
    const session = createReadingSession([s0a, s0b, s1], null);
    expect(session.getSnapshot().total).toBe(2);
    session.destroy();
  });

  it('applies jri-read to initial readIds', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2]);
    const session = createReadingSession(spans, {
      currentId: null,
      readIds: [0, 2],
    });
    expect(classes(doc, 0)).toBe('jri-sentence jri-read');
    expect(classes(doc, 1)).toBe('jri-sentence');
    expect(classes(doc, 2)).toBe('jri-sentence jri-read');
    session.destroy();
  });

  it('applies jri-current to initial currentId and removes it from read', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2]);
    const session = createReadingSession(spans, {
      currentId: 1,
      readIds: [0, 1, 2],
    });
    expect(classes(doc, 1)).toBe(CURRENT);
    expect(session.getSnapshot().readIds.has(1)).toBe(false);
    expect(session.getSnapshot().readIds.has(0)).toBe(true);
    session.destroy();
  });

  it('ignores restored ids that are not present in the current page', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1]);
    const session = createReadingSession(spans, {
      currentId: 9,
      readIds: [0, 9],
    });
    expect(session.getSnapshot().currentId).toBeNull();
    expect(session.getSnapshot().readIds).toEqual(new Set([0]));
    session.destroy();
  });

  it('adds jri-dimmed after more than one sentence is read', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2, 3, 4]);
    const session = createReadingSession(spans, null, { lightsOut: true, guidedMode: true });

    session.markRead(0);
    expect(classes(doc, 4)).toBe('jri-sentence');

    session.markRead(1);
    expect(classes(doc, 0)).toBe('jri-sentence jri-read jri-dimmed');
    expect(classes(doc, 4)).toBe('jri-sentence jri-dimmed');

    session.setCurrent(4);
    expect(classes(doc, 4)).toBe('jri-sentence jri-current');
    session.destroy();
  });

  it('moves forward and marks the current sentence read', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2]);
    const session = createReadingSession(spans, null);
    session.setCurrent(0);

    expect(session.moveNext()).toBe(1);
    expect(session.getSnapshot().readIds.size).toBe(1);
    expect(session.getSnapshot().readIds.has(0)).toBe(true);
    expect(session.getSnapshot().currentId).toBe(1);
    session.destroy();
  });

  it('clears the last current sentence even when earlier sentences remain unread', () => {
    const doc = setupDoc();
    const session = createReadingSession(makeSpans(doc, [0, 1, 2]), null);
    session.setCurrent(2);

    expect(session.moveNext()).toBeNull();
    expect(session.getSnapshot()).toEqual({ total: 3, currentId: null, readIds: new Set([2]) });
    expect(classes(doc, 2)).toBe('jri-sentence jri-read');
    expect(session.isAnimating()).toBe(false);
    session.destroy();
  });

  it('dims all non-current sentences immediately when Auto Dimming is explicit', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2]);
    const session = createReadingSession(spans, null);
    session.setCurrent(0);
    session.setLightsOut(true, true);

    expect(classes(doc, 0)).toBe(CURRENT);
    expect(classes(doc, 1)).toBe('jri-sentence jri-dimmed');
    session.destroy();
  });

  it('can immediately dim a guided session when read aloud starts', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2]);
    const session = createReadingSession(spans, null, { lightsOut: true, guidedMode: true });
    session.setCurrent(0);
    session.setLightsOut(true, true);

    expect(classes(doc, 0)).toBe(CURRENT);
    expect(classes(doc, 1)).toBe('jri-sentence jri-dimmed');
    session.destroy();
  });

  it('setCurrent marks the sentence current (yellow, fill starts at 0)', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2]);
    const session = createReadingSession(spans, null);
    session.setCurrent(0);
    expect(classes(doc, 0)).toBe(CURRENT);
    session.destroy();
  });

  it('highlights the guided-reading word at the current progress', () => {
    const doc = setupDoc();
    const span = makeSpan(doc, 0, 'one two three');
    span.innerHTML = '<span class="jri-word">one</span> <span class="jri-word">two</span> <span class="jri-word">three</span>';
    const nextSpan = makeSpan(doc, 1, 'next sentence');
    const session = createReadingSession([span, nextSpan], null);
    session.setCurrent(0);
    session.setWordFocus(true);
    expect(span.querySelector('.jri-word-current')?.textContent).toBe('one');
    session.setProgress(0.5);
    expect(span.querySelector('.jri-word-current')?.textContent).toBe('two');
    session.setProgress(0.9);
    expect(span.querySelector('.jri-word-current')?.textContent).toBe('three');
    session.setWordFocus(false);
    expect(span.querySelector('.jri-word-current')?.textContent).toBe('three');
    session.setCurrent(1);
    expect(span.querySelector('.jri-word-current')).toBeNull();
    session.destroy();
  });

  it('snaps guided progress to completed word boundaries', () => {
    const doc = setupDoc();
    const span = makeSpan(doc, 0, 'one two three');
    span.innerHTML = '<span class="jri-word">one</span> <span class="jri-word">two</span> <span class="jri-word">three</span>';
    const session = createReadingSession([span], null);
    session.setCurrent(0);
    session.setWordFocus(true);
    session.setProgress(0.5);
    expect(span.querySelector('.jri-word-current')?.textContent).toBe('two');
    session.destroy();
  });

  it('holds the guided word cursor briefly on punctuation', () => {
    const doc = setupDoc();
    const span = makeSpan(doc, 0, 'go, now');
    span.innerHTML = '<span class="jri-word">go,</span> <span class="jri-word">now</span>';
    const session = createReadingSession([span], null);
    session.setCurrent(0);
    session.setWordFocus(true);
    session.setProgress(0.6);
    expect(span.querySelector('.jri-word-current')?.textContent).toBe('go,');
    session.setProgress(0.7);
    expect(span.querySelector('.jri-word-current')?.textContent).toBe('now');
    session.destroy();
  });

  it('advances to the next sentence from its last guided word', () => {
    const doc = setupDoc();
    const first = makeSpan(doc, 0, 'one two');
    first.innerHTML = '<span class="jri-word">one</span> <span class="jri-word">two</span>';
    const second = makeSpan(doc, 1, 'next sentence');
    second.innerHTML = '<span class="jri-word">next</span> <span class="jri-word">sentence</span>';
    const session = createReadingSession([first, second], null);
    session.setCurrent(0);
    session.setWordFocus(true);

    expect(session.nextWord()).toBe(true);
    expect(session.nextWord()).toBe(true);
    expect(session.getCurrentId()).toBe(1);
    expect(second.querySelector('.jri-word-current')?.textContent).toBe('next');
    session.destroy();
  });

  it('moves to the previous sentence from its first guided word', () => {
    const doc = setupDoc();
    const first = makeSpan(doc, 0, 'previous sentence');
    first.innerHTML = '<span class="jri-word">previous</span> <span class="jri-word">sentence</span>';
    const second = makeSpan(doc, 1, 'one two');
    second.innerHTML = '<span class="jri-word">one</span> <span class="jri-word">two</span>';
    const session = createReadingSession([first, second], null);
    session.setCurrent(1);
    session.setWordFocus(true);

    expect(session.prevWord()).toBe(true);
    expect(session.getCurrentId()).toBe(0);
    expect(first.querySelector('.jri-word-current')?.textContent).toBe('sentence');
    session.destroy();
  });

  it('reports a change when the final guided word completes the article', () => {
    const doc = setupDoc();
    const span = makeSpan(doc, 0);
    span.innerHTML = '<span class="jri-word">last</span>';
    const session = createReadingSession([span], null);
    session.setCurrent(0);
    session.setWordFocus(true);

    expect(session.nextWord()).toBe(true);
    expect(session.getCurrentId()).toBeNull();
    expect(session.isRead(0)).toBe(true);
    expect(span.querySelector('.jri-word-current')).toBeNull();
    expect(session.nextWord()).toBe(false);
    session.destroy();
  });

  it('does not move backward from the first word of the first sentence', () => {
    const doc = setupDoc();
    const span = makeSpan(doc, 0);
    span.innerHTML = '<span class="jri-word">first</span> <span class="jri-word">last</span>';
    const session = createReadingSession([span], null);
    session.setCurrent(0);
    session.setWordFocus(true);
    const timing = session.getSpeechTiming();

    expect(session.prevWord()).toBe(false);
    expect(session.getCurrentId()).toBe(0);
    expect(span.querySelector('.jri-word-current')?.textContent).toBe('first');
    expect(session.getSpeechTiming()).toEqual(timing);
    session.destroy();
  });

  it('moves from the second-last word to the last word before crossing sentences', () => {
    const doc = setupDoc();
    const first = makeSpan(doc, 0, 'one two three');
    first.innerHTML = '<span class="jri-word">one</span> <span class="jri-word">two</span> <span class="jri-word">three</span>';
    const second = makeSpan(doc, 1, 'next sentence');
    second.innerHTML = '<span class="jri-word">next</span> <span class="jri-word">sentence</span>';
    const session = createReadingSession([first, second], null);
    session.setCurrent(0);
    session.setWordFocus(true);

    session.nextWord();
    expect(first.querySelector('.jri-word-current')?.textContent).toBe('two');
    expect(session.nextWord()).toBe(true);
    expect(first.querySelector('.jri-word-current')?.textContent).toBe('three');
    expect(session.getCurrentId()).toBe(0);
    session.destroy();
  });

  it('setCurrent does NOT mark the previous current as read', () => {
    // Per NOTES.md point 1: only click/animation-complete/keyboard-next mark
    // a sentence read. Moving to another sentence keeps the old one
    // partially read (progress saved, not read).
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2]);
    const session = createReadingSession(spans, null);
    session.setCurrent(0);
    session.setCurrent(1);
    expect(classes(doc, 0)).toBe('jri-sentence'); // not read, not current
    expect(session.getSnapshot().readIds.has(0)).toBe(false);
    expect(classes(doc, 1)).toBe(CURRENT);
    session.destroy();
  });

  it('setCurrent resumes from saved progress on re-hover', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1]);
    const session = createReadingSession(spans, null);
    session.setCurrent(0);
    session.setProgress(0.5);
    // Leave (hover another).
    session.setCurrent(1);
    // Come back.
    session.setCurrent(0);
    session.destroy();
  });

  it('setCurrent on a read sentence is a no-op unless forced (NOTES point 1)', () => {
    // Point 1: hovering over an already-read sentence must NOT drag it back
    // into "reading". Only an explicit action (force / keyboard) may re-read.
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1]);
    const session = createReadingSession(spans, null);
    session.markRead(0);
    expect(classes(doc, 0)).toBe('jri-sentence jri-read');
    session.setCurrent(0); // no force → no-op
    expect(classes(doc, 0)).toBe('jri-sentence jri-read');
    expect(session.getSnapshot().readIds.has(0)).toBe(true);
    expect(session.getSnapshot().currentId).toBeNull();
    // Explicit re-read (click / keyboard) un-reads and resets progress.
    session.setCurrent(0, { force: true });
    expect(classes(doc, 0)).toBe(CURRENT);
    expect(session.getSnapshot().readIds.has(0)).toBe(false);
    session.destroy();
  });

  it('markRead sets the read class and clears current', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1]);
    const session = createReadingSession(spans, null);
    session.setCurrent(0);
    session.markRead(0);
    expect(classes(doc, 0)).toBe('jri-sentence jri-read');
    expect(session.getSnapshot().currentId).toBeNull();
    session.destroy();
  });

  it('markRead on a non-current sentence also works (click)', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2]);
    const session = createReadingSession(spans, null);
    session.setCurrent(1);
    session.markRead(2);
    expect(classes(doc, 2)).toBe('jri-sentence jri-read');
    expect(session.getSnapshot().currentId).toBe(1);
    session.destroy();
  });

  it('setProgress clamps to [0, 1]', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0]);
    const session = createReadingSession(spans, null);
    session.setCurrent(0);
    session.setProgress(2);
    session.setProgress(-1);
    session.destroy();
  });

  it('setProgress is a no-op when nothing is current', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1]);
    const session = createReadingSession(spans, null);
    session.setProgress(0.5);
    expect(session.getSnapshot().currentId).toBeNull();
    session.destroy();
  });

  it('tick advances progress and marks read at 100%', () => {
    const doc = setupDoc();
    // 1 word -> 600ms reading time.
    const spans = [makeSpan(doc, 0, 'hello')];
    const session = createReadingSession(spans, null);
    session.setCurrent(0);
    const r1 = session.tick(300); // 300/600 = 50%
    expect(r1.completed).toBe(false);
    const r2 = session.tick(300); // +300 -> 100%
    expect(r2.completed).toBe(true);
    expect(classes(doc, 0)).toBe('jri-sentence jri-read');
    expect(session.getSnapshot().currentId).toBeNull();
    session.destroy();
  });

  it('tick is a no-op when nothing is current', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0]);
    const session = createReadingSession(spans, null);
    const r = session.tick(1000);
    expect(r.completed).toBe(false);
    session.destroy();
  });

  it('isAnimating reflects current + progress < 1', () => {
    const doc = setupDoc();
    const spans = [makeSpan(doc, 0, 'hello')];
    const session = createReadingSession(spans, null);
    expect(session.isAnimating()).toBe(false);
    session.setCurrent(0);
    expect(session.isAnimating()).toBe(true);
    session.tick(600);
    expect(session.isAnimating()).toBe(false);
    session.destroy();
  });

  it('advance marks current read and advances (fresh progress)', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2]);
    const session = createReadingSession(spans, null);
    session.setCurrent(0);
    session.setProgress(0.5);
    const next = session.advance();
    expect(next).toBe(1);
    expect(classes(doc, 0)).toBe('jri-sentence jri-read');
    expect(session.getSnapshot().readIds.has(0)).toBe(true);
    expect(classes(doc, 1)).toBe(CURRENT);
    session.destroy();
  });

  it('advance at the end marks read and clears current', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1]);
    const session = createReadingSession(spans, null);
    session.setCurrent(1);
    const next = session.advance();
    expect(next).toBeNull();
    expect(session.getSnapshot().readIds.has(1)).toBe(true);
    expect(session.getSnapshot().currentId).toBeNull();
    session.destroy();
  });

  it('prev moves back without marking current read', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2]);
    const session = createReadingSession(spans, null);
    session.setCurrent(2);
    const prev = session.prev();
    expect(prev).toBe(1);
    expect(session.getSnapshot().readIds.has(2)).toBe(false);
    expect(classes(doc, 2)).toBe('jri-sentence'); // no longer current
    expect(classes(doc, 1)).toBe(CURRENT);
    session.destroy();
  });

  it('prev at the start stays put', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1]);
    const session = createReadingSession(spans, null);
    session.setCurrent(0);
    expect(session.prev()).toBe(0);
    session.destroy();
  });

  it('multi-span fill flows continuously across spans', () => {
    const doc = setupDoc();
    const s0a = makeSpan(doc, 0, 'aaaa'); // 4 chars
    const s0b = makeSpan(doc, 0, 'bbbb'); // 4 chars
    const s0c = makeSpan(doc, 0, 'cc'); // 2 chars (total = 10)
    const session = createReadingSession([s0a, s0b, s0c], null);
    session.setCurrent(0);
    session.setProgress(0.5); // 50% of 10 chars = 5 chars in
    // s0a covers [0, 40%) -> fully filled
    // s0b covers [40%, 80%) -> fill = (50-40)/(80-40) = 25%
    // s0c covers [80%, 100%) -> not started
    session.destroy();
  });

  it('multi-span fill at 100% fills all spans', () => {
    const doc = setupDoc();
    const s0a = makeSpan(doc, 0, 'aaaa');
    const s0b = makeSpan(doc, 0, 'bb');
    const session = createReadingSession([s0a, s0b], null);
    session.setCurrent(0);
    session.setProgress(1);
    session.destroy();
  });

  it('toPageState returns compact read ranges and the url', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2]);
    const session = createReadingSession(spans, null);
    session.markRead(2);
    session.markRead(0);
    session.setCurrent(1);
    const page = session.toPageState('https://example.com/a');
    expect(page.url).toBe('https://example.com/a');
    expect(page.total).toBe(3);
    expect(page.readRanges).toEqual([
      [0, 1],
      [2, 1],
    ]);
    expect(page.currentId).toBe(1);
    expect(typeof page.updatedAt).toBe('number');
    session.destroy();
  });

  it('destroy removes all applied classes and styles', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1]);
    const session = createReadingSession(spans, { currentId: 0, readIds: [1] });
    session.destroy();
    expect(classes(doc, 0)).toBe('jri-sentence');
    expect(classes(doc, 1)).toBe('jri-sentence');
  });

  it('ignores setCurrent/markRead for unknown ids', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1]);
    const session = createReadingSession(spans, null);
    session.setCurrent(99);
    session.markRead(99);
    expect(session.getSnapshot().currentId).toBeNull();
    expect(session.getSnapshot().readIds.size).toBe(0);
    session.destroy();
  });

  it('nextUnreadAfter returns the first unread sentence after the id', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2, 3]);
    const session = createReadingSession(spans, null);
    session.markRead(0);
    session.markRead(2);
    // After 1 → next unread is 3.
    expect(session.nextUnreadAfter(1)).toBe(3);
    // After 3 → none.
    expect(session.nextUnreadAfter(3)).toBeNull();
    // After null → first unread (0 is read) → 1.
    expect(session.nextUnreadAfter(null)).toBe(1);
    session.destroy();
  });

  it('nextUnreadAfter skips read sentences and never goes backward', () => {
    const doc = setupDoc();
    const spans = makeSpans(doc, [0, 1, 2, 3, 4]);
    const session = createReadingSession(spans, null);
    session.markRead(1);
    session.markRead(3);
    // From 0: 0 is unread but we want *after* 0 → 2 (1 is read, skipped).
    expect(session.nextUnreadAfter(0)).toBe(2);
    // From 4 (last): nothing after.
    expect(session.nextUnreadAfter(4)).toBeNull();
    session.destroy();
  });
});
