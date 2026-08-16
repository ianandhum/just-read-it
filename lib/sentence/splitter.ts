export interface SentenceRange {
  start: number;
  end: number;
}

const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'approx',
  'no',
  'fig',
  'vol',
  'pp',
  'ca',
  'eg',
  'ie',
  'us',
  'uk',
]);

const CLOSERS = new Set(['"', "'", ')', ']', '}', '»', '”', '’']);
const TERMINATORS = new Set(['.', '!', '?', '。', '！', '？', '…']);
const CLAUSE_TERMINATORS = new Set([';', ':', '—', '–']);
const LONG_SENTENCE_LENGTH = 180;

function nativeSentenceRanges(text: string): SentenceRange[] | null {
  if (typeof Intl.Segmenter !== 'function') return null;

  const ranges: SentenceRange[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  for (const { index, segment } of segmenter.segment(text)) {
    let start = index;
    let end = index + segment.length;
    while (start < end && isWhitespace(text[start])) start++;
    while (end > start && isWhitespace(text[end - 1])) end--;
    if (start < end) ranges.push({ start, end });
  }
  if (
    ranges.some(({ start, end }) => {
      const segment = text.slice(start, end);
      const last = segment.at(-1);
      let index = segment.length - 1;
      while (index >= 0 && CLOSERS.has(segment[index] ?? '')) index--;
      return (
        !TERMINATORS.has(segment[index] ?? '') ||
        /(?:\b\p{L}|\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|approx|no|fig|vol|pp|ca|eg|ie|us|uk))\.$/iu.test(segment) ||
        (last !== undefined && !TERMINATORS.has(last) && !CLOSERS.has(last))
      );
    }) ||
    /\.\.\.\s+\p{L}/u.test(text)
  ) {
    return null;
  }
  return ranges;
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && /^\p{L}$/u.test(ch);
}

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/u.test(ch);
}

function precedingWord(text: string, dotIndex: number): string | null {
  let i = dotIndex - 1;
  let sawDot = false;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '.') {
      sawDot = true;
      i--;
      continue;
    }
    if (isLetter(ch)) {
      i--;
      continue;
    }
    break;
  }
  if (i === dotIndex - 1) return null;
  const raw = text.slice(i + 1, dotIndex).replace(/\./g, '');
  if (raw.length === 0 || (!/[a-z]/i.test(raw) && !sawDot)) return null;
  return raw.toLowerCase();
}

function isInitialOrAcronym(text: string, dotIndex: number): boolean {
  const tokenStart = text.lastIndexOf(' ', dotIndex) + 1;
  const token = text.slice(tokenStart, dotIndex + 1);
  if (/^(?:\p{Lu}\.){2,}$/u.test(token)) return true;
  if (!/^\p{Lu}\.$/u.test(token)) return false;

  const before = text.slice(0, dotIndex + 1);
  const after = text.slice(dotIndex + 1);
  return /(?:^|\s)(?:\p{Lu}\.\s+)+\p{Lu}\.$/u.test(before) || /^\s+(?:\p{Lu}\.\s+)+\p{Lu}\p{L}/u.test(after);
}

function splitClauseRanges(text: string, ranges: SentenceRange[]): SentenceRange[] {
  const result: SentenceRange[] = [];

  for (const range of ranges) {
    let start = range.start;
    const splitLongSentenceAtCommas = range.end - range.start > LONG_SENTENCE_LENGTH;
    for (let index = range.start; index < range.end - 1; index++) {
      const ch = text[index] ?? '';
      const isClauseTerminator = CLAUSE_TERMINATORS.has(ch);
      const isLongSentenceComma = splitLongSentenceAtCommas && ch === ',';
      if ((!isClauseTerminator && !isLongSentenceComma) || !isWhitespace(text[index + 1])) continue;
      const end = index + 1;
      result.push({ start, end });
      start = end + 1;
      while (start < range.end && isWhitespace(text[start])) start++;
    }
    if (start < range.end) result.push({ start, end: range.end });
  }

  return result;
}

export function splitSentences(text: string): SentenceRange[] {
  const nativeRanges = nativeSentenceRanges(text);
  if (nativeRanges !== null) return splitClauseRanges(text, nativeRanges);

  const ranges: SentenceRange[] = [];
  const n = text.length;
  if (n === 0) return ranges;

  let start = 0;
  while (start < n && isWhitespace(text[start])) start++;
  if (start === n) return ranges;

  let i = start;

  while (i < n) {
    const ch = text[i];

    if (ch !== undefined && TERMINATORS.has(ch)) {
      if (ch === '.' && text[i + 1] === '.') {
        i++;
        continue;
      }

      if (ch === '.' && isDigit(text[i - 1]) && isDigit(text[i + 1])) {
        i++;
        continue;
      }

      if (ch === '.') {
        const word = precedingWord(text, i);
        if (isInitialOrAcronym(text, i) || (word !== null && ABBREVIATIONS.has(word))) {
          i++;
          continue;
        }
      }

      let terminalEnd = i + 1;
      while (CLOSERS.has(text[terminalEnd] ?? '')) terminalEnd++;
      const next = text[terminalEnd];
      if (next !== undefined && !isWhitespace(next)) {
        i++;
        continue;
      }

      const end = terminalEnd;
      ranges.push({ start, end });

      i = end;
      while (i < n && isWhitespace(text[i])) i++;
      start = i;
      continue;
    }

    i++;
  }

  if (start < n) {
    ranges.push({ start, end: n });
  }

  return splitClauseRanges(text, ranges);
}
