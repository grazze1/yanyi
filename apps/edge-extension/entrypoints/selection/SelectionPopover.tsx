import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChevronDown, ChevronUp, ExternalLink, GripHorizontal, Locate, Pin, X } from 'lucide-react';
import type { AssistantIntent, TranslationProfile } from '@yanyi/protocol';
import { assistantStyles } from '../assistant/assistantStyles';
import { ConversationPanel, ConversationProvider } from '../assistant/ConversationPanel';
import {
  createConversationHandoff,
  createConversationStore,
  type ConversationStoreApi,
} from '../assistant/conversationStore';
import { createBrowserAssistantAdapter } from '../assistant/browserAssistantAdapter';
import type { AssistantAdapter, ConversationContext, SelectionContext } from '../assistant/types';
import {
  anchorAfterScroll,
  beginDrag,
  COMPACT_SIZING,
  dragTo,
  EXPANDED_SIZING,
  resolvePosition,
  type DragState,
  type PopoverRect,
  type PositionMode,
} from './popoverPosition';

export type { PopoverRect } from './popoverPosition';

export interface SelectionPopoverMountOptions {
  ownerDocument: Document;
  anchorRect: PopoverRect;
  getAnchorRect?: () => PopoverRect;
  context: SelectionContext;
  intent: AssistantIntent;
  adapter?: AssistantAdapter;
  resolveProfile?: (intent: AssistantIntent) => TranslationProfile;
  autoStart?: boolean;
  onClose?: () => void;
}

export interface SelectionPopoverHandle {
  updateAnchor(rect: PopoverRect): void;
  focus(): void;
  close(): void;
}

function contextFromSelection(selection: SelectionContext): ConversationContext {
  return {
    selection: selection.text,
    title: selection.title,
    url: selection.url,
    tabId: selection.tabId,
    ...(selection.frameId === undefined ? {} : { frameId: selection.frameId }),
    capturedAt: selection.capturedAt,
    ...(selection.sentence === undefined ? {} : { sentence: selection.sentence }),
    ...(selection.adjacentText === undefined ? {} : { adjacentText: selection.adjacentText }),
    ...(selection.paragraph === undefined ? {} : { paragraph: selection.paragraph }),
    ...(selection.heading === undefined ? {} : { heading: selection.heading }),
    ...(selection.headingPath === undefined ? {} : { headingPath: selection.headingPath }),
    ...(selection.componentTitle === undefined ? {} : { componentTitle: selection.componentTitle }),
    ...(selection.componentText === undefined ? {} : { componentText: selection.componentText }),
    ...(selection.labels === undefined ? {} : { labels: selection.labels }),
    ...(selection.buttonText === undefined ? {} : { buttonText: selection.buttonText }),
    ...(selection.domRole === undefined ? {} : { domRole: selection.domRole }),
    ...(selection.domainId === undefined ? {} : { domainId: selection.domainId }),
    ...(selection.technicalTags === undefined ? {} : { technicalTags: selection.technicalTags }),
    ...(selection.glossaryRules === undefined ? {} : { glossaryRules: selection.glossaryRules }),
    ...(selection.contextHash === undefined ? {} : { contextHash: selection.contextHash }),
    ...(selection.pageSessionId === undefined ? {} : { pageSessionId: selection.pageSessionId }),
  };
}

function promptForIntent(intent: AssistantIntent): string {
  if (intent === 'translate') return '请精确翻译当前选区。';
  if (intent === 'explain') return '请结合当前页面语境解释所选内容。';
  return '';
}

const selectionPopoverStyles = String.raw`
:host {
  all: initial;
  color-scheme: light;
  --color-bg: #f7f9fc;
  --color-surface: #ffffff;
  --color-surface-subtle: #f1f5f9;
  --color-border: #e2e8f0;
  --color-border-strong: #cbd5e1;
  --color-text: #0f172a;
  --color-text-secondary: #475569;
  --color-text-muted: #64748b;
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-primary-soft: #eff6ff;
  --color-success: #16a34a;
  --color-warning: #d97706;
  --color-danger: #dc2626;
  --focus-ring: 0 0 0 3px rgb(37 99 235 / 25%);
  --font-sans: system-ui, 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', sans-serif;
  --font-mono: 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
}

.yanyi-selection-popover {
  position: fixed;
  display: grid;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--color-border-strong);
  border-radius: 11px;
  background: var(--color-bg);
  box-shadow: 0 18px 48px rgb(15 23 42 / 20%), 0 2px 8px rgb(15 23 42 / 10%);
  pointer-events: auto;
  grid-template-rows: auto minmax(0, 1fr);
}

.yanyi-selection-popover::before {
  position: absolute;
  z-index: 3;
  top: 0;
  right: 0;
  left: 0;
  height: 2px;
  background: var(--color-primary);
  content: '';
}

/* The header doubles as the drag handle. touch-action:none hands every pointer
   gesture to the drag logic instead of letting the page scroll or select. */
.yanyi-selection-popover__header {
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: 8px;
  padding: 7px 8px 7px 9px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.yanyi-selection-popover__header:active { cursor: grabbing; }

/* Buttons inside the handle keep normal cursors and stop drag propagation. */
.yanyi-selection-popover__header button { cursor: pointer; }

.yanyi-selection-popover__grip {
  display: grid;
  width: 22px;
  height: 25px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 6px;
  color: var(--color-text-muted);
}

.yanyi-selection-popover[data-position-mode='manual'] .yanyi-selection-popover__grip {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.yanyi-selection-popover__title {
  display: grid;
  min-width: 0;
  flex: 1;
  line-height: 1.2;
}

.yanyi-selection-popover__title strong { font-size: 11px; }
.yanyi-selection-popover__title span { color: var(--color-text-muted); font-size: 8px; }

.yanyi-selection-popover__header button {
  display: grid;
  width: 29px;
  height: 29px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
}

.yanyi-selection-popover__header button:hover,
.yanyi-selection-popover__header button[aria-pressed='true'] {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.yanyi-selection-popover__body { min-height: 0; overflow: hidden; }
.yanyi-selection-popover__body > .yanyi-conversation { height: 100%; }

@media (max-width: 320px) {
  .yanyi-selection-popover__title span { display: none; }
}
`;

interface SelectionPopoverProps {
  anchorRect: PopoverRect;
  getAnchorRect?: () => PopoverRect;
  host: HTMLElement;
  intent: AssistantIntent;
  autoStart: boolean;
  adapter: AssistantAdapter;
  store: ConversationStoreApi;
  resolveProfile?: (intent: AssistantIntent) => TranslationProfile;
  close: () => void;
}

function SelectionPopover({
  anchorRect,
  getAnchorRect,
  host,
  intent,
  autoStart,
  adapter,
  store,
  resolveProfile,
  close,
}: SelectionPopoverProps) {
  const ownerWindow = host.ownerDocument.defaultView;
  const [pinned, setPinned] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [positionMode, setPositionMode] = useState<PositionMode>('anchored');
  const [manualOffset, setManualOffset] = useState<{ left: number; top: number }>();
  const [viewportRevision, setViewportRevision] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<DragState | undefined>(undefined);
  const scrollOrigin = useRef({
    x: ownerWindow?.scrollX ?? 0,
    y: ownerWindow?.scrollY ?? 0,
  });
  const currentAnchor = useMemo(() => {
    if (getAnchorRect !== undefined) {
      try {
        return getAnchorRect();
      } catch {
        return anchorRect;
      }
    }
    return anchorAfterScroll(anchorRect, scrollOrigin.current, {
      x: ownerWindow?.scrollX ?? 0,
      y: ownerWindow?.scrollY ?? 0,
    });
    // viewportRevision re-derives the anchor after scroll and resize.
  }, [anchorRect, getAnchorRect, ownerWindow, viewportRevision]);
  const viewport = {
    width: ownerWindow?.innerWidth ?? 1024,
    height: ownerWindow?.innerHeight ?? 768,
  };
  const sizing = expanded ? EXPANDED_SIZING : COMPACT_SIZING;
  const position = resolvePosition({
    mode: positionMode,
    anchor: currentAnchor,
    ...(manualOffset === undefined ? {} : { manualOffset }),
    viewport,
    sizing,
  });
  const style: CSSProperties = {
    left: position.left,
    top: position.top,
    width: position.width,
    maxHeight: position.maxHeight,
    height: position.maxHeight,
  };

  /**
   * Drag runs on pointer events captured by the header handle, so it works for
   * mouse, pen and touch alike. Capturing the pointer keeps the gesture even if
   * it leaves the handle, and `preventDefault` stops the page selecting text
   * underneath while dragging.
   */
  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || dragState.current !== undefined) return;
      event.preventDefault();
      event.stopPropagation();
      dragState.current = beginDrag(event, { left: position.left, top: position.top });
      event.currentTarget.setPointerCapture(event.pointerId);
      setPositionMode('manual');
      setManualOffset({ left: position.left, top: position.top });
    },
    [position.left, position.top],
  );

  const onHandlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragState.current;
      if (state?.pointerId !== event.pointerId) return;
      event.preventDefault();
      const next = dragTo(state, event, viewport, sizing);
      setManualOffset({ left: next.left, top: next.top });
    },
    [sizing, viewport.height, viewport.width],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const restoreAnchor = useCallback(() => {
    dragState.current = undefined;
    setPositionMode('anchored');
    setManualOffset(undefined);
  }, []);

  useLayoutEffect(() => {
    if (intent === 'follow_up') {
      popoverRef.current?.querySelector<HTMLTextAreaElement>('#yanyi-follow-up')?.focus({
        preventScroll: true,
      });
    } else {
      popoverRef.current?.focus({ preventScroll: true });
    }
  }, [intent]);

  useEffect(() => {
    if (ownerWindow === null) return;
    const updatePosition = () => setViewportRevision((value) => value + 1);
    ownerWindow.addEventListener('resize', updatePosition);
    ownerWindow.addEventListener('scroll', updatePosition, true);
    return () => {
      ownerWindow.removeEventListener('resize', updatePosition);
      ownerWindow.removeEventListener('scroll', updatePosition, true);
    };
  }, [ownerWindow]);

  useEffect(() => {
    const ownerDocument = host.ownerDocument;
    const onPointerDown = (event: PointerEvent) => {
      if (pinned || event.composedPath().includes(host)) return;
      close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    ownerDocument.addEventListener('pointerdown', onPointerDown, true);
    ownerDocument.addEventListener('keydown', onKeyDown, true);
    return () => {
      ownerDocument.removeEventListener('pointerdown', onPointerDown, true);
      ownerDocument.removeEventListener('keydown', onKeyDown, true);
    };
  }, [close, host, pinned]);

  const autoPrompt = autoStart
    ? {
        key: `${intent}:${store.getState().context.selection}`,
        prompt: promptForIntent(intent),
        intent,
      }
    : undefined;

  return (
    <>
      <style>{assistantStyles + selectionPopoverStyles}</style>
      <section
        aria-label="研译选区助手"
        aria-modal="false"
        className="yanyi-selection-popover yanyi-theme"
        data-placement={position.placement}
        data-position-mode={positionMode}
        ref={popoverRef}
        role="dialog"
        style={style}
        tabIndex={-1}
      >
        <header
          className="yanyi-selection-popover__header"
          data-drag-handle="true"
          onPointerCancel={endDrag}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={endDrag}
        >
          <span aria-hidden="true" className="yanyi-selection-popover__grip" title="拖动移动浮窗">
            <GripHorizontal size={13} />
          </span>
          <div className="yanyi-selection-popover__title">
            <strong>{intent === 'translate' ? '精确翻译' : '询问研译'}</strong>
            <span>{positionMode === 'manual' ? '手动位置 · 可恢复锚定' : '跟随选区'}</span>
          </div>
          {positionMode === 'manual' && (
            <button
              aria-label="恢复自动定位"
              onClick={restoreAnchor}
              onPointerDown={(event) => event.stopPropagation()}
              title="恢复自动定位"
              type="button"
            >
              <Locate aria-hidden="true" size={14} />
            </button>
          )}
          <button
            aria-expanded={expanded}
            aria-label={expanded ? '收起高级设置' : '展开高级设置'}
            onClick={() => setExpanded((value) => !value)}
            onPointerDown={(event) => event.stopPropagation()}
            title={expanded ? '收起高级设置' : '展开高级设置'}
            type="button"
          >
            {expanded ? (
              <ChevronUp aria-hidden="true" size={14} />
            ) : (
              <ChevronDown aria-hidden="true" size={14} />
            )}
          </button>
          <button
            aria-label={pinned ? '取消固定浮窗' : '固定浮窗'}
            aria-pressed={pinned}
            onClick={() => setPinned((value) => !value)}
            onPointerDown={(event) => event.stopPropagation()}
            title={pinned ? '取消固定' : '固定'}
            type="button"
          >
            <Pin aria-hidden="true" size={14} />
          </button>
          <button
            aria-label="展开到侧边栏"
            onClick={() => {
              // Hands the live conversation over rather than restarting it, so
              // expanding never re-requests an answer.
              void (async () => {
                await adapter.saveHandoff(createConversationHandoff(store.getState()));
                if (await adapter.openSidePanel()) close();
              })();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            title="展开到侧边栏"
            type="button"
          >
            <ExternalLink aria-hidden="true" size={14} />
          </button>
          <button
            aria-label="关闭"
            onClick={close}
            onPointerDown={(event) => event.stopPropagation()}
            title="关闭"
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </header>
        <div className="yanyi-selection-popover__body">
          <ConversationProvider
            adapter={adapter}
            store={store}
            {...(resolveProfile === undefined ? {} : { resolveProfile })}
          >
            <ConversationPanel
              {...(autoPrompt === undefined ? {} : { autoPrompt })}
              compact={!expanded}
              quickIntents
            />
          </ConversationProvider>
        </div>
      </section>
    </>
  );
}

export function mountSelectionPopover(
  options: SelectionPopoverMountOptions,
): SelectionPopoverHandle {
  const host = options.ownerDocument.createElement('div');
  host.dataset.yanyiOwned = 'true';
  host.setAttribute('aria-live', 'off');
  Object.assign(host.style, {
    all: 'initial',
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });
  const shadow = host.attachShadow({ mode: 'open' });
  const mountPoint = options.ownerDocument.createElement('div');
  shadow.append(mountPoint);
  options.ownerDocument.body.append(host);

  const adapter = options.adapter ?? createBrowserAssistantAdapter();
  const store = createConversationStore({ context: contextFromSelection(options.context) });
  const root: Root = createRoot(mountPoint);
  let anchorRect = options.anchorRect;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.unmount();
    host.remove();
    options.onClose?.();
  };
  const render = () => {
    root.render(
      <SelectionPopover
        adapter={adapter}
        anchorRect={anchorRect}
        autoStart={options.autoStart ?? options.intent !== 'follow_up'}
        close={close}
        host={host}
        intent={options.intent}
        store={store}
        {...(options.getAnchorRect === undefined ? {} : { getAnchorRect: options.getAnchorRect })}
        {...(options.resolveProfile === undefined
          ? {}
          : { resolveProfile: options.resolveProfile })}
      />,
    );
  };
  render();
  return {
    updateAnchor(rect) {
      if (closed) return;
      anchorRect = rect;
      render();
    },
    focus() {
      shadow.querySelector<HTMLTextAreaElement>('#yanyi-follow-up')?.focus();
    },
    close,
  };
}

export { anchoredPosition as calculatePosition } from './popoverPosition';
