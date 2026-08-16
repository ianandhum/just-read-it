const MS_PER_WORD = 400;
const MIN_MS = 600;

export function estimateReadingMs(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return MIN_MS;
  const words = trimmed.split(/[\s,;]+/).filter((w) => w.length > 0).length;
  const ms = words * MS_PER_WORD;
  return Math.max(MIN_MS, ms);
}
