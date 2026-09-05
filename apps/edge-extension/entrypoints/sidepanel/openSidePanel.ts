/**
 * Side Panel opening rules (Edge/Chromium, Manifest V3).
 *
 * `sidePanel.open()` requires a user gesture. A popup that round-trips through
 * `runtime.sendMessage` to the service worker loses that gesture, so the call is
 * rejected and the button silently does nothing. Extension pages must therefore
 * call the API directly inside their own click handler, and only fall back to the
 * service worker when the API is unavailable to that surface (content scripts).
 */

export type SidePanelOpenOutcome =
  | { opened: true }
  | {
      opened: false;
      reason: 'no_window' | 'restricted_page' | 'unsupported' | 'failed';
      message: string;
    };

export interface SidePanelOpenDependencies {
  /**
   * Direct API call; present on extension pages, absent in a content script.
   * Typed loosely so the browser's own `sidePanel.open` signature can be passed
   * straight through without restating its option shape.
   */
  open?: (options: { windowId: number }) => Promise<unknown>;
  currentWindowId: () => Promise<number | undefined>;
  /** Service-worker fallback used when the calling surface cannot call the API. */
  requestFromBackground?: (windowId: number | undefined) => Promise<boolean>;
}

const RESTRICTED_MESSAGE =
  '当前页面不允许打开侧边栏（浏览器内部页面或受限 URL）。请切换到普通网页后重试。';
const FAILED_MESSAGE = '侧边栏未能打开。请重新点击，或从浏览器侧边栏图标手动打开研译。';
const NO_WINDOW_MESSAGE = '未能确定当前浏览器窗口，侧边栏未打开。';

function describeFailure(error: unknown): SidePanelOpenOutcome {
  const detail = error instanceof Error ? error.message : '';
  // Chromium reports gesture and URL restrictions through the same rejection path.
  if (/gesture/iu.test(detail)) {
    return { opened: false, reason: 'failed', message: FAILED_MESSAGE };
  }
  if (/not allowed|cannot be opened|invalid|restricted/iu.test(detail)) {
    return { opened: false, reason: 'restricted_page', message: RESTRICTED_MESSAGE };
  }
  return { opened: false, reason: 'failed', message: FAILED_MESSAGE };
}

/**
 * Opens the Side Panel from the surface that owns the user gesture, reporting an
 * explicit reason instead of failing silently. Never creates a conversation.
 */
export async function openSidePanelWithGesture(
  dependencies: SidePanelOpenDependencies,
): Promise<SidePanelOpenOutcome> {
  const windowId = await dependencies.currentWindowId().catch(() => undefined);
  if (dependencies.open !== undefined) {
    if (windowId === undefined) {
      return { opened: false, reason: 'no_window', message: NO_WINDOW_MESSAGE };
    }
    try {
      await dependencies.open({ windowId });
      return { opened: true };
    } catch (error) {
      return describeFailure(error);
    }
  }
  if (dependencies.requestFromBackground === undefined) {
    return {
      opened: false,
      reason: 'unsupported',
      message: '当前浏览器不支持从此界面打开侧边栏。',
    };
  }
  const accepted = await dependencies.requestFromBackground(windowId).catch(() => false);
  return accepted ? { opened: true } : { opened: false, reason: 'failed', message: FAILED_MESSAGE };
}
