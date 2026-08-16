export const VIEWPORT_EDGE_GAP = 8;

export function clampToViewport(value: number, size: number, viewportSize: number, edgeGap = VIEWPORT_EDGE_GAP): number {
  const maximum = Math.max(edgeGap, viewportSize - size - edgeGap);
  return Math.max(edgeGap, Math.min(maximum, value));
}

export function mobileViewportBounds(): { left: number; top: number; width: number; height: number } {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const bottom = Math.min(viewport ? viewport.offsetTop + viewport.height : Infinity, window.innerHeight);
  return { left, top, width: viewport?.width ?? window.innerWidth, height: bottom - top };
}
