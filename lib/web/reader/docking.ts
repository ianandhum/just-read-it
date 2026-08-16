/**
 * Docking behaviour for jri-controls on the Viewport
 */

import { clampToViewport, mobileViewportBounds, VIEWPORT_EDGE_GAP } from './viewport';

export interface DockingOptions<TBar extends HTMLElement, TStatus extends HTMLElement> {
  bar: TBar;
  statusElement: TStatus;
  dragHandle: HTMLElement;
  onMediaChange(mobile: boolean): void;
  onResize(): void;
}

export interface Docking {
  sync(): void;
  destroy(): void;
}

export function createDocking<TBar extends HTMLElement, TStatus extends HTMLElement>(options: DockingOptions<TBar, TStatus>): Docking {
  const { bar, statusElement, dragHandle } = options;

  const isMobile = (): boolean => window.matchMedia('(max-width: 600px)').matches;
  let wasMobile = isMobile();

  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragging = false;
  let dragStarted = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let manuallyPositioned = false;
  let suppressMobileClick = false;

  let statusDragOffsetX = 0;
  let statusDragOffsetY = 0;
  let draggingStatus = false;
  let manuallyPositionedStatus = false;

  let pinnedLeft = '';
  let pinnedTop = '';
  let pinnedWidth = '';
  let pinFrame: number | null = null;
  const pinMobileToViewport = (): void => {
    if (!isMobile()) return;
    pinFrame = null;
    const bounds = mobileViewportBounds();
    const left = bounds.left + VIEWPORT_EDGE_GAP;
    const width = Math.max(0, bounds.width - VIEWPORT_EDGE_GAP * 2);
    const top = manuallyPositioned
      ? bounds.top + clampToViewport(bar.getBoundingClientRect().top - bounds.top, bar.offsetHeight, bounds.height)
      : bounds.top + Math.max(VIEWPORT_EDGE_GAP, bounds.height - bar.offsetHeight - VIEWPORT_EDGE_GAP);
    const leftValue = `${left}px`;
    const topValue = `${top}px`;
    const widthValue = `${width}px`;
    if (pinnedLeft !== leftValue) {
      bar.style.left = leftValue;
      pinnedLeft = leftValue;
    }
    if (pinnedWidth !== widthValue) {
      bar.style.width = widthValue;
      pinnedWidth = widthValue;
    }
    if (pinnedTop !== topValue) {
      bar.style.top = topValue;
      pinnedTop = topValue;
    }
    bar.style.right = 'auto';
    bar.style.transform = 'none';
    bar.style.bottom = 'auto';
  };
  const schedulePin = (): void => {
    if (pinFrame !== null) return;
    pinFrame = requestAnimationFrame(pinMobileToViewport);
  };

  const constrainToViewport = (): void => {
    const rect = bar.getBoundingClientRect();
    bar.style.left = `${clampToViewport(rect.left, rect.width, window.innerWidth)}px`;
    bar.style.top = `${clampToViewport(rect.top, rect.height, window.innerHeight)}px`;
    bar.style.right = 'auto';
    bar.style.bottom = 'auto';
    bar.style.transform = 'none';
  };

  const constrainStatusToViewport = (): void => {
    const rect = statusElement.getBoundingClientRect();
    statusElement.style.left = `${clampToViewport(rect.left, rect.width, window.innerWidth)}px`;
    statusElement.style.top = `${clampToViewport(rect.top, rect.height, window.innerHeight)}px`;
    statusElement.style.bottom = 'auto';
    statusElement.style.transform = 'none';
  };

  const handleResize = (): void => {
    const mobile = isMobile();
    if (mobile !== wasMobile) {
      bar.style.removeProperty('left');
      bar.style.removeProperty('top');
      bar.style.removeProperty('right');
      bar.style.removeProperty('bottom');
      bar.style.removeProperty('width');
      bar.style.removeProperty('transform');
      pinnedLeft = '';
      pinnedTop = '';
      pinnedWidth = '';
      wasMobile = mobile;
      if (mobile) {
        manuallyPositioned = false;
        bar.classList.remove('jri-controls-manually-positioned');
      }
      options.onMediaChange(mobile);
    }
    options.onResize();
    if (!isMobile() && manuallyPositioned) {
      constrainToViewport();
    }
    if (manuallyPositionedStatus) constrainStatusToViewport();
    if (pinFrame !== null) cancelAnimationFrame(pinFrame);
    pinFrame = null;
    pinMobileToViewport();
  };

  const handleVisualViewportChange = (): void => {
    schedulePin();
  };
  const handleDocumentScroll = (): void => {
    // Firefox can update the URL-bar/visual viewport during the first
    // scrollIntoView without dispatching a visualViewport event reliably.
    schedulePin();
  };

  window.addEventListener('resize', handleResize);
  window.addEventListener('scroll', handleDocumentScroll, { passive: true });
  window.visualViewport?.addEventListener('scroll', handleVisualViewportChange);
  window.visualViewport?.addEventListener('resize', handleVisualViewportChange);

  const sync = (): void => {
    wasMobile = isMobile();
    pinMobileToViewport();
    options.onMediaChange(wasMobile);
    options.onResize();
  };

  const beginDrag = (event: PointerEvent, immediate: boolean): void => {
    dragging = true;
    dragStarted = immediate;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    const rect = bar.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    bar.setPointerCapture(event.pointerId);
    if (immediate) {
      dragHandle.style.cursor = 'grabbing';
      dragHandle.classList.add('jri-dragging');
    }
  };

  const moveDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    if (!dragStarted) {
      if (Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY) < 8) return;
      dragStarted = true;
    }
    if (isMobile()) {
      const bounds = mobileViewportBounds();
      const top = bounds.top + clampToViewport(event.clientY - dragOffsetY - bounds.top, bar.offsetHeight, bounds.height);
      bar.style.top = `${top}px`;
      manuallyPositioned = true;
      bar.classList.add('jri-controls-manually-positioned');
      pinMobileToViewport();
      event.preventDefault();
      return;
    }
    const left = clampToViewport(event.clientX - dragOffsetX, bar.offsetWidth, window.innerWidth);
    const top = clampToViewport(event.clientY - dragOffsetY, bar.offsetHeight, window.innerHeight);
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.style.bottom = 'auto';
    bar.style.transform = 'none';
    manuallyPositioned = true;
    bar.classList.add('jri-controls-manually-positioned');
    event.preventDefault();
  };

  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (bar.hasPointerCapture(event.pointerId)) bar.releasePointerCapture(event.pointerId);
    dragHandle.style.cursor = 'grab';
    dragHandle.classList.remove('jri-dragging');
    suppressMobileClick = event.type === 'pointerup' && dragStarted && event.pointerType === 'touch';
  };

  bar.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    suppressMobileClick = false;
    const target = event.target;
    const isHandle = target === dragHandle;
    const isMobileRibbonSpace = event.pointerType === 'touch' && (!(target instanceof Element) || target.closest('button') === null);
    if (isMobile() && !isMobileRibbonSpace) return;
    if (!isHandle && !isMobileRibbonSpace) return;
    beginDrag(event, isHandle);
    if (isHandle) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  bar.addEventListener('pointermove', moveDrag);
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
  bar.addEventListener(
    'click',
    (event) => {
      if (!suppressMobileClick) return;
      suppressMobileClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );

  statusElement.addEventListener('pointerdown', (event) => {
    if (isMobile()) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    draggingStatus = true;
    statusElement.setPointerCapture(event.pointerId);
    const rect = statusElement.getBoundingClientRect();
    statusDragOffsetX = event.clientX - rect.left;
    statusDragOffsetY = event.clientY - rect.top;
    event.preventDefault();
  });
  statusElement.addEventListener('pointermove', (event) => {
    if (!draggingStatus) return;
    const left = clampToViewport(event.clientX - statusDragOffsetX, statusElement.offsetWidth, window.innerWidth);
    const top = clampToViewport(event.clientY - statusDragOffsetY, statusElement.offsetHeight, window.innerHeight);
    statusElement.style.left = `${left}px`;
    statusElement.style.top = `${top}px`;
    statusElement.style.bottom = 'auto';
    statusElement.style.transform = 'none';
    manuallyPositionedStatus = true;
  });
  const endStatusDrag = (event: PointerEvent): void => {
    if (!draggingStatus) return;
    draggingStatus = false;
    statusElement.releasePointerCapture(event.pointerId);
  };
  statusElement.addEventListener('pointerup', endStatusDrag);
  statusElement.addEventListener('pointercancel', endStatusDrag);

  const destroy = (): void => {
    if (pinFrame !== null) cancelAnimationFrame(pinFrame);
    pinFrame = null;
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('scroll', handleDocumentScroll);
    window.visualViewport?.removeEventListener('scroll', handleVisualViewportChange);
    window.visualViewport?.removeEventListener('resize', handleVisualViewportChange);
  };

  return { sync, destroy };
}
