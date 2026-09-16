import { describe, it, expect, beforeEach } from 'vitest';
import { wrapSentences, wrapSentencesAsync, SENTENCE_CLASS, SENTENCE_ATTR } from '../../lib/sentence/wrapper';
import { getContentCandidates, scopeContent } from '../../lib/sentence/content_parser';

function setupDoc(html: string): Document {
  const doc = document.implementation.createHTMLDocument('test');
  doc.body.innerHTML = html;
  return doc;
}

function sentenceTexts(doc: Document): string[] {
  const spans = Array.from(doc.querySelectorAll(`span.${SENTENCE_CLASS}[${SENTENCE_ATTR}]`));
  const byId = new Map<number, string>();
  for (const s of spans) {
    const id = Number(s.getAttribute(SENTENCE_ATTR));
    byId.set(id, (byId.get(id) ?? '') + (s.textContent ?? ''));
  }
  return Array.from(byId.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, text]) => text);
}

function ids(doc: Document): number[] {
  const seen = new Set<number>();
  for (const s of doc.querySelectorAll(`span.${SENTENCE_CLASS}[${SENTENCE_ATTR}]`)) {
    seen.add(Number(s.getAttribute(SENTENCE_ATTR)));
  }
  return Array.from(seen).sort((a, b) => a - b);
}

describe('wrapSentences', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns 0 for empty document', () => {
    const doc = setupDoc('');
    const result = wrapSentences(doc);
    expect(result.total).toBe(0);
    expect(result.spans).toEqual([]);
  });

  it('wraps a single-sentence paragraph', () => {
    const doc = setupDoc('<p>Hello world.</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['Hello world.']);
    expect(ids(doc)).toEqual([0]);
  });

  it('async wrapping keeps readable documents with three sentences', async () => {
    const doc = setupDoc('<p>One. Two. Three.</p>');
    const result = await wrapSentencesAsync(doc);

    expect(result?.total).toBe(3);
    expect(sentenceTexts(doc)).toEqual(['One.', 'Two.', 'Three.']);
    result?.unwrap();
  });

  it('wraps sentence words without wrapping whitespace', () => {
    const doc = setupDoc('<p>Hello world.</p>');
    wrapSentences(doc);
    const words = Array.from(doc.querySelectorAll('.jri-word')).map((word) => word.textContent);
    expect(words).toEqual(['Hello', 'world.']);
    expect(doc.querySelector('.jri-sentence')?.textContent).toBe('Hello world.');
  });

  it('wraps multiple sentences in one block', () => {
    const doc = setupDoc('<p>One. Two. Three.</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(3);
    expect(sentenceTexts(doc)).toEqual(['One.', 'Two.', 'Three.']);
    expect(ids(doc)).toEqual([0, 1, 2]);
  });

  it('assigns sequential ids across multiple blocks', () => {
    const doc = setupDoc('<p>First.</p><p>Second.</p><p>Third.</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(3);
    expect(ids(doc)).toEqual([0, 1, 2]);
  });

  it('spans inline elements within a sentence', () => {
    const doc = setupDoc('<p>Hello <em>world</em>. Bye.</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(2);
    expect(sentenceTexts(doc)).toEqual(['Hello world.', 'Bye.']);
  });

  it('keeps inline element structure in place', () => {
    const doc = setupDoc('<p>Hello <em>world</em>.</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    // The <em> stays in its original position in the DOM; the text node inside
    // it is wrapped in a span with the same sentence id as the surrounding
    // text fragments.
    const em = doc.querySelector('em');
    expect(em).not.toBeNull();
    const emSpan = em!.querySelector(`span.${SENTENCE_CLASS}`);
    expect(emSpan).not.toBeNull();
    expect(emSpan!.textContent).toBe('world');
    expect(emSpan!.getAttribute(SENTENCE_ATTR)).toBe('0');
    // All spans for sentence 0 share the same id.
    const allSpansForId0 = doc.querySelectorAll(`span.${SENTENCE_CLASS}[${SENTENCE_ATTR}="0"]`);
    expect(allSpansForId0.length).toBe(3);
  });

  it('does not wrap the extension control dock', () => {
    const doc = setupDoc('<p>Article body.</p><div id="jri-controls"><button>Next</button></div>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['Article body.']);
    expect(doc.querySelector(`#jri-controls .${SENTENCE_CLASS}`)).toBeNull();
  });

  it('ignores semantic page chrome and hidden duplicate content', () => {
    const doc = setupDoc(
      '<header><p>Header sentence.</p></header>' +
        '<nav><p>Navigation sentence.</p></nav>' +
        '<main><p>Visible article sentence.</p><p style="display: none">Hidden duplicate sentence.</p></main>' +
        '<footer><p>Footer sentence.</p></footer>',
    );
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['Visible article sentence.']);
  });

  it('prefers article prose over a link-heavy table of contents', () => {
    const doc = setupDoc(
      '<main><nav><p><a>Introduction.</a> <a>Setup.</a> <a>Conclusion.</a></p></nav>' +
        '<article><p>This is the first substantial article paragraph with enough prose to read.</p>' +
        '<p>This is the second substantial article paragraph with additional context.</p></article></main>',
    );
    const result = wrapSentences(doc);
    expect(result.total).toBe(2);
    expect(sentenceTexts(doc)).toEqual([
      'This is the first substantial article paragraph with enough prose to read.',
      'This is the second substantial article paragraph with additional context.',
    ]);
  });

  it('uses a dedicated prose container instead of adjacent sections in main', () => {
    const doc = setupDoc(
      '<main><section><div class="blog-content-prose">' +
        '<p>The article content stays in the reader.</p>' +
        '</div></section><section><h2>More articles</h2>' +
        '<p>Another article summary should not be included.</p>' +
        '</section></main>',
    );
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['The article content stays in the reader.']);
  });

  it('excludes related and promotional content nested in an article root', () => {
    const doc = setupDoc(
      '<article><p>The article itself remains available for reading.</p>' +
        '<section class="related-posts"><h2>More articles</h2>' +
        '<p>Related article summary should not be included.</p></section>' +
        '<div class="newsletter-promo"><p>Subscribe for more updates.</p></div>' +
        '</article>',
    );
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['The article itself remains available for reading.']);
  });

  it('includes inline <code> in its surrounding sentence', () => {
    const doc = setupDoc('<p>Configure <code>readerMode</code> before continuing.</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['Configure readerMode before continuing.']);

    const code = doc.querySelector('code');
    const codeSpan = code?.querySelector(`span.${SENTENCE_CLASS}`);
    expect(codeSpan?.getAttribute(SENTENCE_ATTR)).toBe('0');
  });

  it('does not wrap <pre> blocks', () => {
    const doc = setupDoc('<pre><code>x = 1;\ny = 2;</code></pre><p>Done.</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['Done.']);
  });

  it('does not wrap multiline <code> blocks', () => {
    const doc = setupDoc('<p>Before.</p><code>const first = 1;\nconst second = 2;</code><p>After.</p>');
    const result = wrapSentences(doc);

    expect(result.total).toBe(2);
    expect(sentenceTexts(doc)).toEqual(['Before.', 'After.']);
  });

  it('scopes to <article> when present', () => {
    const doc = setupDoc('<article><p>Inside article.</p></article><p>Outside.</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['Inside article.']);
  });

  it('scopes Wikipedia pages to article prose instead of the whole body', () => {
    const doc = setupDoc(
      '<header><p>Navigation text.</p></header>' +
        '<div id="bodyContent"><div id="mw-content-text"><div class="mw-parser-output">' +
        '<p>Wikipedia article sentence.</p><div class="navbox"><p>Related links.</p></div>' +
        '</div></div></div>',
    );
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['Wikipedia article sentence.']);
  });

  it('prioritizes site-specific article roots over surrounding page chrome', () => {
    const roots = [
      '#wiki-body',
      '.wiki-page-content',
      '#question .js-post-body',
      '#discussion_bucket',
      '.js-issue-body',
      '.crayons-article__body',
      '.main-page-content',
      '#workskin',
      '#wikiArticle',
    ];
    for (const selector of roots) {
      const doc = setupDoc(
        `<header><p>Navigation sentence.</p></header><main><div class="site-root"><p>Article sentence.</p></div></main>`,
      );
      const root = doc.querySelector('.site-root')!;
      if (selector.includes(' ')) {
        const [parent, child] = selector.split(' ');
        root.id = parent!.slice(1);
        root.innerHTML = `<div class="${child!.slice(1)}"><p>Article sentence.</p></div>`;
      } else if (selector.startsWith('#')) {
        root.id = selector.slice(1);
      } else {
        root.className = selector.slice(1);
      }
      const result = wrapSentences(doc);
      expect(result.total, selector).toBe(1);
      expect(sentenceTexts(doc), selector).toEqual(['Article sentence.']);
    }
  });

  it('recognizes common Reddit post content roots', () => {
    const doc = setupDoc('<p>Page chrome.</p><article data-testid="post-container"><p>Post body.</p></article>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['Post body.']);
  });

  it('wraps Reddit t1 comment paragraph content', () => {
    const doc = setupDoc(
      '<shreddit-app><div id="comment-tree">' +
        '<div id="t1_p0qav9n-post-rtjson-content"><p>Reddit comment body.</p></div>' +
        '</div></shreddit-app>',
    );
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['Reddit comment body.']);
  });

  it('wraps Hacker News comments', () => {
    const doc = setupDoc(
      '<table id="hnmain"><tr><td class="comment"><div class="commtext">' +
        'First Hacker News sentence. Second Hacker News sentence.' +
        '<p>Third paragraph sentence. Fourth sentence.</p></div></td></tr></table>',
    );
    const result = wrapSentences(doc);
    expect(result.total).toBe(4);
    expect(sentenceTexts(doc)).toEqual([
      'First Hacker News sentence.',
      'Second Hacker News sentence.',
      'Third paragraph sentence.',
      'Fourth sentence.',
    ]);
  });

  it('does not wrap Hacker News controls or metadata', () => {
    const doc = setupDoc(
      '<table id="hnmain"><tr><td><span class="pagetop"><a>new</a></span>' +
        '<table class="fatitem"><tr><td class="titleline"><a>Story title.</a></td></tr>' +
        '<tr><td class="subtext"><span class="age">2 hours ago</span><a>104 comments</a></td></tr></table>' +
        '<div class="comment"><div class="commtext">Readable comment.</div>' +
        '<div class="reply"><a>reply</a></div></div></td></tr></table>',
    );
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['Readable comment.']);
    expect(doc.querySelector('.reply .jri-sentence')).toBeNull();
    expect(doc.querySelector('.subtext .jri-sentence')).toBeNull();
    expect(doc.querySelector('.age .jri-sentence')).toBeNull();
  });

  it('ignores comment <article> elements and scopes to the post body', () => {
    // Mimics a WordPress blog where the first <article> is a comment.
    const doc = setupDoc(
      '<article id="comment-1" class="comment"><p>Nice post.</p></article>' +
        '<div class="entry-content"><p>The real article body.</p></div>',
    );
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['The real article body.']);
  });

  it('picks the text-densest non-comment <article> when several exist', () => {
    const doc = setupDoc(
      '<article class="widget"><p>One.</p></article>' + '<article class="post"><p>One.</p><p>Two.</p><p>Three.</p></article>',
    );
    const result = wrapSentences(doc);
    expect(result.total).toBe(3);
    expect(sentenceTexts(doc)).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('exposes ranked candidates with relative confidence scores', () => {
    const doc = setupDoc(
      '<article id="short"><p>Short content.</p></article>' +
        '<article id="long"><p>This is the substantially longer article content with enough prose to rank higher than the other candidate.</p>' +
        '<p>It contains a second paragraph so the reader can choose this section explicitly.</p></article>',
    );
    const candidates = getContentCandidates(doc);
    expect(candidates[0]?.id).toBe('id:long');
    expect(candidates[0]?.confidence).toBe(100);
    expect(candidates.some((candidate) => candidate.id === 'id:short')).toBe(true);
  });

  it('wraps a selected non-default content candidate', async () => {
    const doc = setupDoc('<article id="first"><p>First candidate.</p></article><article id="second"><p>Second candidate.</p></article>');
    const result = await wrapSentencesAsync(doc, { contentCandidate: 'id:second' });
    expect(result?.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['Second candidate.']);
  });

  it.each(['class="post"', ''])('distinguishes repeated candidates and keeps their IDs after wrapping (%s)', async (attributes) => {
    const doc = setupDoc(
      `<article ${attributes}><p>First candidate.</p></article>` +
        `<article ${attributes}><p>Second candidate with substantially more text to rank ahead of the first.</p></article>`,
    );
    const [first, second] = Array.from(doc.querySelectorAll('article'));
    const candidates = getContentCandidates(doc);
    const firstId = candidates.find((candidate) => candidate.element === first)!.id;
    const secondId = candidates.find((candidate) => candidate.element === second)!.id;
    expect(firstId).toBe(attributes ? 'class:article.post' : 'tag:article');
    expect(secondId).not.toBe(firstId);
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(candidates.length);

    const result = await wrapSentencesAsync(doc, { contentCandidate: secondId });
    expect(sentenceTexts(doc)).toEqual(['Second candidate with substantially more text to rank ahead of the first.']);
    expect(scopeContent(doc, firstId)).toBe(first);
    expect(scopeContent(doc, secondId)).toBe(second);
    result?.unwrap();
    expect(scopeContent(doc, secondId)).toBe(second);
  });

  it('avoids collisions between generated suffixes and literal candidate IDs', () => {
    const doc = setupDoc(
      '<article id="post"><p>First.</p></article>' +
        '<article id="post"><p>Second.</p></article>' +
        '<article id="post:2"><p>Literal ID.</p></article>' +
        '<article class="post"><p>Class first.</p></article>' +
        '<article class="post"><p>Class second.</p></article>' +
        '<article class="post:2"><p>Literal class.</p></article>',
    );
    const candidates = getContentCandidates(doc);
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(candidates.length);
    for (const candidate of candidates) expect(scopeContent(doc, candidate.id)).toBe(candidate.element);
    expect(scopeContent(doc, 'id:post')).toBe(doc.querySelector('article'));
    expect(scopeContent(doc, 'id:post:2')).toBe(doc.getElementById('post:2'));
  });

  it('scopes to .entry-content when no usable <article> exists', () => {
    // Mimics the APNIC blog layout.
    const doc = setupDoc(
      '<div id="content" role="main">' +
        '<div class="sidebar"><p>Related link.</p></div>' +
        '<div id="article-content" class="entry-content"><p>Article body.</p></div>' +
        '</div>',
    );
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['Article body.']);
  });

  it('scopes to <main> when no <article> or post body class', () => {
    const doc = setupDoc('<main><p>In main.</p></main><p>Outside.</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['In main.']);
  });

  it('falls back to body when no article/main/post-body', () => {
    const doc = setupDoc('<div><p>Just body.</p></div>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(1);
    expect(sentenceTexts(doc)).toEqual(['Just body.']);
  });

  it('handles heading elements as blocks', () => {
    const doc = setupDoc('<h1>A Title</h1><p>Body.</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(2);
    // Heading has no terminal punctuation, so it's one sentence (trailing fragment).
    expect(sentenceTexts(doc)).toEqual(['A Title', 'Body.']);
  });

  it('handles list items as blocks', () => {
    const doc = setupDoc('<ul><li>First item.</li><li>Second item.</li></ul>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(2);
    expect(sentenceTexts(doc)).toEqual(['First item.', 'Second item.']);
  });

  it('does not double-wrap nested blocks', () => {
    const doc = setupDoc('<blockquote><p>Quoted. Sentence two.</p></blockquote><p>Outer.</p>');
    const result = wrapSentences(doc);
    // blockquote is a block; the inner <p> is not separately wrapped, so its
    // two sentences are wrapped as part of the blockquote.
    expect(result.total).toBe(3);
    expect(sentenceTexts(doc)).toEqual(['Quoted.', 'Sentence two.', 'Outer.']);
    expect(ids(doc)).toEqual([0, 1, 2]);
  });

  it('is idempotent: re-running produces the same number of spans', () => {
    const doc = setupDoc('<p>One. Two. Three.</p>');
    const first = wrapSentences(doc);
    expect(first.total).toBe(3);
    const second = wrapSentences(doc);
    expect(second.total).toBe(3);
    expect(ids(doc)).toEqual([0, 1, 2]);
  });

  it('unwrap restores original text content', () => {
    const doc = setupDoc('<p>One. Two.</p>');
    const before = doc.body.textContent;
    const result = wrapSentences(doc);
    expect(result.total).toBe(2);
    result.unwrap();
    // After unwrap, no sentence spans remain.
    expect(doc.querySelectorAll(`span.${SENTENCE_CLASS}`).length).toBe(0);
    expect(doc.querySelectorAll('.jri-word').length).toBe(0);
    // The text content of the body is preserved.
    expect(doc.body.textContent).toBe(before);
  });

  it('unwrap merges word text nodes back together', () => {
    const doc = setupDoc('<p>One two three.</p>');
    const result = wrapSentences(doc);

    result.unwrap();

    const paragraph = doc.querySelector('p')!;
    expect(paragraph.childNodes).toHaveLength(1);
    expect(paragraph.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(paragraph.textContent).toBe('One two three.');
  });

  it('async unwrap restores text content', async () => {
    const doc = setupDoc('<p>One. Two.</p><p>Three. Four.</p>');
    const before = doc.body.textContent;
    const result = await wrapSentencesAsync(doc);
    const progress: Array<[number, number]> = [];

    await result?.unwrapAsync((processed, total) => progress.push([processed, total]));

    expect(doc.querySelectorAll(`span.${SENTENCE_CLASS}`).length).toBe(0);
    expect(doc.querySelectorAll('.jri-word').length).toBe(0);
    expect(doc.body.textContent).toBe(before);
    expect(progress.at(-1)).toEqual([4, 4]);
  });

  it('unwrap via returned function removes only created spans', () => {
    const doc = setupDoc('<p>A. B.</p><p>C. D.</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(4);
    result.unwrap();
    expect(doc.querySelectorAll(`span.${SENTENCE_CLASS}`).length).toBe(0);
  });

  it('handles abbreviations across text nodes', () => {
    const doc = setupDoc('<p>Dr. <em>Watson</em> arrived. He looked tired.</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(2);
    expect(sentenceTexts(doc)).toEqual(['Dr. Watson arrived.', 'He looked tired.']);
  });

  it('handles decimals without splitting', () => {
    const doc = setupDoc('<p>The value is 3.14 today. End.</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(2);
    expect(sentenceTexts(doc)).toEqual(['The value is 3.14 today.', 'End.']);
  });

  it('wraps Unicode sentence boundaries across inline elements', () => {
    const doc = setupDoc('<p>最初の<em>文</em>です。次の文です！</p>');
    const result = wrapSentences(doc);
    expect(result.total).toBe(2);
    expect(sentenceTexts(doc)).toEqual(['最初の文です。', '次の文です！']);
  });
});
