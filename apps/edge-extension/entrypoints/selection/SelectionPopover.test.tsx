import { act, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantAdapter } from '../assistant/types';
import { calculatePosition, mountSelectionPopover } from './SelectionPopover';

function adapter(): AssistantAdapter {
  return {
    start: vi.fn(() => Promise.resolve({ accepted: true, taskId: 'task-1' })),
    cancel: vi.fn(() => Promise.resolve(true)),
    subscribe: vi.fn(() => () => undefined),
    consumeSelection: vi.fn(() => Promise.resolve(undefined)),
    loadHandoff: vi.fn(() => Promise.resolve(undefined)),
    saveHandoff: vi.fn(() => Promise.resolve()),
    openSidePanel: vi.fn(() => Promise.resolve(true)),
    highlightSource: vi.fn(() => Promise.resolve(true)),
    saveNote: vi.fn(() => Promise.resolve(true)),
    saveGlossary: vi.fn(() => Promise.resolve(true)),
    protectTerm: vi.fn(() => Promise.resolve(true)),
    loadModelCatalog: vi.fn(() => Promise.resolve([])),
    loadModelSelection: vi.fn(() => Promise.resolve(undefined)),
    saveModelSelection: vi.fn(() => Promise.resolve(true)),
  };
}

const anchor = { top: 300, right: 520, bottom: 340, left: 240, width: 280, height: 40 };
const context = {
  text: 'selected text',
  paragraph: 'selected text in a paragraph',
  heading: 'Section 3.2',
  title: 'Technical report',
  url: 'https://example.com/paper',
  isPdf: false,
  intent: 'follow-up',
  tabId: 1,
  capturedAt: 1,
};

describe('SelectionPopover', () => {
  it('flips above and stays inside a narrow viewport', () => {
    const position = calculatePosition(
      { top: 640, right: 400, bottom: 680, left: 200, width: 200, height: 40 },
      { width: 420, height: 700 },
    );
    expect(position.placement).toBe('above');
    expect(position.left).toBeGreaterThanOrEqual(8);
    expect(position.left + position.width).toBeLessThanOrEqual(412);
    expect(position.top).toBeGreaterThanOrEqual(8);
  });

  it('mounts an owned Shadow DOM dialog and closes on Escape', () => {
    const onClose = vi.fn();
    let handle: ReturnType<typeof mountSelectionPopover>;
    act(() => {
      handle = mountSelectionPopover({
        ownerDocument: document,
        anchorRect: anchor,
        context,
        intent: 'follow_up',
        adapter: adapter(),
        autoStart: false,
        onClose,
      });
    });
    const host = document.querySelector<HTMLElement>('[data-yanyi-owned="true"]');
    const shadow = host?.shadowRoot;
    expect(shadow?.querySelector('[role="dialog"]')).not.toBeNull();
    expect(shadow?.querySelector('[aria-label="模型供应商"]')).not.toBeNull();
    expect(shadow?.querySelector('[aria-label="会话模型"]')).not.toBeNull();
    expect(shadow?.querySelector('[aria-label="思考模式"]')).not.toBeNull();
    expect(shadow?.querySelector('[aria-label="回答知识范围"]')).not.toBeNull();
    expect(shadow?.querySelector('[aria-label="发送"]')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-yanyi-owned="true"]')).toBeNull();
    handle!.close();
  });

  it('does not close on outside click while pinned', () => {
    const onClose = vi.fn();
    let handle: ReturnType<typeof mountSelectionPopover>;
    act(() => {
      handle = mountSelectionPopover({
        ownerDocument: document,
        anchorRect: anchor,
        context,
        intent: 'follow_up',
        adapter: adapter(),
        autoStart: false,
        onClose,
      });
    });
    const host = document.querySelector<HTMLElement>('[data-yanyi-owned="true"]');
    const pin = host?.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="固定浮窗"]');
    expect(pin).not.toBeNull();
    fireEvent.click(pin!);
    fireEvent.pointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
    act(() => handle!.close());
  });

  it('automatically starts translate and explain intents', async () => {
    const transport = adapter();
    const start = vi.spyOn(transport, 'start');
    let handle: ReturnType<typeof mountSelectionPopover>;
    act(() => {
      handle = mountSelectionPopover({
        ownerDocument: document,
        anchorRect: anchor,
        context: { ...context, intent: 'explain' },
        intent: 'explain',
        adapter: transport,
      });
    });
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({ intent: 'explain', knowledgeMode: 'hybrid' }),
      ),
    );
    act(() => handle!.close());
  });
});
