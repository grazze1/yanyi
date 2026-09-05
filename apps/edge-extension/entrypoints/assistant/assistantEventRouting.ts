import type { ProtocolEnvelope } from '@yanyi/protocol';

/**
 * Where an assistant request was started from. The service worker can reach
 * extension pages (popup / Side Panel / options) with `runtime.sendMessage`, but
 * that API never reaches a content script. The selection popover runs inside the
 * content script, so its tab must be addressed explicitly.
 */
export interface AssistantTaskOrigin {
  tabId?: number;
  frameId?: number;
}

export type AssistantLifecyclePhase =
  'request_queued' | 'context_collecting' | 'streaming' | 'completed' | 'failed' | 'cancelled';

const TERMINAL_TYPES = new Set(['assistant.completed', 'assistant.failed', 'assistant.cancelled']);

/** Terminal events must be remembered so a late subscriber can still settle. */
export function isTerminalAssistantEvent(event: ProtocolEnvelope): boolean {
  return TERMINAL_TYPES.has(event.type);
}

/** Maps a protocol event onto the shared request lifecycle. */
export function lifecyclePhaseForEvent(type: string): AssistantLifecyclePhase | undefined {
  switch (type) {
    case 'assistant.accepted':
      return 'request_queued';
    case 'assistant.context.ready':
      return 'context_collecting';
    case 'assistant.delta':
      return 'streaming';
    case 'assistant.completed':
      return 'completed';
    case 'assistant.failed':
      return 'failed';
    case 'assistant.cancelled':
      return 'cancelled';
    default:
      return undefined;
  }
}

export function assistantTaskIdForEvent(event: ProtocolEnvelope): string {
  const payload = event.payload as { taskId?: unknown };
  if (typeof payload.taskId === 'string' && payload.taskId.length > 0) return payload.taskId;
  return typeof event.idempotencyKey === 'string' ? event.idempotencyKey : '';
}

export interface AssistantEventTargets {
  /** Extension pages: popup, Side Panel, options. */
  runtime: boolean;
  /** Content script hosting the selection popover, when the task came from a page. */
  tab?: { tabId: number; frameId?: number };
}

/**
 * Resolves every surface that must observe one assistant event. Extension pages
 * always receive it; the originating tab is added so the in-page popover follows
 * the same request lifecycle instead of stalling on its initial state.
 */
export function assistantEventTargets(
  origin: AssistantTaskOrigin | undefined,
): AssistantEventTargets {
  if (origin?.tabId === undefined) return { runtime: true };
  return {
    runtime: true,
    tab: {
      tabId: origin.tabId,
      ...(origin.frameId === undefined ? {} : { frameId: origin.frameId }),
    },
  };
}

/**
 * Chooses the origin to remember for a task. A request raised by the popover
 * carries the sender tab and frame; one raised by the Side Panel or popup only
 * knows the tab its context was captured from, and has no frame of its own.
 */
export function assistantTaskOrigin(input: {
  senderTabId?: number;
  senderFrameId?: number;
  contextTabId?: number;
}): AssistantTaskOrigin {
  const tabId = input.senderTabId ?? input.contextTabId;
  if (tabId === undefined) return {};
  const fromContentScript = input.senderTabId !== undefined;
  return {
    tabId,
    ...(fromContentScript && input.senderFrameId !== undefined
      ? { frameId: input.senderFrameId }
      : {}),
  };
}
