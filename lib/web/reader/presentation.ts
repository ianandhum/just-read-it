export function removeReaderStyle(doc: Document): void {
  doc.documentElement.classList.remove('jri-reader-active');
  doc.documentElement.style.removeProperty('--jri-font-scale');
  doc.documentElement.style.removeProperty('--jri-current-word-background');
  doc.documentElement.style.removeProperty('--jri-current-word-color');
}

function luminance(red: number, green: number, blue: number): number {
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function backgroundLuminance(element: HTMLElement): number | null {
  for (let candidate: HTMLElement | null = element; candidate; candidate = candidate.parentElement) {
    const match = getComputedStyle(candidate).backgroundColor.match(/^rgba?\(([^)]+)\)$/);
    if (!match) continue;
    const [red, green, blue, alpha = '1'] = match[1]!.split(',').map((value) => value.trim());
    if (Number(alpha) === 0) continue;
    const channels = [Number(red), Number(green), Number(blue)];
    if (channels.some((channel) => !Number.isFinite(channel))) continue;
    return luminance(channels[0]!, channels[1]!, channels[2]!);
  }
  return null;
}

export function setCurrentWordContrast(doc: Document): void {
  const sentences = Array.from(doc.querySelectorAll<HTMLElement>('.jri-sentence')).slice(0, 5);
  const samples = sentences.map(backgroundLuminance).filter((value): value is number => value !== null);
  const lightBackground = samples.length === 0 || samples.filter((value) => value > 0.5).length * 2 >= samples.length;
  doc.documentElement.style.setProperty('--jri-current-word-background', lightBackground ? '#fdc57b' : '#fde68a');
  doc.documentElement.style.setProperty('--jri-current-word-color', '#171717');
}

export function applyReaderFontScale(doc: Document, fontScale: number): void {
  doc.documentElement.style.setProperty('--jri-font-scale', String(fontScale));
}
