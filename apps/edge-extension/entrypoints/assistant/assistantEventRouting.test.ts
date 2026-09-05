import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ProtocolEnvelope } from '@yanyi/protocol';
import {
  assistantEventTargets,
  assistantTaskIdForEvent,
  assistantTaskOrigin,
  isTerminalAssistantEvent,
  lifecyclePhaseForEvent,
} from './assistantEventRouting';

function envelope(type: string, payload: Record<string, unknown> = {}): ProtocolEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'request-1',
    type: type as ProtocolEnvelope['type'],
    sequence: 0,
    done: false,
    payload,
  };
}

describe('assistantEventTargets', () => {
  it('delivers to the originating tab so the in-page popover leaves its initial state', () => {
    // runtime.sendMessage alone never reaches a content script.
    expect(assistantEventTargets({ tabId: 12, frameId: 3 })).toStrictEqual({
      runtime: true,
      tab: { tabId: 12, frameId: 3 },
    });
  });

  it('omits the frame when the origin did not record one', () => {
    expect(assistantEventTargets({ tabId: 12 })).toStrictEqual({
      runtime: true,
      tab: { tabId: 12 },
    });
  });

  it('falls back to extension pages only when no tab is known', () => {
    expect(assistantEventTargets(undefined)).toStrictEqual({ runtime: true });
    expect(assistantEventTargets({})).toStrictEqual({ runtime: true });
  });
});

describe('assistantTaskOrigin', () => {
  it('keeps the sender frame for popover requests', () => {
    expect(
      assistantTaskOrigin({ senderTabId: 7, senderFrameId: 2, contextTabId: 7 }),
    ).toStrictEqual({ tabId: 7, frameId: 2 });
  });

  it('uses the captured context tab for Side Panel requests without a sender tab', () => {
    // The Side Panel is an extension page: it has no sender.tab, but its context
    // remembers which tab the selection came from.
    expect(assistantTaskOrigin({ contextTabId: 9 })).toStrictEqual({ tabId: 9 });
  });

  it('does not attribute an extension-page frame id to a tab', () => {
    expect(assistantTaskOrigin({ senderFrameId: 0, contextTabId: 9 })).toStrictEqual({ tabId: 9 });
  });

  it('returns an empty origin when nothing identifies a tab', () => {
    expect(assistantTaskOrigin({})).toStrictEqual({});
  });
});

describe('assistant lifecycle mapping', () => {
  it('maps protocol events onto one shared request lifecycle', () => {
    expect(lifecyclePhaseForEvent('assistant.accepted')).toBe('request_queued');
    expect(lifecyclePhaseForEvent('assistant.delta')).toBe('streaming');
    expect(lifecyclePhaseForEvent('assistant.completed')).toBe('completed');
    expect(lifecyclePhaseForEvent('assistant.failed')).toBe('failed');
    expect(lifecyclePhaseForEvent('assistant.cancelled')).toBe('cancelled');
    expect(lifecyclePhaseForEvent('translation.progress')).toBeUndefined();
  });

  it('recognises terminal events that must be remembered for late subscribers', () => {
    expect(isTerminalAssistantEvent(envelope('assistant.completed'))).toBe(true);
    expect(isTerminalAssistantEvent(envelope('assistant.failed'))).toBe(true);
    expect(isTerminalAssistantEvent(envelope('assistant.cancelled'))).toBe(true);
    expect(isTerminalAssistantEvent(envelope('assistant.delta'))).toBe(false);
  });

  it('reads the task id from the payload and falls back to the idempotency key', () => {
    expect(assistantTaskIdForEvent(envelope('assistant.delta', { taskId: 'task-1' }))).toBe(
      'task-1',
    );
    expect(assistantTaskIdForEvent({ ...envelope('system.error'), idempotencyKey: 'task-2' })).toBe(
      'task-2',
    );
    expect(assistantTaskIdForEvent(envelope('system.error'))).toBe('');
  });
});
