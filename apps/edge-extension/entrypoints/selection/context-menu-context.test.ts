import { describe, expect, it } from 'vitest';
import { buildContextMenuSelection } from './context-menu-context';

describe('buildContextMenuSelection', () => {
  it('preserves an iframe selection anchor and its complete context contract', () => {
    const result = buildContextMenuSelection({
      locatedContext: {
        text: 'selected frame text',
        sentence: 'A complete selected frame sentence.',
        paragraph: 'A complete selected frame sentence. More context follows.',
        headingPath: ['Guide', 'GPU setup'],
        domainId: 'domain-ai-ml',
        technicalTags: ['PyTorch', 'GPU'],
        glossaryRules: ['tensor -> 张量'],
        contextHash: 'ctx-v1-frame',
        title: 'Embedded guide',
        url: 'https://example.test/frame',
        isPdf: false,
        pageSessionId: 'page-frame-1',
      },
      canLocateSelection: true,
      fallbackText: 'browser fallback text',
      intent: 'explain',
      tab: { id: 17, title: 'Top page', url: 'https://example.test/' },
      frameId: 4,
      capturedAt: 1_700_000_000_000,
    });

    expect(result).toEqual({
      canLocateSelection: true,
      context: expect.objectContaining({
        text: 'selected frame text',
        headingPath: ['Guide', 'GPU setup'],
        domainId: 'domain-ai-ml',
        technicalTags: ['PyTorch', 'GPU'],
        glossaryRules: ['tensor -> 张量'],
        contextHash: 'ctx-v1-frame',
        pageSessionId: 'page-frame-1',
        tabId: 17,
        frameId: 4,
        capturedAt: 1_700_000_000_000,
        intent: 'explain',
      }),
    });
  });

  it('falls back to browser selection text for an uninjectable PDF and disables popover anchoring', () => {
    const result = buildContextMenuSelection({
      locatedContext: undefined,
      canLocateSelection: false,
      fallbackText: 'PDF selection supplied by Edge',
      intent: 'translate',
      tab: {
        id: 31,
        title: 'GPU paper',
        url: 'https://papers.example.test/gpu.pdf#page=4',
      },
      frameId: 0,
      capturedAt: 1_700_000_000_001,
    });

    expect(result).toEqual({
      canLocateSelection: false,
      context: expect.objectContaining({
        text: 'PDF selection supplied by Edge',
        sentence: 'PDF selection supplied by Edge',
        paragraph: 'PDF selection supplied by Edge',
        title: 'GPU paper',
        url: 'https://papers.example.test/gpu.pdf#page=4',
        isPdf: true,
        tabId: 31,
        frameId: 0,
        intent: 'translate',
      }),
    });
  });

  it('uses the browser fallback when a frame responds without a selected text snapshot', () => {
    const result = buildContextMenuSelection({
      locatedContext: { text: '', title: 'Frame title', url: 'about:srcdoc', isPdf: false },
      canLocateSelection: true,
      fallbackText: 'Selection retained by the context-menu event',
      intent: 'follow-up',
      tab: { id: 9 },
      frameId: 2,
      capturedAt: 1,
    });

    expect(result?.canLocateSelection).toBe(false);
    expect(result?.context.text).toBe('Selection retained by the context-menu event');
  });

  it('does not create a context when neither source contains selection text', () => {
    expect(
      buildContextMenuSelection({
        locatedContext: {},
        canLocateSelection: false,
        intent: 'translate',
        tab: { id: 1 },
        frameId: 0,
        capturedAt: 1,
      }),
    ).toBeUndefined();
  });
});
