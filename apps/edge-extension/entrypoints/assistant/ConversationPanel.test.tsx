import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ConversationPanel,
  ConversationProvider,
  requestScopedModelSelection,
} from './ConversationPanel';
import { createConversationStore } from './conversationStore';
import type {
  AssistantAdapter,
  AssistantModelOption,
  AssistantModelSelection,
  AssistantStreamEvent,
  ConversationMessage,
} from './types';

function createAdapter(models: AssistantModelOption[] = []) {
  const listeners = new Set<(event: AssistantStreamEvent) => void>();
  const start = vi.fn<AssistantAdapter['start']>(() =>
    Promise.resolve({ accepted: true, taskId: 'task-1', conversationId: 'chat-1' }),
  );
  const cancel = vi.fn<AssistantAdapter['cancel']>(() => Promise.resolve(true));
  const saveModelSelection = vi.fn<AssistantAdapter['saveModelSelection']>(() =>
    Promise.resolve(true),
  );
  const verifyModelCapability = vi.fn<NonNullable<AssistantAdapter['verifyModelCapability']>>(() =>
    Promise.resolve({ status: 'verified', message: '模型验证通过。', models: [] }),
  );
  const saveActiveConversation = vi.fn<NonNullable<AssistantAdapter['saveActiveConversation']>>(
    () => Promise.resolve(),
  );
  const clearActiveConversation = vi.fn<NonNullable<AssistantAdapter['clearActiveConversation']>>(
    () => Promise.resolve(),
  );
  const emit = (event: AssistantStreamEvent) => {
    listeners.forEach((listener) => listener(event));
  };
  const adapter: AssistantAdapter = {
    start,
    cancel,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    consumeSelection: vi.fn(() => Promise.resolve(undefined)),
    loadHandoff: vi.fn(() => Promise.resolve(undefined)),
    saveHandoff: vi.fn(() => Promise.resolve()),
    saveActiveConversation,
    clearActiveConversation,
    openSidePanel: vi.fn(() => Promise.resolve(true)),
    highlightSource: vi.fn(() => Promise.resolve(true)),
    saveNote: vi.fn(() => Promise.resolve(true)),
    saveGlossary: vi.fn(() => Promise.resolve(true)),
    protectTerm: vi.fn(() => Promise.resolve(true)),
    loadModelCatalog: vi.fn(() => Promise.resolve(models)),
    loadModelSelection: vi.fn(() => Promise.resolve(undefined)),
    saveModelSelection,
    verifyModelCapability,
  };
  return {
    adapter,
    start,
    cancel,
    saveModelSelection,
    saveActiveConversation,
    clearActiveConversation,
    verifyModelCapability,
    emit,
  };
}

function renderConversation(
  models: AssistantModelOption[] = [],
  messages: ConversationMessage[] = [],
) {
  const transport = createAdapter(models);
  const store = createConversationStore({
    modelCatalogReady: true,
    modelSelectionReady: true,
    messages,
    context: {
      selection: 'Group Relative Policy Optimization',
      title: 'DeepSeek Technical Report',
      heading: 'Reinforcement Learning',
      url: 'https://developer.nvidia.com/blog/post-a',
      tabId: 7,
    },
  });
  const view = render(
    <ConversationProvider adapter={transport.adapter} store={store}>
      <ConversationPanel />
    </ConversationProvider>,
  );
  return { ...transport, ...view, store };
}

describe('ConversationPanel composer', () => {
  it('uses one form and submits with Enter but not Shift+Enter', async () => {
    const { start, container } = renderConversation();
    const input = screen.getByRole('textbox', { name: '继续询问' });
    expect(container.querySelectorAll('form')).toHaveLength(1);

    fireEvent.change(input, { target: { value: '它与 PPO 有什么关系？' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(start).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '它与 PPO 有什么关系？',
        intent: 'follow_up',
        knowledgeMode: 'hybrid',
      }),
    );
  });

  it('does not submit while a Chinese IME composition is active', async () => {
    const { start } = renderConversation();
    const input = screen.getByRole('textbox', { name: '继续询问' });
    fireEvent.change(input, { target: { value: '解释优势估计' } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(start).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });

  it('promotes a completed quick translation into the first durable follow-up', async () => {
    const createdAt = Date.now();
    const quickTranslation: ConversationMessage[] = [
      {
        id: 'quick-user',
        role: 'user',
        content: 'A tensor',
        status: 'complete',
        intent: 'translate',
        createdAt,
      },
      {
        id: 'quick-assistant',
        role: 'assistant',
        content: '一个张量',
        status: 'complete',
        intent: 'translate',
        createdAt,
      },
    ];
    const { start } = renderConversation([], quickTranslation);
    const input = screen.getByRole('textbox', { name: '继续询问' });
    fireEvent.change(input, { target: { value: '为什么这里使用张量？' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        transientMessages: [
          expect.objectContaining({ role: 'user', content: 'A tensor', intent: 'translate' }),
          expect.objectContaining({ role: 'assistant', content: '一个张量', intent: 'translate' }),
        ],
      }),
    );
  });

  it('persists the site-scoped conversation pointer and clears it for an explicit new chat', async () => {
    const { clearActiveConversation, emit, start, saveActiveConversation, store } =
      renderConversation();
    const input = screen.getByRole('textbox', { name: '继续询问' });
    fireEvent.change(input, { target: { value: '建立一个持久对话' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    // The pointer is stored against the page URL, so it belongs to this site only.
    await waitFor(() =>
      expect(saveActiveConversation).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'chat-1' }),
        'https://developer.nvidia.com/blog/post-a',
      ),
    );

    emit({
      type: 'completed',
      taskId: 'task-1',
      answer: '对话已持久化。',
      conversationId: 'chat-1',
    });
    const newChat = screen.getByRole('button', { name: '新聊天' });
    await waitFor(() => expect(newChat).toBeEnabled());
    fireEvent.click(newChat);
    // "新聊天" is the only action that ends the site's current conversation.
    await waitFor(() =>
      expect(clearActiveConversation).toHaveBeenCalledWith(
        'https://developer.nvidia.com/blog/post-a',
      ),
    );
    expect(store.getState().conversationId).toBeUndefined();
    expect(store.getState().messages).toHaveLength(0);
  });

  it('stops an active task and retries a failed answer', async () => {
    const { start, cancel, emit } = renderConversation();
    const input = screen.getByRole('textbox', { name: '继续询问' });
    fireEvent.change(input, { target: { value: '解释公式' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('button', { name: '停止生成' });
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('task-1'));

    emit({ type: 'failed', taskId: 'task-1', message: '网络连接中断。' });
    fireEvent.click(await screen.findByRole('button', { name: /重试/ }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  });

  it('does not lose a terminal failure that arrives before start resolves', async () => {
    const { adapter, start, emit } = renderConversation();
    const loadTerminalEvent = vi.fn(() =>
      Promise.resolve({
        type: 'failed' as const,
        taskId: 'task-fast-failure',
        message: '所选模型不可用。',
      }),
    );
    adapter.loadTerminalEvent = loadTerminalEvent;
    start.mockImplementationOnce(() => {
      emit({ type: 'failed', taskId: 'task-fast-failure', message: '所选模型不可用。' });
      return Promise.resolve({ accepted: true, taskId: 'task-fast-failure' });
    });
    const input = screen.getByRole('textbox', { name: '继续询问' });
    fireEvent.change(input, { target: { value: '解释这段内容' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent('所选模型不可用。');
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument();
    expect(loadTerminalEvent).toHaveBeenCalledWith('task-fast-failure');
  });

  it('sends the selected knowledge mode with the request', async () => {
    const { start } = renderConversation();
    fireEvent.change(screen.getByRole('combobox', { name: '回答知识范围' }), {
      target: { value: 'general' },
    });
    const input = screen.getByRole('textbox', { name: '继续询问' });
    fireEvent.change(input, { target: { value: '给出通用背景' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(expect.objectContaining({ knowledgeMode: 'general' })),
    );
  });

  it('keeps unverified models selectable and blocks only unavailable ones', async () => {
    const models: AssistantModelOption[] = [
      {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-pro',
        owner: 'deepseek',
        availability: 'available',
        capabilityStatus: 'verified',
        supportsThinking: true,
        supportsStreaming: true,
        reasoningEfforts: ['high', 'max'],
      },
      {
        providerId: 'deepseek',
        modelId: 'unverified-model',
        owner: 'deepseek',
        availability: 'unknown',
        capabilityStatus: 'unverified',
        reasoningEfforts: [],
      },
      {
        providerId: 'deepseek',
        modelId: 'refused-model',
        owner: 'deepseek',
        availability: 'unavailable',
        capabilityStatus: 'unverified',
        reasoningEfforts: [],
      },
    ];
    const { saveModelSelection, start, verifyModelCapability } = renderConversation(models);
    const modelSelect = await screen.findByRole('combobox', { name: '会话模型' });
    // "未验证" is a status, not a lock: the option stays selectable.
    const unverified = screen.getByRole('option', { name: /unverified-model · 未验证/ });
    expect(unverified).toBeEnabled();
    // Only a provider-refused model is unselectable.
    expect(screen.getByRole('option', { name: /refused-model · 不可用/ })).toBeDisabled();

    fireEvent.change(modelSelect, { target: { value: 'unverified-model' } });
    await waitFor(() =>
      expect(saveModelSelection).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'unverified-model', thinkingEnabled: false }),
      ),
    );
    // Thinking support is unknown, so verification is offered rather than a hard no.
    expect(screen.getByRole('button', { name: '验证模型' })).toBeEnabled();
    expect(
      screen.getAllByRole('status').some((element) => element.textContent === '思考模式：未验证'),
    ).toBe(true);

    // Verification is user initiated and probes the unknown capability.
    fireEvent.click(screen.getByRole('button', { name: '验证模型' }));
    await waitFor(() =>
      expect(verifyModelCapability).toHaveBeenCalledWith('deepseek', 'unverified-model', true),
    );

    fireEvent.change(modelSelect, { target: { value: 'deepseek-v4-pro' } });
    await waitFor(() =>
      expect(saveModelSelection).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'deepseek-v4-pro',
          thinkingEnabled: false,
          scope: 'task',
        }),
      ),
    );
    fireEvent.change(screen.getByRole('combobox', { name: '思考模式' }), {
      target: { value: 'enabled' },
    });
    await waitFor(() =>
      expect(saveModelSelection).toHaveBeenLastCalledWith(
        expect.objectContaining({ thinkingEnabled: true, reasoningEffort: 'high' }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '思考模式' })).toHaveValue('enabled'),
    );
    const input = screen.getByRole('textbox', { name: '继续询问' });
    fireEvent.change(input, { target: { value: '继续分析训练稳定性' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: expect.objectContaining({
            providerId: 'deepseek',
            model: 'deepseek-v4-pro',
            thinking: 'enabled',
            reasoningEffort: 'high',
            streaming: true,
          }),
        }),
      ),
    );
  });

  it('keeps a manually selected provider and clears incompatible thinking controls', async () => {
    const models: AssistantModelOption[] = [
      {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-pro',
        owner: 'deepseek',
        availability: 'available',
        capabilityStatus: 'verified',
        supportsThinking: true,
        supportsStreaming: true,
        reasoningEfforts: ['high', 'max'],
      },
      {
        providerId: 'compatible-lab',
        modelId: 'lab-translate-1',
        owner: 'compatible-lab',
        availability: 'available',
        capabilityStatus: 'verified',
        supportsThinking: false,
        supportsStreaming: true,
        reasoningEfforts: [],
      },
    ];
    const { saveModelSelection } = renderConversation(models);
    fireEvent.change(await screen.findByRole('combobox', { name: '会话模型' }), {
      target: { value: 'deepseek-v4-pro' },
    });
    await waitFor(() => expect(saveModelSelection).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('combobox', { name: '思考模式' }), {
      target: { value: 'enabled' },
    });
    await waitFor(() => expect(saveModelSelection).toHaveBeenCalledTimes(2));

    const provider = screen.getByRole('combobox', { name: '模型供应商' });
    fireEvent.change(provider, { target: { value: 'compatible-lab' } });
    await waitFor(() => expect(provider).toHaveValue('compatible-lab'));
    expect(screen.getByRole('combobox', { name: '会话模型' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '思考模式' })).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox', { name: '会话模型' }), {
      target: { value: 'lab-translate-1' },
    });
    await waitFor(() =>
      expect(saveModelSelection).toHaveBeenLastCalledWith(
        expect.objectContaining({
          providerId: 'compatible-lab',
          modelId: 'lab-translate-1',
          thinkingEnabled: false,
        }),
      ),
    );
  });

  it('keeps task presets ahead of a global API default while honoring explicit overrides', () => {
    const globalDefault: AssistantModelSelection = {
      scope: 'global',
      scopeId: 'default',
      task: 'explanation',
      providerId: 'deepseek',
      modelId: 'global-default',
      thinkingEnabled: false,
    };
    expect(requestScopedModelSelection(globalDefault, 'explanation')).toBeUndefined();

    const taskOverride: AssistantModelSelection = {
      ...globalDefault,
      scope: 'task',
      scopeId: 'explanation',
      modelId: 'task-override',
    };
    expect(requestScopedModelSelection(taskOverride, 'explanation')).toBe(taskOverride);

    const conversationOverride: AssistantModelSelection = {
      ...globalDefault,
      scope: 'conversation',
      scopeId: 'conversation-1',
      modelId: 'conversation-override',
    };
    expect(requestScopedModelSelection(conversationOverride, 'deep_follow_up')).toBe(
      conversationOverride,
    );
  });
});
