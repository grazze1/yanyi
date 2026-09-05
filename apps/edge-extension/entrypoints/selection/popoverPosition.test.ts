import { describe, expect, it } from 'vitest';
import {
  anchorAfterScroll,
  anchoredPosition,
  beginDrag,
  COMPACT_SIZING,
  dragTo,
  EXPANDED_SIZING,
  manualPosition,
  resolvePosition,
  VIEWPORT_MARGIN,
  type PopoverRect,
} from './popoverPosition';

function anchor(overrides: Partial<PopoverRect> = {}): PopoverRect {
  return {
    top: 300,
    bottom: 320,
    left: 400,
    right: 520,
    width: 120,
    height: 20,
    ...overrides,
  };
}

const viewport = { width: 1280, height: 800 };

describe('anchoredPosition', () => {
  it('centres below the selection when there is room', () => {
    const position = anchoredPosition(anchor(), viewport);
    expect(position.placement).toBe('below');
    expect(position.top).toBeGreaterThan(320);
    // Horizontally centred on the selection.
    expect(position.left + position.width / 2).toBeCloseTo(460, 0);
  });

  it('flips above when the selection sits near the bottom edge', () => {
    const position = anchoredPosition(anchor({ top: 700, bottom: 720 }), viewport);
    expect(position.placement).toBe('above');
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(700);
  });

  it('never leaves the viewport for a selection at the far right', () => {
    const position = anchoredPosition(anchor({ left: 1260, right: 1280, width: 20 }), viewport);
    expect(position.left + position.width).toBeLessThanOrEqual(viewport.width - VIEWPORT_MARGIN);
    expect(position.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  });

  it('shrinks to fit a narrow viewport', () => {
    // 125%/150% Windows scaling and browser zoom both reduce the CSS-pixel
    // viewport, so fitting is expressed purely in the units passed in.
    const narrow = anchoredPosition(anchor(), { width: 360, height: 500 });
    expect(narrow.width).toBeLessThanOrEqual(360 - VIEWPORT_MARGIN * 2);
    expect(narrow.maxHeight).toBeLessThanOrEqual(500 - VIEWPORT_MARGIN * 2);
  });

  it('gives the expanded mode more room than compact', () => {
    const compact = anchoredPosition(anchor({ top: 60, bottom: 80 }), viewport, COMPACT_SIZING);
    const expanded = anchoredPosition(anchor({ top: 60, bottom: 80 }), viewport, EXPANDED_SIZING);
    expect(expanded.width).toBeGreaterThan(compact.width);
    expect(expanded.maxHeight).toBeGreaterThan(compact.maxHeight);
  });
});

describe('manual positioning', () => {
  it('clamps a dragged position inside the viewport', () => {
    const offScreen = manualPosition({ left: -500, top: -500 }, viewport);
    expect(offScreen.left).toBe(VIEWPORT_MARGIN);
    expect(offScreen.top).toBe(VIEWPORT_MARGIN);

    const beyond = manualPosition({ left: 5_000, top: 5_000 }, viewport);
    expect(beyond.left + beyond.width).toBeLessThanOrEqual(viewport.width - VIEWPORT_MARGIN);
    expect(beyond.top + beyond.maxHeight).toBeLessThanOrEqual(viewport.height - VIEWPORT_MARGIN);
  });

  it('falls back to the top-left margin when the viewport is smaller than the popover', () => {
    const tiny = manualPosition({ left: 40, top: 40 }, { width: 200, height: 150 });
    expect(tiny.left).toBe(VIEWPORT_MARGIN);
    expect(tiny.top).toBe(VIEWPORT_MARGIN);
  });
});

describe('dragging', () => {
  it('moves the popover by the pointer delta', () => {
    const start = anchoredPosition(anchor(), viewport);
    const state = beginDrag(
      { pointerId: 1, clientX: 500, clientY: 350 },
      { left: start.left, top: start.top },
    );
    const moved = dragTo(state, { clientX: 560, clientY: 300 }, viewport);
    expect(moved.left).toBe(start.left + 60);
    expect(moved.top).toBe(start.top - 50);
  });

  it('is unaffected by where inside the handle the drag began', () => {
    const from = { left: 200, top: 200 };
    const first = dragTo(
      beginDrag({ pointerId: 1, clientX: 210, clientY: 205 }, from),
      { clientX: 250, clientY: 245 },
      viewport,
    );
    const second = dragTo(
      beginDrag({ pointerId: 1, clientX: 290, clientY: 260 }, from),
      { clientX: 330, clientY: 300 },
      viewport,
    );
    expect(first.left).toBe(second.left);
    expect(first.top).toBe(second.top);
  });

  it('keeps a drag clamped while the pointer travels off screen', () => {
    const state = beginDrag({ pointerId: 1, clientX: 300, clientY: 300 }, { left: 200, top: 200 });
    const dragged = dragTo(state, { clientX: -900, clientY: -900 }, viewport);
    expect(dragged.left).toBe(VIEWPORT_MARGIN);
    expect(dragged.top).toBe(VIEWPORT_MARGIN);
  });
});

describe('resolvePosition', () => {
  it('tracks the selection while anchored', () => {
    const first = resolvePosition({ mode: 'anchored', anchor: anchor(), viewport });
    const scrolled = resolvePosition({
      mode: 'anchored',
      anchor: anchor({ top: 200, bottom: 220 }),
      viewport,
    });
    expect(scrolled.top).not.toBe(first.top);
  });

  it('keeps the manual position when the page scrolls', () => {
    const manualOffset = { left: 300, top: 120 };
    const before = resolvePosition({ mode: 'manual', anchor: anchor(), manualOffset, viewport });
    const afterScroll = resolvePosition({
      mode: 'manual',
      anchor: anchor({ top: -400, bottom: -380 }),
      manualOffset,
      viewport,
    });
    expect(afterScroll.top).toBe(before.top);
    expect(afterScroll.left).toBe(before.left);
  });

  it('returns to the selection after restoring anchored mode', () => {
    const anchored = resolvePosition({ mode: 'anchored', anchor: anchor(), viewport });
    const manual = resolvePosition({
      mode: 'manual',
      anchor: anchor(),
      manualOffset: { left: 20, top: 20 },
      viewport,
    });
    expect(manual.top).not.toBe(anchored.top);
    const restored = resolvePosition({ mode: 'anchored', anchor: anchor(), viewport });
    expect(restored.top).toBe(anchored.top);
    expect(restored.left).toBe(anchored.left);
  });

  it('re-clamps a manual position after the window shrinks', () => {
    const manualOffset = { left: 1_100, top: 700 };
    const shrunk = resolvePosition({
      mode: 'manual',
      anchor: anchor(),
      manualOffset,
      viewport: { width: 640, height: 480 },
    });
    expect(shrunk.left + shrunk.width).toBeLessThanOrEqual(640 - VIEWPORT_MARGIN);
    expect(shrunk.top + shrunk.maxHeight).toBeLessThanOrEqual(480 - VIEWPORT_MARGIN);
  });
});

describe('anchorAfterScroll', () => {
  it('shifts the anchor by the scroll delta', () => {
    const shifted = anchorAfterScroll(anchor(), { x: 0, y: 100 }, { x: 0, y: 260 });
    expect(shifted.top).toBe(300 - 160);
    expect(shifted.bottom).toBe(320 - 160);
    expect(shifted.left).toBe(400);
  });
});
