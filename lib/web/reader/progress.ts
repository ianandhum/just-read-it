const BAR_ID = 'jri-progress';
const FILL_ID = 'jri-progress-fill';
export interface ProgressBar {
  update(read: number, total: number): void;
  destroy(): void;
}

export function createProgressBar(doc: Document, root: ShadowRoot): ProgressBar {
  root.getElementById(BAR_ID)?.remove();

  const bar = doc.createElement('div');
  bar.id = BAR_ID;
  const fill = doc.createElement('div');
  fill.id = FILL_ID;
  bar.appendChild(fill);
  root.appendChild(bar);

  return {
    update(read, total) {
      const pct = total > 0 ? Math.min(100, (read / total) * 100) : 0;
      fill.style.width = `${pct}%`;
    },
    destroy() {
      bar.remove();
    },
  };
}
