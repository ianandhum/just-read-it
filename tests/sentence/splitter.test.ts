import { describe, it, expect } from 'vitest';
import { splitSentences } from '../../lib/sentence/splitter';

function sentences(text: string): string[] {
  return splitSentences(text).map((r) => text.slice(r.start, r.end));
}

describe('splitSentences', () => {
  it('returns empty for empty input', () => {
    expect(splitSentences('')).toEqual([]);
  });

  it('returns empty for whitespace-only input', () => {
    expect(splitSentences('   \n\t  ')).toEqual([]);
  });

  it('returns the whole string for a single sentence', () => {
    expect(sentences('Hello world.')).toEqual(['Hello world.']);
  });

  it('splits on period followed by whitespace', () => {
    expect(sentences('First one. Second two.')).toEqual(['First one.', 'Second two.']);
  });

  it('splits on ! and ?', () => {
    expect(sentences('What now? Go! Leave.')).toEqual(['What now?', 'Go!', 'Leave.']);
  });

  it('keeps closing quotes and brackets with the preceding sentence', () => {
    expect(sentences('He said "Stop." Next sentence.')).toEqual(['He said "Stop."', 'Next sentence.']);
    expect(sentences('Is this right?] Yes.')).toEqual(['Is this right?]', 'Yes.']);
  });

  it('handles Unicode whitespace', () => {
    expect(sentences('First sentence.\u00a0Second sentence.')).toEqual(['First sentence.', 'Second sentence.']);
  });

  it('handles Unicode sentence terminators', () => {
    expect(sentences('最初の文です。次の文です！最後です？')).toEqual(['最初の文です。', '次の文です！', '最後です？']);
  });

  it('handles initials and acronyms without splitting them apart', () => {
    expect(sentences('J. R. R. Tolkien wrote The Hobbit. The U.S.A. is large.')).toEqual([
      'J. R. R. Tolkien wrote The Hobbit.',
      'The U.S.A. is large.',
    ]);
  });

  it('requires whitespace after the terminator', () => {
    // "example.com" — dot not followed by whitespace, so not a boundary.
    expect(sentences('Visit example.com today.')).toEqual(['Visit example.com today.']);
  });

  it('treats end-of-string as a valid boundary', () => {
    expect(sentences('One. Two')).toEqual(['One.', 'Two']);
  });

  it('collapses whitespace between sentences into the gap', () => {
    const text = 'A.   B.';
    const ranges = splitSentences(text);
    expect(ranges).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ]);
    expect(text.slice(ranges[0]!.start, ranges[0]!.end)).toBe('A.');
    expect(text.slice(ranges[1]!.start, ranges[1]!.end)).toBe('B.');
  });

  it('preserves trailing fragment without terminator', () => {
    expect(sentences('Done. Still going here')).toEqual(['Done.', 'Still going here']);
  });

  describe('clause punctuation', () => {
    it('splits at semicolons without using a fixed text length', () => {
      expect(sentences('The pale Usher—threadbare in coat, heart, body, and brain; I see him now.')).toEqual([
        'The pale Usher—threadbare in coat, heart, body, and brain;',
        'I see him now.',
      ]);
    });

    it('does not split at commas', () => {
      expect(sentences('First, do this, then stop.')).toEqual(['First, do this, then stop.']);
    });

    it('splits long sentences at commas', () => {
      expect(
        sentences(
          'The reader keeps a long sentence together until it becomes difficult to follow in a focused reading view, then it can use the comma as a natural pause, so each resulting chunk remains comfortable to read without losing the original prose.',
        ),
      ).toEqual([
        'The reader keeps a long sentence together until it becomes difficult to follow in a focused reading view,',
        'then it can use the comma as a natural pause,',
        'so each resulting chunk remains comfortable to read without losing the original prose.',
      ]);
    });

    it('keeps each ordinary sentence intact in the reported paragraph', () => {
      expect(
        sentences(
          'The pale Usher—threadbare in coat, heart, body, and brain; I see him now. He was ever dusting his old lexicons and grammars, with a queer handkerchief, mockingly embellished with all the gay flags of all the known nations of the world. He loved to dust his old grammars; it somehow mildly reminded him of his mortality.',
        ),
      ).toEqual([
        'The pale Usher—threadbare in coat, heart, body, and brain;',
        'I see him now.',
        'He was ever dusting his old lexicons and grammars, with a queer handkerchief, mockingly embellished with all the gay flags of all the known nations of the world.',
        'He loved to dust his old grammars;',
        'it somehow mildly reminded him of his mortality.',
      ]);
    });

    it('does not treat source-formatting line breaks as sentence boundaries', () => {
      expect(
        sentences(`The pale Usher—threadbare in coat, heart, body, and brain; I see
him now. He was ever dusting his old lexicons and grammars, with a queer
handkerchief, mockingly embellished with all the gay flags of all the
known nations of the world. He loved to dust his old grammars; it
somehow mildly reminded him of his mortality.`),
      ).toEqual([
        'The pale Usher—threadbare in coat, heart, body, and brain;',
        'I see\nhim now.',
        'He was ever dusting his old lexicons and grammars, with a queer\nhandkerchief, mockingly embellished with all the gay flags of all the\nknown nations of the world.',
        'He loved to dust his old grammars;',
        'it\nsomehow mildly reminded him of his mortality.',
      ]);
    });
  });

  describe('decimals', () => {
    it('does not split on a decimal point', () => {
      expect(sentences('The value is 3.14 today.')).toEqual(['The value is 3.14 today.']);
    });
    it('does not split between two numbers separated by a dot', () => {
      expect(sentences('See section 4.5 for details.')).toEqual(['See section 4.5 for details.']);
    });
  });

  describe('ellipsis', () => {
    it('splits after an ellipsis followed by whitespace', () => {
      expect(sentences('Wait... then go.')).toEqual(['Wait...', 'then go.']);
    });
    it('splits after an ellipsis followed by whitespace and capital', () => {
      expect(sentences('Wait... Then go.')).toEqual(['Wait...', 'Then go.']);
    });
    it('keeps an ellipsis without trailing whitespace inside a sentence', () => {
      expect(sentences('Wait...then go.')).toEqual(['Wait...then go.']);
    });
    it('treats a trailing ellipsis at end of string as terminal', () => {
      expect(sentences('He paused...')).toEqual(['He paused...']);
    });
  });

  describe('abbreviations', () => {
    it('does not split after Mr.', () => {
      expect(sentences('Mr. Smith went home. The end.')).toEqual(['Mr. Smith went home.', 'The end.']);
    });

    it('does not split after Dr.', () => {
      expect(sentences('Dr. Watson arrived. He looked tired.')).toEqual(['Dr. Watson arrived.', 'He looked tired.']);
    });

    it('does not split after vs.', () => {
      expect(sentences('Cats vs. dogs. A classic.')).toEqual(['Cats vs. dogs.', 'A classic.']);
    });

    it('does not split after etc.', () => {
      expect(sentences('Apples, oranges, etc. are fruits.')).toEqual(['Apples, oranges, etc. are fruits.']);
    });

    it('handles e.g. with multiple dots', () => {
      expect(sentences('Some fruits, e.g. apples, are red. Others are not.')).toEqual([
        'Some fruits, e.g. apples, are red.',
        'Others are not.',
      ]);
    });

    it('handles i.e. with multiple dots', () => {
      expect(sentences('A dog, i.e. a canine. It barks.')).toEqual(['A dog, i.e. a canine.', 'It barks.']);
    });

    it('does not split after St. (saint)', () => {
      expect(sentences('St. Louis is a city. It is warm.')).toEqual(['St. Louis is a city.', 'It is warm.']);
    });

    it('still splits when a period follows a non-abbreviation word ending in the same letters', () => {
      // "Mr" must be a standalone token, not a suffix match.
      expect(sentences('Sister. Brother.')).toEqual(['Sister.', 'Brother.']);
    });
  });

  describe('multi-paragraph', () => {
    it('handles newlines as whitespace', () => {
      expect(sentences('First paragraph.\n\nSecond paragraph.')).toEqual(['First paragraph.', 'Second paragraph.']);
    });
  });
});
