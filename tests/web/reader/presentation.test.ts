import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyReaderAppearance,
  removeReaderStyle,
  resolveReaderTheme,
  resolveReaderUiTheme,
  setCurrentWordContrast,
  setCurrentSentenceContrast,
} from '../../../lib/web/reader/presentation';
import { DEFAULT_SETTINGS } from '../../../lib/types';

function sentences(backgrounds: string[]): void {
  document.body.innerHTML = backgrounds
    .map((background) => `<p data-background="${background}"><span class="jri-sentence">Text</span></p>`)
    .join('');
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const background = (element as HTMLElement).dataset.background ?? 'rgba(0, 0, 0, 0)';
    return { backgroundColor: background } as CSSStyleDeclaration;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('--jri-current-word-background');
  document.documentElement.style.removeProperty('--jri-current-word-color');
  document.documentElement.style.removeProperty('--jri-current-sentence-mix');
  document.documentElement.style.removeProperty('--jri-current-sentence-text');
  document.documentElement.style.removeProperty('--jri-current-sentence-shadow');
  document.body.innerHTML = '';
});

describe('setCurrentWordContrast', () => {
  it('uses the light reader color for a light website', () => {
    sentences(['rgb(0, 0, 0)']);

    setCurrentWordContrast(document, DEFAULT_SETTINGS, 'light');

    expect(document.documentElement.style.getPropertyValue('--jri-current-word-background')).toBe('#fdc57b');
    expect(document.documentElement.style.getPropertyValue('--jri-current-word-color')).toBe('#171717');
  });

  it('uses the dark reader color for a dark website', () => {
    sentences(['rgb(255, 255, 255)']);

    setCurrentWordContrast(document, DEFAULT_SETTINGS, 'dark');

    expect(document.documentElement.style.getPropertyValue('--jri-current-word-background')).toBe('#ffd8b0');
    expect(document.documentElement.style.getPropertyValue('--jri-current-word-color')).toBe('#171717');
  });

  it('chooses light text for a dark configured word highlight', () => {
    sentences(['rgb(255, 255, 255)']);
    document.documentElement.style.setProperty('--jri-current-word-background', '#222222');

    setCurrentWordContrast(document, { currentWordBackgroundColor: '#fdc57b', darkCurrentWordBackgroundColor: '#222222' }, 'dark');

    expect(document.documentElement.style.getPropertyValue('--jri-current-word-background')).toBe('#222222');
    expect(document.documentElement.style.getPropertyValue('--jri-current-word-color')).toBe('#fff');
  });
});

describe('resolveReaderTheme', () => {
  it('follows the page background instead of the browser preference', () => {
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    expect(resolveReaderTheme(document)).toBe('light');
    document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    expect(resolveReaderTheme(document)).toBe('dark');
  });

  it('inverts the page theme for floating reader controls', () => {
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    expect(resolveReaderUiTheme(false)).toBe('light');
    document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    expect(resolveReaderUiTheme(true)).toBe('dark');
  });

  it('does not treat transparent backgrounds as dark', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ backgroundColor: 'rgba(0, 0, 0, 0)' } as CSSStyleDeclaration);
    expect(resolveReaderTheme(document)).toBe('light');
  });
});

describe('applyReaderAppearance', () => {
  it('uses high-contrast text for the active sentence without changing the configured highlight', () => {
    document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    applyReaderAppearance(document, DEFAULT_SETTINGS);
    expect(document.documentElement.style.getPropertyValue('--jri-current-sentence-text')).toBe('#fff');
    expect(document.documentElement.style.getPropertyValue('--jri-current-sentence-shadow')).toBe('rgb(0 0 0 / 35%)');
    expect(document.documentElement.style.getPropertyValue('--jri-current-highlight')).toBe(DEFAULT_SETTINGS.darkCurrentHighlightColor);

    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    applyReaderAppearance(document, DEFAULT_SETTINGS);
    expect(document.documentElement.style.getPropertyValue('--jri-current-sentence-text')).toBe('#111');
    expect(document.documentElement.style.getPropertyValue('--jri-current-sentence-shadow')).toBe('rgb(255 255 255 / 35%)');
    expect(document.documentElement.style.getPropertyValue('--jri-current-highlight')).toBe(DEFAULT_SETTINGS.currentHighlightColor);
  });

  it('sets active sentence text contrast independently from word colors', () => {
    setCurrentSentenceContrast(document, 'dark');
    expect(document.documentElement.style.getPropertyValue('--jri-current-sentence-text')).toBe('#fff');
  });

  it('mixes current sentence text toward the page theme', () => {
    document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    applyReaderAppearance(document, DEFAULT_SETTINGS);
    expect(document.documentElement.style.getPropertyValue('--jri-current-sentence-mix')).toBe('white');

    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    applyReaderAppearance(document, DEFAULT_SETTINGS);
    expect(document.documentElement.style.getPropertyValue('--jri-current-sentence-mix')).toBe('black');
  });
});

describe('removeReaderStyle', () => {
  it('disables the manifest-injected page stylesheet and clears its variables', () => {
    document.documentElement.classList.add('jri-reader-active');
    document.documentElement.style.setProperty('--jri-font-scale', '1.2');
    document.documentElement.style.setProperty('--jri-current-word-background', '#fdc57b');
    document.documentElement.style.setProperty('--jri-current-word-color', '#171717');
    document.documentElement.style.setProperty('--jri-current-sentence-mix', 'white');
    document.documentElement.style.setProperty('--jri-current-sentence-text', '#fff');
    document.documentElement.style.setProperty('--jri-current-sentence-shadow', 'rgb(0 0 0 / 35%)');

    removeReaderStyle(document);

    expect(document.documentElement.classList.contains('jri-reader-active')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--jri-font-scale')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--jri-current-word-background')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--jri-current-word-color')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--jri-current-sentence-mix')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--jri-current-sentence-text')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--jri-current-sentence-shadow')).toBe('');
  });
});
