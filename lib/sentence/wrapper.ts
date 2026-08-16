import { collectBlocks, collectTextNodes, scopeContent } from './content_parser';
import { splitSentences } from './splitter';

export const SENTENCE_CLASS = 'jri-sentence';
export const SENTENCE_ATTR = 'data-jri-id';
export const WORD_CLASS = 'jri-word';

export interface WrapResult {
  total: number;
  spans: HTMLSpanElement[];
  unwrap: () => void;
  unwrapAsync: (onProgress?: (processed: number, total: number) => void) => Promise<void>;
}

export interface AsyncWrapOptions {
  batchSize?: number;
  isCancelled?: () => boolean;
  onProgress?: (processed: number, total: number) => void;
  contentCandidate?: string;
}

interface TextNodeSlice {
  node: Text;
  start: number;
  end: number;
}

function wrapWords(span: HTMLSpanElement, doc: Document): void {
  const text = span.firstChild;
  if (!(text instanceof Text)) return;
  const parts = text.nodeValue?.split(/(\s+)/u) ?? [];
  const fragment = doc.createDocumentFragment();
  for (const part of parts) {
    if (!part) continue;
    if (/^\s+$/u.test(part)) {
      fragment.appendChild(doc.createTextNode(part));
      continue;
    }
    let wordUnits = [part];
    if (part.length > 15) {
      // Keep a trailing hyphen and : with its leading segment so compound words remain readable in RSVP.
      wordUnits = part.split(/(?<=[\p{L}\p{N}])(?=[-‐‑‒–—:][\p{L}\p{N}])/u);
    }

    for (const wordUnit of wordUnits) {
      const word = doc.createElement('span');
      word.className = WORD_CLASS;
      word.textContent = wordUnit;
      fragment.appendChild(word);
    }
  }
  span.replaceChildren(fragment);
}

const TEXT_BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DIV',
  'DL',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TD',
  'TH',
  'TR',
  'UL',
]);

function blockAncestor(node: Text): Element | null {
  let parent = node.parentElement;
  while (parent) {
    if (TEXT_BLOCK_TAGS.has(parent.tagName)) return parent;
    parent = parent.parentElement;
  }
  return null;
}

function buildBlockText(nodes: Text[]): { text: string; slices: TextNodeSlice[] } {
  let text = '';
  const slices: TextNodeSlice[] = [];
  for (const node of nodes) {
    const value = node.nodeValue ?? '';
    if (value.length === 0) continue;
    const previous = slices[slices.length - 1]?.node;
    // Preserve nested block boundaries that have no literal separator.
    if (previous && blockAncestor(previous) !== blockAncestor(node)) text += '\n';
    const start = text.length;
    text += value;
    slices.push({ node, start, end: text.length });
  }
  return { text, slices };
}

function wrapInPlace(fragment: Text, doc: Document, id: number, spansOut: HTMLSpanElement[]): HTMLSpanElement | null {
  const parent = fragment.parentNode;
  if (!parent) return null;
  const span = doc.createElement('span');
  span.className = SENTENCE_CLASS;
  span.setAttribute(SENTENCE_ATTR, String(id));
  parent.insertBefore(span, fragment);
  span.appendChild(fragment);
  wrapWords(span, doc);
  spansOut.push(span);
  return span;
}

function wrapBlock(block: Element, doc: Document, nextId: () => number, spansOut: HTMLSpanElement[]): number {
  const textNodes = collectTextNodes(block);
  if (textNodes.length === 0) return 0;

  const { text, slices } = buildBlockText(textNodes);
  if (text.length === 0 || slices.length === 0) return 0;

  const ranges = splitSentences(text);
  if (ranges.length === 0) return 0;

  let count = 0;
  let sliceIdx = 0;

  for (const range of ranges) {
    while (sliceIdx < slices.length && slices[sliceIdx]!.end <= range.start) {
      sliceIdx++;
    }
    if (sliceIdx >= slices.length) break;

    const id = nextId();
    let i = sliceIdx;
    let wrappedAny = false;

    while (i < slices.length && slices[i]!.start < range.end) {
      const slice = slices[i]!;

      if (slice.start < range.start) {
        const offset = range.start - slice.start;
        const tail = slice.node.splitText(offset);
        slice.node = tail;
        slice.start = range.start;
      }

      if (slice.end > range.end) {
        const offset = range.end - slice.start;
        const tail = slice.node.splitText(offset);
        slices.splice(i + 1, 0, { node: tail, start: range.end, end: slice.end });
        slice.end = range.end;
        wrapInPlace(slice.node, doc, id, spansOut);
        wrappedAny = true;
        i++;
        break;
      }

      wrapInPlace(slice.node, doc, id, spansOut);
      wrappedAny = true;
      i++;
    }

    sliceIdx = i;

    if (wrappedAny) count++;
  }

  return count;
}

function unwrapSpan(span: Element): Element | null {
  const parent = span.parentNode;
  if (!(parent instanceof Element)) return null;
  for (const word of Array.from(span.querySelectorAll(`span.${WORD_CLASS}`))) {
    unwrapSpan(word);
  }
  while (span.firstChild) {
    parent.insertBefore(span.firstChild, span);
  }
  parent.removeChild(span);
  return parent;
}

function normalizeParents(parents: Iterable<Element>): void {
  const uniqueParents = Array.from(new Set(parents));
  const parentSet = new Set(uniqueParents);
  for (const parent of uniqueParents) {
    let ancestor = parent.parentElement;
    while (ancestor && !parentSet.has(ancestor)) ancestor = ancestor.parentElement;
    if (!ancestor) parent.normalize();
  }
}

function unwrapSpans(spans: Iterable<Element>): void {
  const parents = new Set<Element>();
  for (const span of spans) {
    const parent = unwrapSpan(span);
    if (parent) parents.add(parent);
  }
  normalizeParents(parents);
}

function unwrapAll(root: Element): void {
  const existing = Array.from(root.querySelectorAll(`span.${SENTENCE_CLASS}[${SENTENCE_ATTR}]`));
  unwrapSpans(existing);
}

export function wrapSentences(doc: Document = document): WrapResult {
  const root = scopeContent(doc);
  unwrapAll(root);

  const blocks = collectBlocks(root);
  const spans: HTMLSpanElement[] = [];
  let counter = 0;
  const nextId = (): number => counter++;

  for (const block of blocks) {
    wrapBlock(block, doc, nextId, spans);
  }

  const captured = spans.slice();
  return {
    total: spans.length === 0 ? 0 : counter,
    spans,
    unwrap: () => {
      unwrapSpans(captured);
    },
    unwrapAsync: (onProgress) => unwrapSpansAsync(captured, onProgress),
  };
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function unwrapSpansAsync(spans: HTMLSpanElement[], onProgress?: (processed: number, total: number) => void): Promise<void> {
  const parents = new Set<Element>();
  for (let start = 0; start < spans.length; start += 96) {
    const end = Math.min(spans.length, start + 96);
    for (let i = start; i < end; i++) {
      const parent = unwrapSpan(spans[i]!);
      if (parent) parents.add(parent);
    }
    onProgress?.(end, spans.length);
    if (end < spans.length) await yieldToBrowser();
  }
  normalizeParents(parents);
}

/** Wrap blocks in batches so large documents do not monopolize the main thread. */
export async function wrapSentencesAsync(doc: Document = document, options: AsyncWrapOptions = {}): Promise<WrapResult | null> {
  const root = scopeContent(doc, options.contentCandidate);
  unwrapAll(root);

  const blocks = collectBlocks(root);
  const spans: HTMLSpanElement[] = [];
  const batchSize = Math.max(1, options.batchSize ?? 24);
  let counter = 0;
  const nextId = (): number => counter++;

  for (let start = 0; start < blocks.length; start += batchSize) {
    if (options.isCancelled?.()) {
      for (const span of spans) unwrapSpan(span);
      return null;
    }
    const end = Math.min(blocks.length, start + batchSize);
    for (let i = start; i < end; i++) {
      wrapBlock(blocks[i]!, doc, nextId, spans);
    }
    options.onProgress?.(end, blocks.length);
    if (end < blocks.length) await yieldToBrowser();
  }

  if (options.isCancelled?.()) {
    for (const span of spans) unwrapSpan(span);
    return null;
  }

  const captured = spans.slice();
  return {
    total: spans.length === 0 ? 0 : counter,
    spans,
    unwrap: () => {
      unwrapSpans(captured);
    },
    unwrapAsync: (onProgress) => unwrapSpansAsync(captured, onProgress),
  };
}
