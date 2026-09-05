import { describe, expect, it } from 'vitest';
import { conversationReducer, initialConversationState } from './conversationStore';

describe('conversationReducer', () => {
  it('keeps five turns in one accepted conversation', () => {
    let state = { ...initialConversationState, context: { selection: 'GRPO' } };
    for (let turn = 0; turn < 5; turn += 1) {
      const assistantMessageId = `assistant-${String(turn)}`;
      const taskId = `task-${String(turn)}`;
      state = conversationReducer(state, {
        type: 'request.begin',
        userMessageId: `user-${String(turn)}`,
        assistantMessageId,
        prompt: `问题 ${String(turn + 1)}`,
        intent: turn === 0 ? 'explain' : 'follow_up',
        createdAt: turn,
      });
      state = conversationReducer(state, {
        type: 'request.accepted',
        assistantMessageId,
        taskId,
        conversationId: 'conversation-1',
      });
      state = conversationReducer(state, { type: 'stream.delta', taskId, delta: '流式' });
      state = conversationReducer(state, {
        type: 'stream.completed',
        taskId,
        answer: `回答 ${String(turn + 1)}`,
        conversationId: 'conversation-1',
      });
    }

    expect(state.conversationId).toBe('conversation-1');
    expect(state.messages).toHaveLength(10);
    expect(state.messages.filter(({ role }) => role === 'assistant')).toHaveLength(5);
    expect(state.messages.at(-1)?.content).toBe('回答 5');
    expect(state.status).toBe('idle');
  });

  it('ignores stream events from a stale task', () => {
    let state = conversationReducer(initialConversationState, {
      type: 'request.begin',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1',
      prompt: '解释',
      intent: 'explain',
      createdAt: 1,
    });
    state = conversationReducer(state, {
      type: 'request.accepted',
      assistantMessageId: 'assistant-1',
      taskId: 'current-task',
    });

    expect(
      conversationReducer(state, {
        type: 'stream.delta',
        taskId: 'stale-task',
        delta: '不应写入',
      }),
    ).toBe(state);
  });

  it('keeps accumulated deltas when the terminal frame omits an oversized repeated answer', () => {
    let state = conversationReducer(initialConversationState, {
      type: 'request.begin',
      userMessageId: 'user-large',
      assistantMessageId: 'assistant-large',
      prompt: 'large answer',
      intent: 'follow_up',
      createdAt: 1,
    });
    state = conversationReducer(state, {
      type: 'request.accepted',
      assistantMessageId: 'assistant-large',
      taskId: 'task-large',
    });
    state = conversationReducer(state, {
      type: 'stream.delta',
      taskId: 'task-large',
      delta: 'already streamed',
    });
    state = conversationReducer(state, {
      type: 'stream.completed',
      taskId: 'task-large',
      answer: '',
    });

    expect(state.messages.at(-1)).toMatchObject({
      content: 'already streamed',
      status: 'complete',
    });
  });

  it('hydrates an in-flight handoff without creating another conversation', () => {
    const state = conversationReducer(initialConversationState, {
      type: 'handoff.hydrate',
      handoff: {
        conversationId: 'conversation-9',
        knowledgeMode: 'page_only',
        context: { selection: 'selected text', title: 'Paper' },
        messages: [
          {
            id: 'assistant-9',
            role: 'assistant',
            content: 'partial',
            status: 'streaming',
            intent: 'explain',
            taskId: 'task-9',
            createdAt: 1,
          },
        ],
        activeTaskId: 'task-9',
        capturedAt: Date.now(),
      },
    });

    expect(state.conversationId).toBe('conversation-9');
    expect(state.activeTaskId).toBe('task-9');
    expect(state.activeAssistantMessageId).toBe('assistant-9');
    expect(state.knowledgeMode).toBe('page_only');
  });

  it('restores a durable conversation without reviving a stale native task', () => {
    const state = conversationReducer(
      { ...initialConversationState, modelCatalogReady: true },
      {
        type: 'conversation.restore',
        conversation: {
          conversationId: 'conversation-restored',
          knowledgeMode: 'general',
          context: { selection: 'restored source context' },
          messages: [
            {
              id: 'message-restored',
              role: 'assistant',
              content: '已恢复回答',
              status: 'complete',
              intent: 'follow_up',
              createdAt: 1,
            },
          ],
        },
        context: { selection: 'restored selection', title: 'Paper' },
      },
    );

    expect(state.conversationId).toBe('conversation-restored');
    expect(state.knowledgeMode).toBe('general');
    expect(state.messages).toHaveLength(1);
    expect(state.activeTaskId).toBeUndefined();
    expect(state.status).toBe('idle');
    expect(state.modelCatalogReady).toBe(true);
  });
});
