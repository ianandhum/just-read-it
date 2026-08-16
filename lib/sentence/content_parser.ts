/*
 * Adapted from Mozilla Readability's _grabArticle and _getClassWeight
 * algorithms: https://github.com/mozilla/readability/blob/main/Readability.js
 *
 * Copyright (c) 2010 Arc90 Inc.
 * Copyright (c) 2010-2026 Mozilla and Contributors.
 * Licensed under the Apache License, Version 2.0. See THIRD_PARTY_NOTICES.md.
 *
 * Modified for Just Read It: selects an existing live-DOM root for sentence
 * wrapping and does not clone, rewrite, or render an extracted article document.
 */

const BLOCK_SELECTOR = [
  'p',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'td',
  'th',
  'dd',
  'dt',
  'figcaption',
  '.commtext',
].join(', ');

const CONTENT_SELECTOR = [
  '.entry-content',
  '.post-content',
  '.article-content',
  '#article-content',
  '.post-body',
  '.article-body',
  '.article__body',
  '.blog-content-prose',
  '.post__body',
  '#wiki-body',
  '.wiki-page-content',
  '#mw-content-text .mw-parser-output',
  '#bodyContent',
  '#mw-content-text',
  '#question .js-post-body',
  '#discussion_bucket',
  '.js-issue-body',
  '.crayons-article__body',
  '.main-page-content',
  '#workskin',
  '#wikiArticle',
  'shreddit-app',
  '#comment-tree',
  '#hnmain',
].join(', ');

const EXCLUDED_TAGS = new Set([
  'ASIDE',
  'BUTTON',
  'CANVAS',
  'FOOTER',
  'FORM',
  'HEADER',
  'IFRAME',
  'INPUT',
  'MENU',
  'NAV',
  'NOSCRIPT',
  'OBJECT',
  'PRE',
  'SCRIPT',
  'SELECT',
  'STYLE',
  'SVG',
  'TEXTAREA',
]);

const EXCLUDED_SELECTOR = [
  '#jri-controls',
  '#jri-progress',
  '.mw-editsection',
  '.reference',
  'sup.reference',
  '.reflist',
  '.mw-references-wrap',
  '.navbox',
  '.infobox',
  '.comment-actions',
  '.hnuser',
  '.pagetop',
  '.morelink',
  '.yclinks',
  '.titleline',
  '.sitebit',
  '.subtext',
  '.subline',
  '.age',
  '.votelinks',
  '.navs',
  '.vote-bar',
  '.votebar',
  '.reply',
  '[role="alert"]',
  '[role="banner"]',
  '[role="complementary"]',
  '[role="contentinfo"]',
  '[role="dialog"]',
  '[role="navigation"]',
].join(', ');

const POSITIVE_HINT = /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/iu;
const NEGATIVE_HINT =
  /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|contact|footer|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget/iu;
const COMMAS = /\u002C|\u060C|\uFE50|\uFE10|\uFE11|\u2E41|\u2E34|\u2E32|\uFF0C/gu;

interface Candidate {
  score: number;
  manualBonus: number;
}

export interface ContentCandidate {
  id: string;
  label: string;
  confidence: number;
  element: Element;
}

function hintWeight(el: Element): number {
  const hints = `${el.className} ${el.id}`;
  let weight = 0;
  if (POSITIVE_HINT.test(hints)) weight += 25;
  if (NEGATIVE_HINT.test(hints)) weight -= 25;
  return weight;
}

function hasNegativeHint(el: Element): boolean {
  return NEGATIVE_HINT.test(`${el.className} ${el.id}`);
}

function isComment(el: Element): boolean {
  return el.classList.contains('comment') || el.id.startsWith('comment-');
}

function isExcluded(el: Element): boolean {
  return (
    EXCLUDED_TAGS.has(el.tagName) ||
    el.matches(EXCLUDED_SELECTOR) ||
    hasNegativeHint(el) ||
    el.hasAttribute('hidden') ||
    el.getAttribute('aria-hidden') === 'true' ||
    el.hasAttribute('inert') ||
    (el.tagName === 'DETAILS' && !el.hasAttribute('open')) ||
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)/iu.test(el.getAttribute('style') ?? '')
  );
}

function isCodeBlock(el: Element): boolean {
  return el.tagName === 'CODE' && /[\r\n]/u.test(el.textContent ?? '');
}

function textLength(nodes: Text[]): number {
  return nodes.reduce((total, node) => total + (node.nodeValue?.trim().length ?? 0), 0);
}

function linkDensity(block: Element, length: number): number {
  if (length === 0) return 0;
  let linkedText = 0;
  for (const link of block.querySelectorAll('a')) {
    linkedText += textLength(collectTextNodes(link));
  }
  return Math.min(1, linkedText / length);
}

function isReadableBlock(block: Element): boolean {
  const length = textLength(collectTextNodes(block));
  return length > 0 && (length >= 80 || linkDensity(block, length) < 0.6);
}

function tagWeight(el: Element): number {
  switch (el.tagName) {
    case 'DIV':
      return 5;
    case 'PRE':
    case 'TD':
    case 'BLOCKQUOTE':
      return 3;
    case 'ADDRESS':
    case 'OL':
    case 'UL':
    case 'DL':
    case 'DD':
    case 'DT':
    case 'LI':
    case 'FORM':
      return -3;
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
    case 'TH':
      return -5;
    default:
      return 0;
  }
}

function candidateScore(el: Element, candidate: Candidate): number {
  return (candidate.score + candidate.manualBonus) * (1 - linkDensity(el, textLength(collectTextNodes(el))));
}

function candidateId(el: Element): string {
  if (el.id) return `id:${el.id}`;
  const classes = Array.from(el.classList);
  if (classes.length > 0) return `class:${el.tagName.toLowerCase()}.${classes.join('.')}`;
  return `tag:${el.tagName.toLowerCase()}`;
}

function candidateLabel(el: Element): string {
  if (el.id) return `#${el.id}`;
  const className = Array.from(el.classList)
    .slice(0, 2)
    .map((name) => `.${name}`)
    .join('');
  return `${el.tagName.toLowerCase()}${className}`;
}

export function getContentCandidates(doc: Document): ContentCandidate[] {
  const body = doc.body ?? doc.documentElement;
  if (!body) throw new Error('Just Read It: document has no body');

  const candidates = new Map<Element, Candidate>();
  const ensureCandidate = (el: Element): Candidate => {
    let candidate = candidates.get(el);
    if (!candidate) {
      candidate = { score: tagWeight(el) + hintWeight(el), manualBonus: 0 };
      candidates.set(el, candidate);
    }
    return candidate;
  };
  const addCandidates = (selector: string, bonus: number): void => {
    for (const el of doc.querySelectorAll(selector)) {
      if (!isExcluded(el) && !isComment(el)) {
        ensureCandidate(el).manualBonus = Math.max(ensureCandidate(el).manualBonus, bonus);
      }
    }
  };

  // Site roots are compatibility hints. Paragraph scoring remains the primary
  // signal, matching Readability's content selection model.
  addCandidates(CONTENT_SELECTOR, 12);
  addCandidates('article', 8);
  addCandidates('main, [role="main"]', 4);

  for (const block of doc.querySelectorAll('section, h2, h3, h4, h5, h6, p, td')) {
    if (isExcluded(block)) continue;
    const text = collectTextNodes(block)
      .map((node) => node.nodeValue ?? '')
      .join(' ')
      .trim();
    if (text.length < 25) continue;

    const score = 1 + (text.match(COMMAS)?.length ?? 0) + Math.min(Math.floor(text.length / 100), 3);
    let ancestor: Element | null = block.parentElement;
    for (let level = 0; ancestor && level < 5; level++, ancestor = ancestor.parentElement) {
      if (isExcluded(ancestor)) break;
      const divider = level === 0 ? 1 : level === 1 ? 2 : level * 3;
      ensureCandidate(ancestor).score += score / divider;
    }
  }

  const scored = [...candidates]
    .map(([element, data]) => ({ element, score: candidateScore(element, data) }))
    .filter(({ element, score }) => score > 0 && collectBlocks(element).length > 0)
    .sort((a, b) => b.score - a.score);
  const bestScore = scored[0]?.score ?? 0;
  const result = scored.slice(0, 8).map(({ element, score }) => ({
    id: candidateId(element),
    label: candidateLabel(element),
    confidence: bestScore > 0 ? Math.round((score / bestScore) * 100) : 0,
    element,
  }));
  if (!result.some((candidate) => candidate.element === body)) {
    result.push({ id: candidateId(body), label: 'body', confidence: 0, element: body });
  }
  return result;
}

export function scopeContent(doc: Document, selectedId?: string): Element {
  const candidates = getContentCandidates(doc);
  return candidates.find((candidate) => candidate.id === selectedId)?.element ?? candidates[0]?.element ?? doc.body ?? doc.documentElement;
}

export function collectBlocks(root: Element): Element[] {
  const blocks: Element[] = [];
  const seen = new Set<Element>();

  for (const block of root.querySelectorAll(BLOCK_SELECTOR)) {
    if (seen.has(block) || isExcluded(block)) continue;

    let ancestor = block.parentElement;
    let blocked = false;
    while (ancestor && ancestor !== root) {
      if (isExcluded(ancestor)) {
        blocked = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (blocked || !isReadableBlock(block)) continue;

    blocks.push(block);
    for (const nestedBlock of block.querySelectorAll(BLOCK_SELECTOR)) {
      seen.add(nestedBlock);
    }
  }
  return blocks;
}

export function collectTextNodes(block: Element): Text[] {
  const nodes: Text[] = [];

  function walk(node: Node, excluded: boolean): void {
    if (excluded) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      if (text.nodeValue) nodes.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const isChildExcluded = el !== block && (isExcluded(el) || isCodeBlock(el));
    for (const child of Array.from(el.childNodes)) {
      walk(child, isChildExcluded);
    }
  }

  walk(block, false);
  return nodes;
}
