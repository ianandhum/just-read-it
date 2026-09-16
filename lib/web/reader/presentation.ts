import type { JriSettings } from '@/lib/types';

export function removeReaderStyle(doc: Document): void {
  doc.documentElement.classList.remove('jri-reader-active');
  doc.documentElement.style.removeProperty('--jri-font-scale');
  doc.documentElement.style.removeProperty('--jri-current-word-color');
  doc.documentElement.style.removeProperty('--jri-dimmed-opacity');
  doc.documentElement.style.removeProperty('--jri-current-highlight');
  doc.documentElement.style.removeProperty('--jri-read-highlight');
  doc.documentElement.style.removeProperty('--jri-current-word-background');
  doc.documentElement.style.removeProperty('--jri-current-sentence-mix');
  doc.documentElement.style.removeProperty('--jri-current-sentence-text');
  doc.documentElement.style.removeProperty('--jri-current-sentence-shadow');
}

function luminance(red: number, green: number, blue: number): number {
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function parseColor(value: string): [number, number, number] | null {
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const expanded =
      hex.length === 3
        ? hex
            .split('')
            .map((channel) => `${channel}${channel}`)
            .join('')
        : hex;
    return [
      Number.parseInt(expanded.slice(0, 2), 16),
      Number.parseInt(expanded.slice(2, 4), 16),
      Number.parseInt(expanded.slice(4, 6), 16),
    ];
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/i)?.[1];
  if (!rgb) return null;
  const channels = rgb
    .split(/[,\s/]+/)
    .slice(0, 3)
    .map(Number);
  return channels.length === 3 && channels.every((channel) => Number.isFinite(channel)) ? [channels[0]!, channels[1]!, channels[2]!] : null;
}

function isTransparent(value: string): boolean {
  const match = value.match(/^rgba?\(([^)]+)\)$/i)?.[1];
  if (!match) return value.trim().toLowerCase() === 'transparent';
  const parts = match.split(/[,\s/]+/);
  return parts.length >= 4 && Number(parts[3]) === 0;
}

function contrastRatio(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export type ReaderTheme = 'light' | 'dark';

function computedColorLuminance(value: string): number | null {
  if (isTransparent(value)) return null;
  const channels = parseColor(value);
  return channels ? luminance(...channels) : null;
}

export function resolveReaderTheme(doc: Document): ReaderTheme {
  const candidates = [doc.body, doc.documentElement].filter((element): element is HTMLElement => element !== null);
  for (const candidate of candidates) {
    const styles = getComputedStyle(candidate);
    const background = computedColorLuminance(styles.backgroundColor);
    if (background !== null) return background < 0.5 ? 'dark' : 'light';
  }
  return 'light';
}

export function resolveReaderUiTheme(prefersDark = matchMedia('(prefers-color-scheme: dark)').matches): ReaderTheme {
  return prefersDark ? 'dark' : 'light';
}

export function setCurrentWordContrast(
  doc: Document,
  settings: Pick<JriSettings, 'currentWordBackgroundColor' | 'darkCurrentWordBackgroundColor'>,
  theme: ReaderTheme,
): void {
  const root = doc.documentElement;
  const background = theme === 'dark' ? settings.darkCurrentWordBackgroundColor : settings.currentWordBackgroundColor;
  root.style.setProperty('--jri-current-word-background', background);
  const channels = parseColor(background);
  if (!channels) return;
  const backgroundLuminanceValue = luminance(...channels);
  const darkTextContrast = contrastRatio(backgroundLuminanceValue, luminance(23, 23, 23));
  const lightTextContrast = contrastRatio(backgroundLuminanceValue, 1);
  root.style.setProperty('--jri-current-word-color', lightTextContrast > darkTextContrast ? '#fff' : '#171717');
}

export function setCurrentSentenceContrast(doc: Document, theme: ReaderTheme): void {
  // Keep the page's configured highlight intact while using a dependable text
  // color for the active reading target.
  doc.documentElement.style.setProperty('--jri-current-sentence-text', theme === 'dark' ? '#fff' : '#111');
  doc.documentElement.style.setProperty('--jri-current-sentence-shadow', theme === 'dark' ? 'rgb(0 0 0 / 35%)' : 'rgb(255 255 255 / 35%)');
}

export function applyReaderFontScale(doc: Document, fontScale: number): void {
  doc.documentElement.style.setProperty('--jri-font-scale', String(fontScale));
}

export function applyReaderAppearance(
  doc: Document,
  settings: Pick<
    JriSettings,
    | 'dimOpacity'
    | 'currentHighlightColor'
    | 'readHighlightColor'
    | 'darkCurrentHighlightColor'
    | 'darkReadHighlightColor'
    | 'currentWordBackgroundColor'
    | 'darkCurrentWordBackgroundColor'
  >,
): void {
  const theme = resolveReaderTheme(doc);
  doc.documentElement.style.setProperty('--jri-dimmed-opacity', String(settings.dimOpacity));
  doc.documentElement.style.setProperty('--jri-current-sentence-mix', theme === 'dark' ? 'white' : 'black');
  setCurrentSentenceContrast(doc, theme);
  doc.documentElement.style.setProperty(
    '--jri-current-highlight',
    theme === 'dark' ? settings.darkCurrentHighlightColor : settings.currentHighlightColor,
  );
  doc.documentElement.style.setProperty(
    '--jri-read-highlight',
    theme === 'dark' ? settings.darkReadHighlightColor : settings.readHighlightColor,
  );
  setCurrentWordContrast(doc, settings, theme);
}
