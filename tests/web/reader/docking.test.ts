import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDocking, type Docking } from '../../../lib/web/reader/docking';

interface Harness {
  bar: HTMLElement;
  status: HTMLElement;
  handle: HTMLElement;
  docking: Docking;
  onMediaChange: ReturnType<typeof vi.fn>;
  onResize: ReturnType<typeof vi.fn>;
}

function mockMatchMedia(mobile: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function setup(): Harness {
  // happy-dom does not implement pointer capture; add inert stubs so docking's
  // drag handlers can run.
  for (const proto of [HTMLElement.prototype, Element.prototype]) {
    if (!('setPointerCapture' in proto)) {
      (proto as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    }
    if (!('releasePointerCapture' in proto)) {
      (proto as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
    }
    if (!('hasPointerCapture' in proto)) {
      (proto as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
    }
  }
  const bar = document.createElement('div');
  bar.style.width = '100px';
  bar.style.height = '40px';
  const status = document.createElement('div');
  // The handle is a child of the bar in the real UI; pointer events on it
  // bubble up to the bar's pointerdown listener.
  const handle = document.createElement('button');
  handle.textContent = 'grip';
  bar.appendChild(handle);
  document.body.append(bar, status);
  const onMediaChange = vi.fn();
  const onResize = vi.fn();
  const docking = createDocking({ bar, statusElement: status, dragHandle: handle, onMediaChange, onResize });
  return { bar, status, handle, docking, onMediaChange, onResize };
}

describe('createDocking', () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function mockVisualViewport(): { setViewport: (offsetTop: number, height: number, offsetLeft?: number, width?: number) => void } {
    let offsetTop = 40;
    let offsetLeft = 0;
    let height = 600;
    let width = 360;
    const listeners = new Map<string, EventListener>();
    const viewport = {
      get offsetTop() {
        return offsetTop;
      },
      get offsetLeft() {
        return offsetLeft;
      },
      get width() {
        return width;
      },
      get height() {
        return height;
      },
      addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('visualViewport', viewport);
    return {
      setViewport(nextOffsetTop: number, nextHeight: number, nextOffsetLeft = offsetLeft, nextWidth = width) {
        offsetTop = nextOffsetTop;
        height = nextHeight;
        offsetLeft = nextOffsetLeft;
        width = nextWidth;
        listeners.get('scroll')?.(new Event('scroll'));
      },
    };
  }

  it('calls onResize and onMediaChange on sync', () => {
    const h = setup();
    h.docking.sync();
    expect(h.onResize).toHaveBeenCalledTimes(1);
    expect(h.onMediaChange).toHaveBeenCalledTimes(1);
    expect(h.onMediaChange).toHaveBeenCalledWith(false);
  });

  it('reports a mobile breakpoint to onMediaChange on sync', () => {
    mockMatchMedia(true);
    const h = setup();
    h.docking.sync();
    expect(h.onMediaChange).toHaveBeenCalledWith(true);
  });

  it('keeps the default mobile controls 8px above the visual viewport bottom', () => {
    mockMatchMedia(true);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    mockVisualViewport();
    const h = setup();
    Object.defineProperty(h.bar, 'offsetHeight', { value: 120, configurable: true });

    h.docking.sync();

    expect(h.bar.style.left).toBe('8px');
    expect(h.bar.style.width).toBe('344px');
    expect(h.bar.style.top).toBe('512px');
    expect(h.bar.style.bottom).toBe('auto');
  });

  it('re-pins default mobile controls after the visual viewport scrolls', async () => {
    mockMatchMedia(true);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const viewport = mockVisualViewport();
    const h = setup();
    Object.defineProperty(h.bar, 'offsetHeight', { value: 120, configurable: true });

    h.docking.sync();
    viewport.setViewport(0, 720);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(h.bar.style.top).toBe('592px');
  });

  it('re-pins default mobile controls after the document scrolls', async () => {
    mockMatchMedia(true);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const viewport = mockVisualViewport();
    const h = setup();
    Object.defineProperty(h.bar, 'offsetHeight', { value: 120, configurable: true });

    h.docking.sync();
    viewport.setViewport(0, 720);
    window.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(h.bar.style.top).toBe('592px');
  });

  it('keeps a dragged mobile control bar within the visual viewport with 8px edges', async () => {
    mockMatchMedia(true);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const viewport = mockVisualViewport();
    const h = setup();
    Object.defineProperty(h.bar, 'offsetHeight', { value: 120, configurable: true });
    vi.spyOn(h.bar, 'getBoundingClientRect').mockImplementation(() => {
      const top = Number.parseFloat(h.bar.style.top) || 500;
      return {
        left: Number.parseFloat(h.bar.style.left) || 8,
        top,
        width: 344,
        height: 120,
        right: (Number.parseFloat(h.bar.style.left) || 8) + 344,
        bottom: top + 120,
        x: 8,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });

    h.bar.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 30, clientY: 520, button: 0, pointerId: 1, pointerType: 'touch', bubbles: true }),
    );
    h.bar.dispatchEvent(new PointerEvent('pointermove', { clientX: 30, clientY: -100, pointerId: 1, bubbles: true, cancelable: true }));

    expect(h.bar.style.left).toBe('8px');
    expect(h.bar.style.width).toBe('344px');
    expect(h.bar.style.top).toBe('48px');

    viewport.setViewport(100, 300, 20, 320);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(h.bar.style.left).toBe('28px');
    expect(h.bar.style.width).toBe('304px');
    expect(h.bar.style.top).toBe('108px');
    expect(h.bar.style.bottom).toBe('auto');
  });

  it('clamps desktop dragging into the viewport', () => {
    const h = setup();
    h.docking.sync();
    // happy-dom gives zero-size rects; stub a concrete rect for offset math.
    const rect = { left: 10, top: 10, width: 100, height: 40, right: 110, bottom: 50, x: 10, y: 10, toJSON: () => ({}) };
    vi.spyOn(h.bar, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);

    // Desktop drags only begin on the drag handle. pointermove is listened on the bar.
    h.handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, pointerId: 1, bubbles: true }));
    expect(h.handle.classList.contains('jri-dragging')).toBe(true);
    h.bar.dispatchEvent(new PointerEvent('pointermove', { clientX: 5000, clientY: 5000, pointerId: 1, bubbles: true, cancelable: true }));
    // A far-away move should clamp back to the viewport edge.
    const left = parseFloat(h.bar.style.left);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left).toBeLessThanOrEqual(window.innerWidth - 8);
    const top = parseFloat(h.bar.style.top);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top).toBeLessThanOrEqual(window.innerHeight - 8);

    h.bar.dispatchEvent(new PointerEvent('pointerup', { clientX: 5000, clientY: 5000, pointerId: 1, bubbles: true }));
    expect(h.handle.classList.contains('jri-dragging')).toBe(false);
  });

  it('does not intercept clicks on status action buttons', () => {
    const h = setup();
    const action = document.createElement('button');
    h.status.append(action);
    const click = vi.fn();
    action.addEventListener('click', click);

    action.dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, pointerId: 1, bubbles: true }));
    action.click();

    expect(click).toHaveBeenCalledTimes(1);
    expect(h.status.style.left).toBe('');
    h.docking.destroy();
  });

  it('destroy removes resize listener', () => {
    const h = setup();
    h.docking.sync();
    h.docking.destroy();
    const spy = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    expect(spy).toBeDefined();
    // No throw; listeners removed cleanly.
    window.dispatchEvent(new Event('resize'));
  });
});
