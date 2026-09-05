import { describe, expect, it, vi } from 'vitest';
import { openSidePanelWithGesture } from './openSidePanel';

describe('openSidePanelWithGesture', () => {
  it('calls the API directly so the popup keeps its user gesture', async () => {
    const open = vi.fn(() => Promise.resolve(undefined));
    const outcome = await openSidePanelWithGesture({
      open,
      currentWindowId: () => Promise.resolve(42),
    });
    expect(outcome).toStrictEqual({ opened: true });
    expect(open).toHaveBeenCalledWith({ windowId: 42 });
  });

  it('reports a restricted page instead of failing silently', async () => {
    const outcome = await openSidePanelWithGesture({
      open: () => Promise.reject(new Error('Side panel is not allowed for this URL')),
      currentWindowId: () => Promise.resolve(1),
    });
    expect(outcome.opened).toBe(false);
    if (outcome.opened) throw new Error('expected refusal');
    expect(outcome.reason).toBe('restricted_page');
    expect(outcome.message).toContain('不允许打开侧边栏');
  });

  it('reports a gesture rejection as a retryable failure', async () => {
    const outcome = await openSidePanelWithGesture({
      open: () => Promise.reject(new Error('sidePanel.open() requires a user gesture')),
      currentWindowId: () => Promise.resolve(1),
    });
    expect(outcome.opened).toBe(false);
    if (outcome.opened) throw new Error('expected refusal');
    expect(outcome.reason).toBe('failed');
  });

  it('reports a missing window rather than calling the API with no target', async () => {
    const open = vi.fn(() => Promise.resolve(undefined));
    const outcome = await openSidePanelWithGesture({
      open,
      currentWindowId: () => Promise.resolve(undefined),
    });
    expect(open).not.toHaveBeenCalled();
    expect(outcome.opened).toBe(false);
    if (outcome.opened) throw new Error('expected refusal');
    expect(outcome.reason).toBe('no_window');
  });

  it('falls back to the service worker for surfaces without the API', async () => {
    const requestFromBackground = vi.fn(() => Promise.resolve(true));
    const outcome = await openSidePanelWithGesture({
      currentWindowId: () => Promise.resolve(5),
      requestFromBackground,
    });
    expect(requestFromBackground).toHaveBeenCalledWith(5);
    expect(outcome).toStrictEqual({ opened: true });
  });

  it('surfaces a refused fallback', async () => {
    const outcome = await openSidePanelWithGesture({
      currentWindowId: () => Promise.resolve(5),
      requestFromBackground: () => Promise.resolve(false),
    });
    expect(outcome.opened).toBe(false);
  });

  it('reports unsupported when neither route exists', async () => {
    const outcome = await openSidePanelWithGesture({
      currentWindowId: () => Promise.resolve(5),
    });
    expect(outcome.opened).toBe(false);
    if (outcome.opened) throw new Error('expected refusal');
    expect(outcome.reason).toBe('unsupported');
  });
});
