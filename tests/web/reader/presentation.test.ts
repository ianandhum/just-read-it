import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeReaderStyle, setCurrentWordContrast } from '../../../lib/web/reader/presentation';

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
  document.body.innerHTML = '';
});

describe('setCurrentWordContrast', () => {
  it('uses a stronger yellow for mostly light backgrounds', () => {
    sentences(['rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)']);

    setCurrentWordContrast(document);

    expect(document.documentElement.style.getPropertyValue('--jri-current-word-background')).toBe('#fdc57b');
    expect(document.documentElement.style.getPropertyValue('--jri-current-word-color')).toBe('#171717');
  });

  it('uses a softer warm highlight for mostly dark backgrounds', () => {
    sentences(['rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(255, 255, 255)', 'rgb(255, 255, 255)']);

    setCurrentWordContrast(document);

    expect(document.documentElement.style.getPropertyValue('--jri-current-word-background')).toBe('#fde68a');
    expect(document.documentElement.style.getPropertyValue('--jri-current-word-color')).toBe('#171717');
  });
});

describe('removeReaderStyle', () => {
  it('disables the manifest-injected page stylesheet and clears its variables', () => {
    document.documentElement.classList.add('jri-reader-active');
    document.documentElement.style.setProperty('--jri-font-scale', '1.2');
    document.documentElement.style.setProperty('--jri-current-word-background', '#fdc57b');
    document.documentElement.style.setProperty('--jri-current-word-color', '#171717');

    removeReaderStyle(document);

    expect(document.documentElement.classList.contains('jri-reader-active')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--jri-font-scale')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--jri-current-word-background')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--jri-current-word-color')).toBe('');
  });
});
