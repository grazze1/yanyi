import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { createEnvelope } from '@yanyi/protocol';
import { createBrowserAssistantAdapter } from './browserAssistantAdapter';

const messageListeners = new Set<(message: unknown) => void>();
const { localStorageGet, localStorageSet } = vi.hoisted(() => ({
  localStorageGet: vi.fn(),
  localStorageSet: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) =>
          messageListeners.add(listener),
        ),
        removeListener: vi.fn((listener: (message: unknown) => void) =>
          messageListeners.delete(listener),
        ),
      },
    },
    storage: {
      local: {
        get: localStorageGet,
        set: localStorageSet,
        remove: vi.fn(),
      },
      session: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
      },
    },
    tabs: { sendMessage: vi.fn() },
  },
}));

describe('createBrowserAssistantAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageListeners.clear();
  });

  it('maps the complete browser context to the native assistant contract', async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      accepted: true,
      taskId: 'task-1',
    } as never);
    const adapter = createBrowserAssistantAdapter();

    await adapter.start({
      clientRequestId: 'client-1',
      knowledgeMode: 'hybrid',
      intent: 'explain',
      prompt: 'Explain this result',
      context: {
        selection: 'selected text',
        sentence: 'complete sentence',
        adjacentText: 'previous and next sentence',
        paragraph: 'complete paragraph',
        heading: 'Current heading',
        headingPath: ['Paper', 'Method'],
        componentTitle: 'Result card',
        componentText: 'Card body',
        labels: ['accuracy', 'validation'],
        buttonText: 'Show details',
        domRole: 'button',
        domainId: 'domain-ai-ml',
        technicalTags: ['reinforcement-learning', 'gpu'],
        glossaryRules: ['policy -> 策略'],
        contextHash: 'ctx-v1-f91675090c',
        title: 'Technical report',
        url: 'https://example.com/paper?secret=1#private',
        tabId: 73,
        pageSessionId: 'page-session-1',
        capturedAt: 1_700_000_000_000,
      },
      profile: {
        providerId: 'deepseek',
        model: 'deepseek-v4-pro',
        thinking: 'enabled',
        reasoningEffort: 'high',
        maxOutputTokens: 8_192,
        streaming: true,
      },
    });

    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'yanyi.assistant.start',
      payload: expect.objectContaining({
        intent: 'explain',
        context: {
          selection: 'selected text',
          sentence: 'complete sentence',
          adjacentSentences: ['previous and next sentence'],
          paragraph: 'complete paragraph',
          heading: 'Current heading',
          sectionPath: ['Paper', 'Method'],
          componentTitle: 'Result card',
          componentBody: 'Card body',
          labels: ['accuracy', 'validation'],
          buttons: ['Show details'],
          domRole: 'button',
          domainId: 'domain-ai-ml',
          technicalTags: ['reinforcement-learning', 'gpu'],
          glossaryRules: ['policy -> 策略'],
          contextHash: 'ctx-v1-f91675090c',
          title: 'Technical report',
          url: 'https://example.com/paper',
          tabId: 73,
          pageSessionId: 'page-session-1',
          capturedAt: 1_700_000_000_000,
        },
      }),
    });
  });

  it('requests a one-shot selection launch and rejects legacy persistent selections', async () => {
    const adapter = createBrowserAssistantAdapter();
    const selection = {
      launchToken: '10000000-0000-4000-8000-000000000001',
      text: 'Selected text',
      title: 'Technical report',
      url: 'https://example.com/report',
      isPdf: false,
      intent: 'explain',
      tabId: 73,
      capturedAt: 1_700_000_000_000,
    };
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ context: selection } as never)
      .mockResolvedValueOnce({ context: undefined } as never)
      .mockResolvedValueOnce({ context: { ...selection, launchToken: undefined } } as never);

    await expect(adapter.consumeSelection()).resolves.toEqual(selection);
    await expect(adapter.consumeSelection()).resolves.toBeUndefined();
    await expect(adapter.consumeSelection()).resolves.toBeUndefined();
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      type: 'yanyi.selection.consume',
    });
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'yanyi.selection.consume',
    });
  });

  it('preserves the provider and API profile returned by model selection resolution', async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      accepted: true,
      selection: {
        scope: 'conversation',
        scopeId: 'conversation-1',
        task: 'explanation',
        providerId: 'deepseek',
        apiProfileId: 'deepseek-default',
        modelId: 'deepseek-v4-pro',
        thinkingEnabled: true,
        reasoningEffort: 'max',
      },
    } as never);

    await expect(
      createBrowserAssistantAdapter().loadModelSelection('conversation-1', 'explanation'),
    ).resolves.toEqual({
      scope: 'conversation',
      scopeId: 'conversation-1',
      task: 'explanation',
      providerId: 'deepseek',
      apiProfileId: 'deepseek-default',
      modelId: 'deepseek-v4-pro',
      thinkingEnabled: true,
      reasoningEffort: 'max',
    });
  });

  it('delivers a terminal assistant failure replay without leaving the store streaming', async () => {
    const event = createEnvelope(
      'assistant.failed',
      {
        taskId: 'task-failed',
        error: { message: '所选模型不可用。' },
      },
      {
        requestId: '10000000-0000-4000-8000-000000000001',
        idempotencyKey: 'task-failed',
        done: true,
      },
    );
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ event } as never);

    await expect(
      createBrowserAssistantAdapter().loadTerminalEvent?.('task-failed'),
    ).resolves.toEqual({
      type: 'failed',
      taskId: 'task-failed',
      message: '所选模型不可用。',
    });
  });

  it('persists only a content-free active conversation reference, keyed by site origin', async () => {
    localStorageGet.mockResolvedValue({});
    const adapter = createBrowserAssistantAdapter();
    await adapter.saveActiveConversation?.(
      {
        conversationId: 'conversation-1',
        knowledgeMode: 'hybrid',
        savedAt: 1_700_000_000_000,
      },
      'https://developer.nvidia.com/blog/post-a?token=secret',
    );

    expect(localStorageSet).toHaveBeenCalledWith({
      'yanyi.assistant.active-conversation-by-site.v1': {
        'https://developer.nvidia.com': {
          conversationId: 'conversation-1',
          knowledgeMode: 'hybrid',
          savedAt: 1_700_000_000_000,
        },
      },
    });
    const serialized = JSON.stringify(localStorageSet.mock.calls[0]);
    // Neither page content nor the full URL (which may carry tokens) is stored.
    expect(serialized).not.toMatch(/secret|post-a/u);
    expect(serialized).not.toMatch(
      /selection|paragraph|adjacent|title|heading|url|messages|citations/u,
    );
  });

  it('reads back the conversation for the requested origin only', async () => {
    localStorageGet.mockResolvedValue({
      'yanyi.assistant.active-conversation-by-site.v1': {
        'https://developer.nvidia.com': {
          conversationId: 'nvidia-conversation',
          knowledgeMode: 'hybrid',
          savedAt: 1_700_000_000_000,
        },
        'https://docs.pytorch.org': {
          conversationId: 'pytorch-conversation',
          knowledgeMode: 'hybrid',
          savedAt: 1_700_000_000_001,
        },
      },
    });
    const adapter = createBrowserAssistantAdapter();

    // Any page of the same site resolves to that site's conversation.
    await expect(
      adapter.loadActiveConversation?.('https://developer.nvidia.com/blog/post-b'),
    ).resolves.toMatchObject({ conversationId: 'nvidia-conversation' });
    await expect(
      adapter.loadActiveConversation?.('https://docs.pytorch.org/stable/index.html'),
    ).resolves.toMatchObject({ conversationId: 'pytorch-conversation' });
    // An unrelated site has no conversation, so nothing is reused across sites.
    await expect(
      adapter.loadActiveConversation?.('https://example.com/a'),
    ).resolves.toBeUndefined();
    // Pages without a usable origin are never site scoped.
    await expect(adapter.loadActiveConversation?.('about:blank')).resolves.toBeUndefined();
  });

  it('sends the site origin so the host can reuse this site conversation', async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      accepted: true,
      taskId: 'task-2',
    } as never);
    await createBrowserAssistantAdapter().start({
      clientRequestId: 'client-2',
      knowledgeMode: 'hybrid',
      intent: 'follow_up',
      prompt: 'Continue',
      context: { selection: 'text', url: 'https://developer.nvidia.com/blog/post-a' },
      profile: { model: 'deepseek-v4-pro', thinking: 'disabled' },
    });

    const payload = vi.mocked(browser.runtime.sendMessage).mock.calls[0]?.[0] as unknown as {
      payload: { siteOrigin?: string };
    };
    expect(payload.payload.siteOrigin).toBe('https://developer.nvidia.com');
  });

  it('clearing a site conversation asks the host to start a new thread', async () => {
    localStorageGet.mockResolvedValue({
      'yanyi.assistant.active-conversation-by-site.v1': {
        'https://developer.nvidia.com': {
          conversationId: 'nvidia-conversation',
          knowledgeMode: 'hybrid',
          savedAt: 1,
        },
      },
    });
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ accepted: true } as never);

    await createBrowserAssistantAdapter().clearActiveConversation?.(
      'https://developer.nvidia.com/blog/post-a',
    );

    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'yanyi.conversation.site.new',
      siteOrigin: 'https://developer.nvidia.com',
    });
  });

  it('restores paginated SQLite messages and normalized citations', async () => {
    const first = createEnvelope(
      'conversation.get.ready',
      {
        conversation: {
          conversation: { id: 'conversation-1', knowledgeMode: 'page_only' },
          resumeContextJson: JSON.stringify({
            context: {
              selection: 'The controller remains stable.',
              heading: 'Methods',
              url: 'https://example.com/paper?token=secret#private',
              adjacentSentences: ['Before.', 'After.'],
            },
          }),
          messages: [
            {
              id: 'message-1',
              role: 'user',
              content: '解释这个结论',
              intent: 'explain',
              generationStatus: 'completed',
              createdAt: '2026-08-08T10:00:00Z',
              citations: [],
            },
            {
              id: 'message-2',
              role: 'assistant',
              content: '结论来自当前页面。',
              intent: 'explain',
              generationStatus: 'completed',
              createdAt: '2026-08-08T10:00:01Z',
              citations: [
                {
                  id: 'citation-1',
                  sourceKind: 'page',
                  sourceId: 'section:methods',
                  sourceTitle: 'Methods',
                  sourceExcerpt: 'The controller remains stable.',
                },
              ],
            },
          ],
          hasMore: true,
        },
      },
      { requestId: '10000000-0000-4000-8000-000000000002', done: true },
    );
    const second = createEnvelope(
      'conversation.get.ready',
      {
        conversation: {
          conversation: { id: 'conversation-1', knowledgeMode: 'page_only' },
          messages: [
            {
              id: 'message-3',
              role: 'assistant',
              content: '',
              intent: 'follow_up',
              generationStatus: 'streaming',
              createdAt: '2026-08-08T10:00:02Z',
              citations: [],
            },
          ],
          hasMore: false,
        },
      },
      { requestId: '10000000-0000-4000-8000-000000000003', done: true },
    );
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ event: first } as never)
      .mockResolvedValueOnce({ event: second } as never);

    await expect(
      createBrowserAssistantAdapter().loadConversation?.('conversation-1'),
    ).resolves.toEqual({
      conversationId: 'conversation-1',
      knowledgeMode: 'page_only',
      context: {
        selection: 'The controller remains stable.',
        heading: 'Methods',
        url: 'https://example.com/paper',
        adjacentText: 'Before.\nAfter.',
      },
      messages: [
        expect.objectContaining({ id: 'message-1', role: 'user', status: 'complete' }),
        expect.objectContaining({
          id: 'message-2',
          role: 'assistant',
          status: 'complete',
          citations: [
            {
              id: 'citation-1',
              title: 'Methods',
              excerpt: 'The controller remains stable.',
              source: 'page',
              locator: 'section:methods',
            },
          ],
        }),
        expect.objectContaining({
          id: 'message-3',
          status: 'failed',
          error: '上次生成在浏览器关闭时中断，请重试。',
        }),
      ],
    });
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ messageOffset: 0, messageLimit: 200 }),
    );
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ messageOffset: 2, messageLimit: 200 }),
    );
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      type: 'yanyi.conversation.get',
      conversationId: 'conversation-1',
      messageOffset: 0,
      messageLimit: 200,
    });
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'yanyi.conversation.get',
      conversationId: 'conversation-1',
      messageOffset: 2,
      messageLimit: 200,
    });
  });
});
