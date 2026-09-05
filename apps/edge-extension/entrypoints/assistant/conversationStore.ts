import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AssistantIntent } from '@yanyi/protocol';
import type { KnowledgeMode } from '@yanyi/shared-types';
import type {
  ConversationContext,
  ConversationCitation,
  ConversationHandoff,
  ConversationMessage,
  ConversationStatus,
  AssistantModelOption,
  AssistantModelSelection,
  RestoredConversation,
} from './types';

export interface ConversationState {
  conversationId: string | undefined;
  knowledgeMode: KnowledgeMode;
  context: ConversationContext;
  messages: ConversationMessage[];
  draft: string;
  status: ConversationStatus;
  activeTaskId: string | undefined;
  activeAssistantMessageId: string | undefined;
  announcement: string;
  modelCatalog: AssistantModelOption[];
  modelSelection: AssistantModelSelection | undefined;
  modelError: string | undefined;
  modelCatalogReady: boolean;
  modelSelectionReady: boolean;
}

export type ConversationAction =
  | { type: 'context.set'; context: ConversationContext }
  | { type: 'knowledge.set'; mode: KnowledgeMode }
  | { type: 'draft.set'; draft: string }
  | { type: 'conversation.new' }
  | {
      type: 'conversation.restore';
      conversation: RestoredConversation;
      context: ConversationContext;
    }
  | { type: 'model.catalog.loaded'; models: AssistantModelOption[] }
  | { type: 'model.selection.loaded'; selection: AssistantModelSelection | undefined }
  | { type: 'model.error'; message: string | undefined }
  | { type: 'handoff.hydrate'; handoff: ConversationHandoff }
  | {
      type: 'request.begin';
      userMessageId: string;
      assistantMessageId: string;
      prompt: string;
      intent: AssistantIntent;
      createdAt: number;
    }
  | {
      type: 'request.accepted';
      assistantMessageId: string;
      taskId: string;
      conversationId?: string;
      knowledgeMode?: KnowledgeMode;
    }
  | { type: 'request.rejected'; assistantMessageId: string; message: string }
  | { type: 'stream.delta'; taskId: string; delta: string }
  | {
      type: 'stream.completed';
      taskId: string;
      answer: string;
      conversationId?: string;
      knowledgeMode?: KnowledgeMode;
      citations?: ConversationCitation[];
    }
  | { type: 'stream.failed'; taskId: string; message: string }
  | { type: 'stream.cancelled'; taskId: string }
  | { type: 'stream.stopping' };

const emptyContext: ConversationContext = { selection: '' };

export const initialConversationState: ConversationState = {
  conversationId: undefined,
  knowledgeMode: 'hybrid',
  context: emptyContext,
  messages: [],
  draft: '',
  status: 'idle',
  activeTaskId: undefined,
  activeAssistantMessageId: undefined,
  announcement: '',
  modelCatalog: [],
  modelSelection: undefined,
  modelError: undefined,
  modelCatalogReady: false,
  modelSelectionReady: false,
};

function withOptional<T extends object, K extends string, V>(
  value: T,
  key: K,
  optional: V | undefined,
): T & Partial<Record<K, V>> {
  return optional === undefined ? value : { ...value, [key]: optional };
}

function updateMessage(
  messages: ConversationMessage[],
  messageId: string | undefined,
  update: (message: ConversationMessage) => ConversationMessage,
): ConversationMessage[] {
  if (messageId === undefined) return messages;
  return messages.map((message) => (message.id === messageId ? update(message) : message));
}

function messageIdForTask(state: ConversationState, taskId: string): string | undefined {
  return state.messages.find((message) => message.taskId === taskId)?.id;
}

function boundedAnswer(value: string): string {
  return value.slice(0, 256_000);
}

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case 'context.set':
      return { ...state, context: action.context };
    case 'knowledge.set':
      return { ...state, knowledgeMode: action.mode };
    case 'draft.set':
      return { ...state, draft: action.draft };
    case 'conversation.new':
      return {
        ...initialConversationState,
        context: state.context,
        knowledgeMode: state.knowledgeMode,
        modelCatalog: state.modelCatalog,
        modelSelection:
          state.modelSelection?.scope === 'conversation' ? undefined : state.modelSelection,
        modelError: state.modelError,
        modelCatalogReady: state.modelCatalogReady,
        modelSelectionReady: state.modelSelectionReady,
        announcement: '已开始新对话。',
      };
    case 'conversation.restore':
      return {
        ...state,
        conversationId: action.conversation.conversationId,
        knowledgeMode: action.conversation.knowledgeMode,
        context: action.context,
        messages: action.conversation.messages,
        draft: '',
        status: 'idle',
        activeTaskId: undefined,
        activeAssistantMessageId: undefined,
        announcement: '已恢复上次对话。',
      };
    case 'model.catalog.loaded':
      return {
        ...state,
        modelCatalog: action.models,
        modelCatalogReady: true,
        modelError: undefined,
      };
    case 'model.selection.loaded':
      return {
        ...state,
        modelSelection: action.selection,
        modelSelectionReady: true,
        modelError: undefined,
      };
    case 'model.error':
      return { ...state, modelError: action.message };
    case 'handoff.hydrate': {
      return {
        ...state,
        conversationId: action.handoff.conversationId,
        context: action.handoff.context,
        knowledgeMode: action.handoff.knowledgeMode,
        messages: action.handoff.messages,
        status: action.handoff.activeTaskId === undefined ? 'idle' : 'streaming',
        activeTaskId: action.handoff.activeTaskId,
        activeAssistantMessageId:
          action.handoff.activeTaskId === undefined
            ? undefined
            : action.handoff.messages.find(
                (message) => message.taskId === action.handoff.activeTaskId,
              )?.id,
        modelSelection: action.handoff.modelSelection ?? state.modelSelection,
        announcement: '已从网页浮窗继续当前对话。',
      };
    }
    case 'request.begin': {
      const userMessage: ConversationMessage = {
        id: action.userMessageId,
        role: 'user',
        content: action.prompt,
        status: 'complete',
        intent: action.intent,
        createdAt: action.createdAt,
      };
      const assistantMessage: ConversationMessage = {
        id: action.assistantMessageId,
        role: 'assistant',
        content: '',
        status: 'sending',
        intent: action.intent,
        createdAt: action.createdAt,
      };
      return {
        ...state,
        messages: [...state.messages, userMessage, assistantMessage],
        draft: '',
        status: 'sending',
        activeAssistantMessageId: action.assistantMessageId,
        announcement: '正在发送问题。',
      };
    }
    case 'request.accepted': {
      if (state.activeAssistantMessageId !== action.assistantMessageId) return state;
      const messages = updateMessage(state.messages, action.assistantMessageId, (message) => ({
        ...message,
        taskId: action.taskId,
        status: 'streaming',
      }));
      return {
        ...state,
        messages,
        status: 'streaming',
        activeTaskId: action.taskId,
        conversationId: action.conversationId ?? state.conversationId,
        knowledgeMode: action.knowledgeMode ?? state.knowledgeMode,
        announcement: '正在生成回答。',
      };
    }
    case 'request.rejected':
      if (state.activeAssistantMessageId !== action.assistantMessageId) return state;
      return {
        ...state,
        messages: updateMessage(state.messages, action.assistantMessageId, (message) => ({
          ...message,
          status: 'failed',
          error: action.message,
        })),
        status: 'error',
        activeTaskId: undefined,
        activeAssistantMessageId: undefined,
        announcement: action.message,
      };
    case 'stream.delta': {
      const messageId = messageIdForTask(state, action.taskId);
      if (messageId === undefined || state.activeTaskId !== action.taskId) return state;
      return {
        ...state,
        messages: updateMessage(state.messages, messageId, (message) => ({
          ...message,
          content: boundedAnswer(message.content + action.delta),
          status: 'streaming',
        })),
      };
    }
    case 'stream.completed': {
      const messageId = messageIdForTask(state, action.taskId);
      if (messageId === undefined) return state;
      return {
        ...state,
        conversationId: action.conversationId ?? state.conversationId,
        messages: updateMessage(state.messages, messageId, (message) => ({
          ...message,
          content: boundedAnswer(action.answer || message.content),
          status: 'complete',
          ...(action.citations === undefined ? {} : { citations: action.citations }),
        })),
        status: 'idle',
        activeTaskId: undefined,
        activeAssistantMessageId: undefined,
        knowledgeMode: action.knowledgeMode ?? state.knowledgeMode,
        announcement: '回答已完成。',
      };
    }
    case 'stream.failed': {
      const messageId = messageIdForTask(state, action.taskId);
      if (messageId === undefined) return state;
      return {
        ...state,
        messages: updateMessage(state.messages, messageId, (message) => ({
          ...message,
          status: 'failed',
          error: action.message,
        })),
        status: 'error',
        activeTaskId: undefined,
        activeAssistantMessageId: undefined,
        announcement: action.message,
      };
    }
    case 'stream.cancelled': {
      const messageId = messageIdForTask(state, action.taskId);
      if (messageId === undefined) return state;
      return {
        ...state,
        messages: updateMessage(state.messages, messageId, (message) => ({
          ...message,
          status: 'cancelled',
          error: '已停止生成。',
        })),
        status: 'idle',
        activeTaskId: undefined,
        activeAssistantMessageId: undefined,
        announcement: '已停止生成。',
      };
    }
    case 'stream.stopping':
      return { ...state, status: 'stopping', announcement: '正在停止生成。' };
  }
}

export interface ConversationStore extends ConversationState {
  dispatch: (action: ConversationAction) => void;
}

export type ConversationStoreApi = StoreApi<ConversationStore>;

export function createConversationStore(
  initial: Partial<ConversationState> = {},
): ConversationStoreApi {
  return createStore<ConversationStore>((set) => ({
    ...initialConversationState,
    ...initial,
    dispatch: (action) => set((state) => conversationReducer(state, action)),
  }));
}

export function createConversationHandoff(state: ConversationState): ConversationHandoff {
  const handoff: ConversationHandoff = {
    knowledgeMode: state.knowledgeMode,
    context: state.context,
    messages: state.messages,
    capturedAt: Date.now(),
    ...(state.modelSelection === undefined ? {} : { modelSelection: state.modelSelection }),
  };
  const withConversation = withOptional(handoff, 'conversationId', state.conversationId);
  return withOptional(withConversation, 'activeTaskId', state.activeTaskId);
}
