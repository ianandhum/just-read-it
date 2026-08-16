export const SENTENCE_SELECTOR = '.jri-sentence';
export const ID_ATTR = 'data-jri-id';
export const HOVER_CLASS = 'jri-hover';

const READ_COVERED = 0.2;
const READ_END = 0.9;

// Mouse-driven read, automatically marks a sentence as read when
// the user spends X% of time hovering over and reached the Y% of the end
export function shouldMarkReadByMouse(coverage: number, ratio: number): boolean {
  return coverage > READ_COVERED && ratio > READ_END;
}

export function idFromTarget(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const span = target.closest(SENTENCE_SELECTOR);
  if (!span) return null;
  const attr = span.getAttribute(ID_ATTR);
  if (attr === null) return null;
  const id = Number(attr);
  return Number.isNaN(id) ? null : id;
}

export function pointerToProgress(spans: HTMLSpanElement[], lengths: number[], totalChars: number, x: number, y: number): number | null {
  if (spans.length === 0) return null;
  const doc = spans[0]!.ownerDocument ?? document;
  const anyDoc = doc as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => { startContainer: Node; startOffset: number } | null;
  };

  let node: Node | null = null;
  let offset = 0;
  if (typeof anyDoc.caretPositionFromPoint === 'function') {
    const pos = anyDoc.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  } else if (typeof anyDoc.caretRangeFromPoint === 'function') {
    const r = anyDoc.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }

  if (node && node.nodeType === Node.TEXT_NODE && totalChars > 0) {
    let running = 0;
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]!;
      const li = lengths[i]!;
      if (span.contains(node)) {
        let localOffset = 0;
        const walker = doc.createTreeWalker(span, NodeFilter.SHOW_TEXT, {
          acceptNode(n: Text): number {
            return n.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          },
        });
        let cur = walker.nextNode() as Text | null;
        while (cur) {
          if (cur === node) {
            localOffset += offset;
            break;
          }
          localOffset += cur.nodeValue?.length ?? 0;
          cur = walker.nextNode() as Text | null;
        }
        const charOffset = running + localOffset;
        return Math.max(0, Math.min(1, charOffset / totalChars));
      }
      running += li;
    }
  }

  let left = Infinity;
  let right = -Infinity;
  for (const span of spans) {
    const r = span.getBoundingClientRect();
    if (r.left < left) left = r.left;
    if (r.right > right) right = r.right;
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) {
    return null;
  }
  return Math.max(0, Math.min(1, (x - left) / (right - left)));
}
