/**
 * Selection popover geometry.
 *
 * Two position modes:
 * - `anchored` — follows the selection, re-derived on scroll and resize.
 * - `manual`   — the user dragged it, so the chosen point is kept and scrolling
 *                no longer moves it. Restoring returns to `anchored`.
 *
 * All maths is expressed in CSS pixels against the visual viewport, so browser
 * zoom and 125%/150% Windows scaling need no special handling: the viewport size
 * the caller passes in is already scaled.
 */

export interface PopoverRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export type PositionMode = 'anchored' | 'manual';

export interface PopoverPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: 'above' | 'below';
}

export interface PopoverSizing {
  /** Preferred width; shrinks on narrow viewports. */
  preferredWidth: number;
  preferredHeight: number;
}

export const POPOVER_GAP = 10;
export const VIEWPORT_MARGIN = 8;
export const COMPACT_SIZING: PopoverSizing = { preferredWidth: 380, preferredHeight: 510 };
/** Expanded mode reveals model, reasoning and context controls, so it needs room. */
export const EXPANDED_SIZING: PopoverSizing = { preferredWidth: 440, preferredHeight: 640 };

const MIN_WIDTH = 280;
const MIN_HEIGHT = 160;

function boundedWidth(viewport: Viewport, sizing: PopoverSizing): number {
  return Math.max(MIN_WIDTH, Math.min(sizing.preferredWidth, viewport.width - VIEWPORT_MARGIN * 2));
}

function boundedHeight(viewport: Viewport, sizing: PopoverSizing): number {
  return Math.max(
    MIN_HEIGHT,
    Math.min(sizing.preferredHeight, viewport.height - VIEWPORT_MARGIN * 2),
  );
}

/** Places the popover next to the selection, flipping above when space is short. */
export function anchoredPosition(
  anchor: PopoverRect,
  viewport: Viewport,
  sizing: PopoverSizing = COMPACT_SIZING,
): PopoverPosition {
  const width = boundedWidth(viewport, sizing);
  const viewportMaxHeight = boundedHeight(viewport, sizing);
  const availableBelow = viewport.height - anchor.bottom - POPOVER_GAP - VIEWPORT_MARGIN;
  const availableAbove = anchor.top - POPOVER_GAP - VIEWPORT_MARGIN;
  const placement =
    availableBelow >= Math.min(320, viewportMaxHeight) || availableBelow >= availableAbove
      ? 'below'
      : 'above';
  const placementSpace = placement === 'below' ? availableBelow : availableAbove;
  const minimumHeight = Math.min(220, viewportMaxHeight);
  const maxHeight = Math.max(minimumHeight, Math.min(viewportMaxHeight, placementSpace));
  const preferredLeft = anchor.left + anchor.width / 2 - width / 2;
  const left = Math.min(
    viewport.width - width - VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, preferredLeft),
  );
  const preferredTop =
    placement === 'below' ? anchor.bottom + POPOVER_GAP : anchor.top - maxHeight - POPOVER_GAP;
  const top = Math.min(
    viewport.height - maxHeight - VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, preferredTop),
  );
  return { left, top, width, maxHeight, placement };
}

/**
 * Places the popover at a user-chosen point, clamped so it can never leave the
 * viewport. Always reports `below` because a dragged window has no anchor side.
 */
export function manualPosition(
  offset: { left: number; top: number },
  viewport: Viewport,
  sizing: PopoverSizing = COMPACT_SIZING,
): PopoverPosition {
  const width = boundedWidth(viewport, sizing);
  const maxHeight = boundedHeight(viewport, sizing);
  return {
    width,
    maxHeight,
    placement: 'below',
    left: clamp(offset.left, VIEWPORT_MARGIN, viewport.width - width - VIEWPORT_MARGIN),
    top: clamp(offset.top, VIEWPORT_MARGIN, viewport.height - maxHeight - VIEWPORT_MARGIN),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  // A viewport smaller than the popover makes maximum < minimum; prefer the top
  // left margin in that case rather than returning a negative offset.
  if (maximum < minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export interface DragState {
  /** Pointer id, so a second touch or button cannot hijack an active drag. */
  pointerId: number;
  originX: number;
  originY: number;
  startLeft: number;
  startTop: number;
}

/** Records where a drag began, relative to the popover's current position. */
export function beginDrag(
  pointer: { pointerId: number; clientX: number; clientY: number },
  current: { left: number; top: number },
): DragState {
  return {
    pointerId: pointer.pointerId,
    originX: pointer.clientX,
    originY: pointer.clientY,
    startLeft: current.left,
    startTop: current.top,
  };
}

/** Translates pointer movement into a clamped manual position. */
export function dragTo(
  state: DragState,
  pointer: { clientX: number; clientY: number },
  viewport: Viewport,
  sizing: PopoverSizing = COMPACT_SIZING,
): PopoverPosition {
  return manualPosition(
    {
      left: state.startLeft + (pointer.clientX - state.originX),
      top: state.startTop + (pointer.clientY - state.originY),
    },
    viewport,
    sizing,
  );
}

/**
 * Resolves the position to render for the current mode. Anchored mode tracks the
 * selection; manual mode keeps the dragged point but is re-clamped so a resize
 * cannot leave the popover off screen.
 */
export function resolvePosition(input: {
  mode: PositionMode;
  anchor: PopoverRect;
  manualOffset?: { left: number; top: number };
  viewport: Viewport;
  sizing?: PopoverSizing;
}): PopoverPosition {
  const sizing = input.sizing ?? COMPACT_SIZING;
  if (input.mode === 'manual' && input.manualOffset !== undefined) {
    return manualPosition(input.manualOffset, input.viewport, sizing);
  }
  return anchoredPosition(input.anchor, input.viewport, sizing);
}

/**
 * Shifts an anchor rect by how far the page scrolled since it was captured.
 * Used when no live anchor getter is available (for example a PDF text layer).
 */
export function anchorAfterScroll(
  anchor: PopoverRect,
  origin: { x: number; y: number },
  current: { x: number; y: number },
): PopoverRect {
  const deltaX = current.x - origin.x;
  const deltaY = current.y - origin.y;
  return {
    ...anchor,
    left: anchor.left - deltaX,
    right: anchor.right - deltaX,
    top: anchor.top - deltaY,
    bottom: anchor.bottom - deltaY,
  };
}
