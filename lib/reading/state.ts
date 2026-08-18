import type { PageState } from '../types';
import { estimateReadingMs } from './reading_time';
import { readIdsToRanges } from '../progress_share';

const CURRENT_CLASS = 'jri-current';
const READ_CLASS = 'jri-read';
const DIMMED_CLASS = 'jri-dimmed';
const CURRENT_WORD_CLASS = 'jri-word-current';
const ID_ATTR = 'data-jri-id';

function wordWeight(word: HTMLElement): number {
  const text = word.textContent ?? '';
  const length = text.length;
  if (/[.!?…]$/u.test(text)) return length + 4;
  if (/[;:]$/u.test(text)) return length + 3;
  if (/[,]$/u.test(text)) return length + 2;
  return length;
}

export interface ReadingSnapshot {
  total: number;
  currentId: number | null;
  readIds: Set<number>;
}

export interface TickResult {
  completed: boolean;
}

export interface ReadingStats {
  total: number;
  readCount: number;
  currentId: number | null;
  unreadMs: number;
}

export interface ReadingSession {
  setCurrent(id: number, opts?: { fresh?: boolean; force?: boolean }): void;
  markRead(id: number): void;
  unmarkRead(id: number): void;
  markAllReadAsync(): Promise<void>;
  markPreviousRead(): void;
  setProgress(ratio: number): void;
  setWordFocusAt(index: number): void;
  tick(dtMs: number): TickResult;
  moveNext(): number | null;
  advance(): number | null;
  prev(): number | null;
  nextWord(): boolean;
  prevWord(): boolean;
  nextUnreadAfter(id: number | null): number | null;
  setWordFocus(on: boolean): void;
  setLightsOut(on: boolean, immediate?: boolean): void;
  setLightsOutAsync(on: boolean, immediate?: boolean): Promise<void>;
  setGuidedMode(on: boolean): void;
  getCurrentId(): number | null;
  isRead(id: number): boolean;
  getSpans(id: number): HTMLSpanElement[];
  isAnimating(): boolean;
  getStats(): ReadingStats;
  getSpeechTiming(): { durationMs: number; positionMs: number };
  getSnapshot(): ReadingSnapshot;
  toPageState(
    url: string,
    title?: string,
    timeSpentMs?: number,
    dailyTimeSpentMs?: Record<string, number>,
    metadata?: Pick<PageState, 'faviconUrl' | 'previewImageUrl' | 'starred' | 'listenTimeSpentMs' | 'dailyListenTimeSpentMs'>,
  ): PageState;
  /** Release session state without touching retained reader DOM. */
  dispose(): void;
  destroy(): void;
}

interface SentenceMetrics {
  words: HTMLElement[];
  wordStarts: number[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function createReadingSession(
  spans: HTMLSpanElement[],
  initial: { currentId: number | null; readIds: number[] } | null,
  options: { lightsOut?: boolean; guidedMode?: boolean } = {},
): ReadingSession {
  const byId = new Map<number, HTMLSpanElement[]>();
  const orderedIds: number[] = [];
  const indexById = new Map<number, number>();
  const msById = new Map<number, number>();
  const textById = new Map<number, string>();
  const metricsById = new Map<number, SentenceMetrics>();

  for (const span of spans) {
    const attr = span.getAttribute(ID_ATTR);
    const id = attr === null ? NaN : Number(attr);
    if (Number.isNaN(id)) continue;

    const list = byId.get(id);
    if (list) {
      list.push(span);
      textById.set(id, `${textById.get(id) ?? ''}${span.textContent ?? ''}`);
    } else {
      byId.set(id, [span]);
      indexById.set(id, orderedIds.length);
      orderedIds.push(id);
      textById.set(id, span.textContent ?? '');
    }
  }

  for (const [id, text] of textById) {
    msById.set(id, estimateReadingMs(text));
  }

  for (const [id, list] of byId) {
    const words = list.flatMap((span) => Array.from(span.querySelectorAll<HTMLElement>('.jri-word')));
    const totalWeight = words.reduce((sum, word) => sum + wordWeight(word), 0);
    let consumed = 0;
    const wordStarts = words.map((word) => {
      const start = totalWeight === 0 ? 0 : consumed / totalWeight;
      consumed += wordWeight(word);
      return start;
    });
    metricsById.set(id, {
      words,
      wordStarts,
    });
  }
  const total = byId.size;
  let totalMs = 0;
  for (const ms of msById.values()) totalMs += ms;

  const readIds = new Set((initial?.readIds ?? []).filter((id) => byId.has(id)));
  const progressById = new Map<number, number>();
  let currentId: number | null = initial?.currentId ?? null;
  if (currentId !== null && !byId.has(currentId)) currentId = null;
  if (currentId !== null) readIds.delete(currentId);
  let unreadCount = total - readIds.size;
  let readMs = 0;
  for (const id of readIds) readMs += msById.get(id) ?? 0;

  function markReadId(id: number): void {
    if (!readIds.has(id)) {
      readMs += msById.get(id) ?? 0;
      readIds.add(id);
      unreadCount--;
    }
    progressById.set(id, 1);
  }

  function unmarkReadId(id: number): void {
    if (!readIds.delete(id)) return;
    readMs -= msById.get(id) ?? 0;
    unreadCount++;
    progressById.set(id, 0);
  }

  let wordFocus = false;
  // The reader sets the initial mode explicitly after creating the session.
  let lightsOutEnabled = options.lightsOut ?? false;
  let lightsOutImmediate = false;
  let guidedMode = options.guidedMode ?? false;
  let currentWord: HTMLElement | null = null;
  let destroyed = false;

  function render(id: number): void {
    const list = byId.get(id);
    if (!list) return;
    const isCurrent = id === currentId;
    const isRead = readIds.has(id);
    const shouldDim = lightsOutEnabled && !isCurrent && (lightsOutImmediate || (guidedMode && readIds.size > 1));
    const metrics = metricsById.get(id);
    if (!metrics) return;
    const { words } = metrics;
    const { wordStarts } = metrics;

    function renderCurrentWord(progress: number): void {
      let nextWord: HTMLElement | null = null;
      if ((wordFocus || (currentWord !== null && words.includes(currentWord))) && words.length > 0) {
        const currentIndex = wordStarts.findIndex((_, i) => i === wordStarts.length - 1 || wordStarts[i + 1]! > progress);
        nextWord = words[currentIndex] ?? words[words.length - 1]!;
      }
      if (nextWord !== currentWord) {
        currentWord?.classList.remove(CURRENT_WORD_CLASS);
        nextWord?.classList.add(CURRENT_WORD_CLASS);
        currentWord = nextWord;
      }
    }

    if (isRead) {
      if (currentWord && words.includes(currentWord)) {
        currentWord.classList.remove(CURRENT_WORD_CLASS);
        currentWord = null;
      }
      for (const span of list) {
        span.classList.remove(CURRENT_CLASS);
        span.classList.add(READ_CLASS);
        span.classList.toggle(DIMMED_CLASS, shouldDim);
      }
      return;
    }

    if (isCurrent) {
      const progress = progressById.get(id) ?? 0;
      renderCurrentWord(progress);
      list.forEach((span) => {
        span.classList.remove(READ_CLASS);
        span.classList.add(CURRENT_CLASS);
        span.classList.toggle(DIMMED_CLASS, shouldDim);
      });
      return;
    }

    if (currentWord && words.includes(currentWord)) {
      currentWord.classList.remove(CURRENT_WORD_CLASS);
      currentWord = null;
    }
    for (const span of list) {
      span.classList.remove(CURRENT_CLASS, READ_CLASS);
      span.classList.toggle(DIMMED_CLASS, shouldDim);
    }
  }

  function renderAll(): void {
    for (const id of byId.keys()) render(id);
  }

  function setLightsOut(on: boolean, immediate = false): void {
    lightsOutEnabled = on;
    lightsOutImmediate = on && immediate;
    renderAll();
  }

  async function setLightsOutAsync(on: boolean, immediate = false): Promise<void> {
    lightsOutEnabled = on;
    lightsOutImmediate = on && immediate;
    const ids = Array.from(byId.keys());
    for (let start = 0; start < ids.length; start += 48) {
      if (destroyed) return;
      const end = Math.min(ids.length, start + 48);
      for (let i = start; i < end; i++) render(ids[i]!);
      if (end < ids.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  function setGuidedMode(on: boolean): void {
    guidedMode = on;
    lightsOutImmediate = false;
    renderAll();
  }

  function wordStarts(id: number): number[] {
    return metricsById.get(id)?.wordStarts ?? [];
  }

  function wordsFor(id: number): HTMLElement[] {
    return metricsById.get(id)?.words ?? [];
  }

  function setProgressInternal(ratio: number): void {
    if (currentId === null) return;
    const id = currentId;
    const p = clamp(ratio, 0, 1);
    progressById.set(id, p);
    render(id);
  }

  renderAll();

  function dispose(): void {
    destroyed = true;
    currentId = null;
    readIds.clear();
    progressById.clear();
    wordFocus = false;
    currentWord = null;
  }

  function setCurrentInternal(id: number, fresh: boolean): void {
    if (!byId.has(id)) return;
    if (readIds.has(id)) {
      unmarkReadId(id);
      progressById.set(id, 0);
    } else if (fresh) {
      progressById.set(id, 0);
    }
    currentId = id;
    render(id);
  }

  return {
    setCurrent(id, opts) {
      if (!byId.has(id)) return;
      const fresh = opts?.fresh ?? false;
      const force = opts?.force ?? false;
      if (readIds.has(id) && !force) return;
      if (id === currentId && !fresh) return;
      const prev = currentId;
      setCurrentInternal(id, fresh);
      if (prev !== null && prev !== id) render(prev);
    },
    markRead(id) {
      if (!byId.has(id)) return;
      if (id === currentId) {
        currentId = null;
      }
      markReadId(id);
      renderAll();
    },
    unmarkRead(id) {
      if (!byId.has(id) || !readIds.has(id)) return;
      unmarkReadId(id);
      setCurrentInternal(id, true);
      renderAll();
    },
    markPreviousRead() {
      if (currentId === null) return;
      for (const id of byId.keys()) {
        if (id >= currentId) break;
        markReadId(id);
      }
      renderAll();
    },
    async markAllReadAsync() {
      const ids = Array.from(byId.keys());
      for (let start = 0; start < ids.length; start += 48) {
        if (destroyed) return;
        const end = Math.min(ids.length, start + 48);
        for (let i = start; i < end; i++) {
          const id = ids[i]!;
          markReadId(id);
          render(id);
        }
        if (end < ids.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (destroyed) return;
      currentId = null;
      renderAll();
    },
    setProgress(ratio) {
      if (currentId === null) return;
      setProgressInternal(ratio);
    },
    setWordFocusAt(index) {
      if (!wordFocus || currentId === null) return;
      const words = wordsFor(currentId);
      const nextWord = words[index];
      if (!nextWord || nextWord === currentWord) return;
      currentWord?.classList.remove(CURRENT_WORD_CLASS);
      nextWord.classList.add(CURRENT_WORD_CLASS);
      currentWord = nextWord;
    },
    tick(dtMs) {
      if (currentId === null) return { completed: false };
      const id = currentId;
      const ms = msById.get(id) ?? 3000;
      const p = progressById.get(id) ?? 0;
      const nextP = clamp(p + dtMs / ms, 0, 1);
      progressById.set(id, nextP);
      render(id);
      if (nextP >= 1) {
        currentId = null;
        markReadId(id);
        render(id);
        if (lightsOutEnabled && guidedMode) renderAll();
        return { completed: true };
      }
      return { completed: false };
    },
    moveNext() {
      const old = currentId;
      if (old !== null) markReadId(old);
      if (unreadCount === 0) {
        if (old !== null) {
          currentId = null;
          render(old);
        }
        return null;
      }
      const startIdx = old === null ? -1 : (indexById.get(old) ?? -1);
      for (let i = startIdx + 1; i < orderedIds.length; i++) {
        const candidate = orderedIds[i]!;
        if (readIds.has(candidate)) continue;
        setCurrentInternal(candidate, true);
        if (old !== null) render(old);
        return candidate;
      }
      return old;
    },
    advance() {
      const old = currentId;
      if (old !== null) markReadId(old);
      if (unreadCount === 0) {
        currentId = null;
        if (old !== null) render(old);
        return null;
      }
      const startIdx = old === null ? -1 : (indexById.get(old) ?? -1);
      let nextId: number | null = null;
      for (let i = startIdx + 1; i < orderedIds.length; i++) {
        const candidate = orderedIds[i]!;
        if (!readIds.has(candidate)) {
          nextId = candidate;
          break;
        }
      }
      if (nextId === null) {
        currentId = null;
        if (old !== null) render(old);
        return null;
      }
      setCurrentInternal(nextId, true);
      if (old !== null) render(old);
      return nextId;
    },
    prev() {
      if (currentId === null) return null;
      const idx = indexById.get(currentId) ?? -1;
      if (idx <= 0) return currentId;
      const old = currentId;
      const prevId = orderedIds[idx - 1]!;
      unmarkReadId(prevId);
      setCurrentInternal(prevId, true);
      render(old);
      return prevId;
    },
    nextWord() {
      if (!wordFocus || currentId === null) return false;
      const starts = wordStarts(currentId);
      const words = wordsFor(currentId);
      const progress = progressById.get(currentId) ?? 0;
      if (starts.length > 0) {
        const focusedIndex = words.findIndex((word) => word.classList.contains(CURRENT_WORD_CLASS));
        let currentIndex = focusedIndex;
        if (currentIndex < 0) {
          currentIndex = 0;
          for (let i = 1; i < starts.length; i++) {
            if (starts[i]! <= progress + 0.0001) currentIndex = i;
            else break;
          }
        }
        if (currentIndex === starts.length - 1) {
          return this.moveNext() !== null;
        }
        setProgressInternal(Math.min(0.999999, starts[currentIndex + 1]! + 0.0001));
        return true;
      }
      return false;
    },
    prevWord() {
      if (!wordFocus || currentId === null) return false;
      const starts = wordStarts(currentId);
      const progress = progressById.get(currentId) ?? 0;
      if (starts.length === 0) return false;
      let currentIndex = 0;
      for (let i = 1; i < starts.length; i++) {
        if (starts[i]! <= progress + 0.0001) currentIndex = i;
        else break;
      }
      if (currentIndex === 0) {
        const previousId = this.prev();
        if (previousId === null) return false;
        const previousStarts = wordStarts(previousId);
        const lastStart = previousStarts[previousStarts.length - 1] ?? 0;
        setProgressInternal(Math.min(0.999999, lastStart + 0.0001));
        return true;
      }
      setProgressInternal(starts[Math.max(0, currentIndex - 1)] ?? 0);
      return true;
    },
    nextUnreadAfter(id) {
      const startIdx = id === null ? -1 : (indexById.get(id) ?? -1);
      for (let i = startIdx + 1; i < orderedIds.length; i++) {
        const candidate = orderedIds[i]!;
        if (!readIds.has(candidate)) return candidate;
      }
      return null;
    },
    setWordFocus(on) {
      wordFocus = on;
      if (currentId !== null) render(currentId);
    },
    setLightsOut,
    setLightsOutAsync,
    setGuidedMode,
    getCurrentId() {
      return currentId;
    },
    isRead(id) {
      return readIds.has(id);
    },
    getSpans(id) {
      return byId.get(id) ?? [];
    },
    isAnimating() {
      return currentId !== null && (progressById.get(currentId) ?? 0) < 1;
    },
    getStats() {
      return {
        total,
        readCount: readIds.size,
        currentId,
        unreadMs: totalMs - readMs,
      };
    },
    getSpeechTiming() {
      const currentMs = currentId === null ? 0 : (msById.get(currentId) ?? 0);
      const currentProgress = currentId === null ? 0 : (progressById.get(currentId) ?? 0);
      return { durationMs: totalMs, positionMs: readMs + currentMs * currentProgress };
    },
    getSnapshot() {
      return {
        total,
        currentId,
        readIds: new Set(readIds),
      };
    },
    toPageState(url, title, timeSpentMs, dailyTimeSpentMs, metadata) {
      return {
        url,
        ...(title ? { title } : {}),
        ...(timeSpentMs ? { timeSpentMs } : {}),
        estimatedUnreadMs: totalMs - readMs,
        ...(dailyTimeSpentMs ? { dailyTimeSpentMs } : {}),
        ...metadata,
        total,
        readRanges: readIdsToRanges(Array.from(readIds), total),
        currentId,
        updatedAt: Date.now(),
      };
    },
    dispose,
    destroy() {
      for (const [id, list] of byId) {
        for (const word of metricsById.get(id)?.words ?? []) {
          word.classList.remove(CURRENT_WORD_CLASS);
        }
        for (const span of list) {
          span.classList.remove(CURRENT_CLASS, READ_CLASS);
          span.classList.remove(DIMMED_CLASS);
        }
      }
      dispose();
    },
  };
}
