import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PropsWithChildren,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import {
  ArrowUp,
  BookOpenText,
  Check,
  Clipboard,
  ExternalLink,
  FileText,
  LoaderCircle,
  MessageSquareText,
  NotebookPen,
  PencilLine,
  RefreshCcw,
  Square,
  Tag,
} from 'lucide-react';
import { useStore } from 'zustand';
import type {
  AssistantIntent,
  AssistantTransientMessage,
  TranslationProfile,
} from '@yanyi/protocol';
import type { KnowledgeMode } from '@yanyi/shared-types';
import { assistantProfileForIntent } from './browserAssistantAdapter';
import { createConversationStore, type ConversationStoreApi } from './conversationStore';
import {
  canSendWithModel,
  modelState,
  presentModel,
  reasoningEffortOptions,
  thinkingControlState,
  thinkingSupport,
} from './modelCapability';
import { SafeMarkdown } from './SafeMarkdown';
import type {
  AssistantAdapter,
  AssistantModelSelection,
  AssistantStreamEvent,
  ConversationMessage,
} from './types';

const knowledgeOptions: readonly { value: KnowledgeMode; label: string; description: string }[] = [
  { value: 'hybrid', label: '页面优先', description: '先使用页面，必要时补充通用知识' },
  { value: 'page_only', label: '仅当前页面', description: '回答严格限制在可定位的页面内容' },
  { value: 'general', label: '通用知识', description: '将选区作为主题，不视作事实依据' },
];

interface ConversationController {
  adapter: AssistantAdapter;
  store: ConversationStoreApi;
  submit: (prompt: string, intent: AssistantIntent) => Promise<void>;
  stop: () => Promise<void>;
  retry: (messageId: string) => Promise<void>;
  /** The only path that ends the current site's conversation. */
  startNewChat: () => Promise<void>;
}

const ControllerContext = createContext<ConversationController | undefined>(undefined);

function useController(): ConversationController {
  const value = useContext(ControllerContext);
  if (value === undefined) throw new Error('ConversationPanel 必须位于 ConversationProvider 内');
  return value;
}

function modelTaskForIntent(intent: AssistantIntent): string {
  if (intent === 'translate') return 'selected_precise_translation';
  if (intent === 'explain') return 'explanation';
  return 'deep_follow_up';
}

export function requestScopedModelSelection(
  selection: AssistantModelSelection | undefined,
  task: string,
): AssistantModelSelection | undefined {
  if (selection?.scope === 'conversation') return selection;
  if (selection?.scope === 'task' && (selection.task === task || selection.task === 'assistant'))
    return selection;
  return undefined;
}

function transientMessagesForPromotion(
  messages: readonly ConversationMessage[],
): AssistantTransientMessage[] {
  const pairs: AssistantTransientMessage[][] = [];
  for (let index = 0; index + 1 < messages.length; index += 2) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (
      user?.role !== 'user' ||
      assistant?.role !== 'assistant' ||
      user.status !== 'complete' ||
      assistant.status !== 'complete' ||
      user.content.trim().length === 0 ||
      assistant.content.trim().length === 0
    )
      continue;
    pairs.push([
      { role: 'user', content: user.content.slice(0, 12_000), intent: user.intent },
      { role: 'assistant', content: assistant.content.slice(0, 12_000), intent: assistant.intent },
    ]);
  }
  const selected: AssistantTransientMessage[][] = [];
  let characters = 0;
  for (const pair of pairs.slice(-6).reverse()) {
    const pairCharacters = pair.reduce((total, message) => total + message.content.length, 0);
    if (characters + pairCharacters > 24_000) break;
    selected.unshift(pair);
    characters += pairCharacters;
  }
  return selected.flat();
}

export interface ConversationProviderProps extends PropsWithChildren {
  adapter: AssistantAdapter;
  store?: ConversationStoreApi;
  resolveProfile?: (intent: AssistantIntent) => TranslationProfile;
}

export function applyAssistantStreamEvent(
  store: ConversationStoreApi,
  event: AssistantStreamEvent,
) {
  const current = store.getState();
  if (event.type === 'accepted') {
    if (
      current.activeAssistantMessageId === undefined ||
      (current.activeTaskId !== undefined && current.activeTaskId !== event.taskId)
    )
      return;
    store.getState().dispatch({
      type: 'request.accepted',
      assistantMessageId: current.activeAssistantMessageId,
      taskId: event.taskId,
      ...(event.conversationId === undefined ? {} : { conversationId: event.conversationId }),
      ...(event.knowledgeMode === undefined ? {} : { knowledgeMode: event.knowledgeMode }),
    });
    return;
  }
  if (event.type === 'delta') {
    store.getState().dispatch({ type: 'stream.delta', taskId: event.taskId, delta: event.delta });
    return;
  }
  if (event.type === 'completed') {
    store.getState().dispatch({
      type: 'stream.completed',
      taskId: event.taskId,
      answer: event.answer,
      ...(event.conversationId === undefined ? {} : { conversationId: event.conversationId }),
      ...(event.knowledgeMode === undefined ? {} : { knowledgeMode: event.knowledgeMode }),
      ...(event.citations === undefined ? {} : { citations: event.citations }),
    });
    return;
  }
  if (event.type === 'failed') {
    store
      .getState()
      .dispatch({ type: 'stream.failed', taskId: event.taskId, message: event.message });
    return;
  }
  store.getState().dispatch({ type: 'stream.cancelled', taskId: event.taskId });
}

export function ConversationProvider({
  adapter,
  children,
  store: providedStore,
  resolveProfile = assistantProfileForIntent,
}: ConversationProviderProps) {
  const store = useMemo(() => providedStore ?? createConversationStore(), [providedStore]);

  useEffect(
    () => adapter.subscribe((event) => applyAssistantStreamEvent(store, event)),
    [adapter, store],
  );

  useEffect(() => {
    if (adapter.saveActiveConversation === undefined) return;
    let queue: Promise<void> = Promise.resolve();
    const enqueue = (conversationId: string | undefined) => {
      const state = store.getState();
      queue = queue
        .then(() =>
          // Scoped to the page's origin, so each site keeps its own thread.
          adapter.saveActiveConversation?.(
            conversationId === undefined
              ? undefined
              : {
                  conversationId,
                  knowledgeMode: state.knowledgeMode,
                  savedAt: Date.now(),
                },
            state.context.url,
          ),
        )
        .catch(() => undefined);
    };
    const initial = store.getState();
    if (initial.conversationId !== undefined) enqueue(initial.conversationId);
    return store.subscribe((state, previous) => {
      if (
        state.conversationId === previous.conversationId &&
        state.knowledgeMode === previous.knowledgeMode
      )
        return;
      enqueue(state.conversationId);
    });
  }, [adapter, store]);

  useEffect(() => {
    let active = true;
    let selectionRevision = 0;
    const loadSelection = (conversationId: string | undefined) => {
      const revision = ++selectionRevision;
      void adapter.loadModelSelection(conversationId, 'assistant').then((selection) => {
        if (!active || revision !== selectionRevision) return;
        store.getState().dispatch({ type: 'model.selection.loaded', selection });
      });
    };
    void adapter.loadModelCatalog().then((models) => {
      if (active) store.getState().dispatch({ type: 'model.catalog.loaded', models });
    });
    loadSelection(store.getState().conversationId);
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.conversationId === previous.conversationId) return;
      if (
        previous.conversationId === undefined &&
        state.conversationId !== undefined &&
        state.modelSelection?.scope === 'task'
      ) {
        const promoted = {
          ...state.modelSelection,
          scope: 'conversation' as const,
          scopeId: state.conversationId,
        };
        const revision = ++selectionRevision;
        void adapter.saveModelSelection(promoted).then((saved) => {
          if (!active || revision !== selectionRevision) return;
          if (saved)
            store.getState().dispatch({ type: 'model.selection.loaded', selection: promoted });
          else loadSelection(state.conversationId);
        });
        return;
      }
      loadSelection(state.conversationId);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [adapter, store]);

  const submit = useCallback(
    async (rawPrompt: string, intent: AssistantIntent) => {
      const prompt = rawPrompt.trim();
      const state = store.getState();
      if (
        prompt.length === 0 ||
        state.activeTaskId !== undefined ||
        state.status === 'sending' ||
        !state.modelCatalogReady ||
        !state.modelSelectionReady
      )
        return;
      const userMessageId = crypto.randomUUID();
      const assistantMessageId = crypto.randomUUID();
      store.getState().dispatch({
        type: 'request.begin',
        userMessageId,
        assistantMessageId,
        prompt,
        intent,
        createdAt: Date.now(),
      });
      const modelTask = modelTaskForIntent(intent);
      const currentSelection = requestScopedModelSelection(state.modelSelection, modelTask);
      const resolvedSelection =
        currentSelection === undefined
          ? await adapter.loadModelSelection(state.conversationId, modelTask)
          : undefined;
      const configuredModel =
        currentSelection ?? requestScopedModelSelection(resolvedSelection, modelTask);
      const modelRecord =
        configuredModel === undefined
          ? undefined
          : state.modelCatalog.find(
              (model) =>
                model.providerId === configuredModel.providerId &&
                model.modelId === configuredModel.modelId,
            );
      // Only an unavailable model blocks a request; unverified proceeds with safe
      // defaults, and research never substitutes a different model or provider.
      if (configuredModel !== undefined && !canSendWithModel(modelRecord)) {
        store.getState().dispatch({
          type: 'request.rejected',
          assistantMessageId,
          message: '所选模型当前不可用。研译不会自动切换模型或供应商。',
        });
        return;
      }
      const defaultProfile = resolveProfile(intent);
      const profile =
        configuredModel === undefined
          ? defaultProfile
          : {
              model: configuredModel.modelId,
              providerId: configuredModel.providerId,
              thinking: configuredModel.thinkingEnabled
                ? ('enabled' as const)
                : ('disabled' as const),
              ...(modelRecord?.supportsStreaming === true ? { streaming: true } : {}),
              ...(configuredModel.apiProfileId === undefined
                ? {}
                : { apiProfileId: configuredModel.apiProfileId }),
              ...(configuredModel.thinkingEnabled && configuredModel.reasoningEffort !== undefined
                ? { reasoningEffort: configuredModel.reasoningEffort }
                : {}),
            };
      const request = {
        clientRequestId: userMessageId,
        knowledgeMode: state.knowledgeMode,
        intent,
        prompt,
        context: state.context,
        profile,
        ...(state.conversationId === undefined ? {} : { conversationId: state.conversationId }),
        ...(state.conversationId !== undefined || intent === 'translate'
          ? {}
          : { transientMessages: transientMessagesForPromotion(state.messages) }),
      };
      const result = await adapter.start(request).catch(() => ({
        accepted: false as const,
        error: '本地服务连接中断，问题尚未发送。',
      }));
      if (!result.accepted || result.taskId === undefined) {
        store.getState().dispatch({
          type: 'request.rejected',
          assistantMessageId,
          message: result.error ?? '本地服务未接受此任务。',
        });
        return;
      }
      store.getState().dispatch({
        type: 'request.accepted',
        assistantMessageId,
        taskId: result.taskId,
        ...(result.conversationId === undefined ? {} : { conversationId: result.conversationId }),
        ...(result.knowledgeMode === undefined ? {} : { knowledgeMode: result.knowledgeMode }),
      });
      const earlyTerminal = await adapter.loadTerminalEvent?.(result.taskId);
      if (earlyTerminal !== undefined) applyAssistantStreamEvent(store, earlyTerminal);
    },
    [adapter, resolveProfile, store],
  );

  const stop = useCallback(async () => {
    const taskId = store.getState().activeTaskId;
    if (taskId === undefined) return;
    store.getState().dispatch({ type: 'stream.stopping' });
    if (!(await adapter.cancel(taskId))) {
      store.getState().dispatch({
        type: 'stream.failed',
        taskId,
        message: '停止请求未送达本地服务，请稍后重试。',
      });
    }
  }, [adapter, store]);

  const retry = useCallback(
    async (messageId: string) => {
      const state = store.getState();
      const index = state.messages.findIndex((message) => message.id === messageId);
      if (index < 1) return;
      const assistant = state.messages[index];
      const user = state.messages[index - 1];
      if (assistant?.role !== 'assistant' || user?.role !== 'user') return;
      await submit(user.content, assistant.intent);
    },
    [store, submit],
  );

  /**
   * Starts a new conversation for the current site.
   *
   * Clears the site binding first so the next question cannot be appended to the
   * previous thread, then resets local state. Nothing else creates conversations.
   */
  const startNewChat = useCallback(async () => {
    const { context } = store.getState();
    await adapter.clearActiveConversation?.(context.url).catch(() => undefined);
    store.getState().dispatch({ type: 'conversation.new' });
  }, [adapter, store]);

  const controller = useMemo(
    () => ({ adapter, store, submit, stop, retry, startNewChat }),
    [adapter, retry, startNewChat, stop, store, submit],
  );
  return <ControllerContext.Provider value={controller}>{children}</ControllerContext.Provider>;
}

function knowledgeLabel(mode: KnowledgeMode): string {
  return knowledgeOptions.find((option) => option.value === mode)?.label ?? mode;
}

function ContextSourceBar({ compact = false }: { compact?: boolean }) {
  const { adapter, store } = useController();
  const context = useStore(store, (state) => state.context);
  const mode = useStore(store, (state) => state.knowledgeMode);
  const [expanded, setExpanded] = useState(false);
  const trimmedTitle = context.title?.trim();
  const sourceTitle = trimmedTitle === undefined || trimmedTitle === '' ? '当前网页' : trimmedTitle;
  const selection = context.selection.trim();

  return (
    <section className="yanyi-context" aria-labelledby="yanyi-context-title">
      <div className="yanyi-context__rail" aria-hidden="true" />
      <div className="yanyi-context__body">
        <div className="yanyi-context__heading">
          <div>
            <span className="yanyi-eyebrow" id="yanyi-context-title">
              上下文来源
            </span>
            <strong>{sourceTitle}</strong>
          </div>
          <button
            aria-expanded={expanded}
            className="yanyi-link-button"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? '收起' : '查看发送范围'}
          </button>
        </div>
        <p className="yanyi-context__selection">
          {selection || '请先在网页中选择需要翻译或解释的内容。'}
        </p>
        <div className="yanyi-context__sources" aria-label="当前回答范围">
          <span>
            <FileText aria-hidden="true" size={12} /> 选区
          </span>
          {context.heading !== undefined && context.heading.trim() !== '' && (
            <span>
              <BookOpenText aria-hidden="true" size={12} /> {context.heading.slice(0, 48)}
            </span>
          )}
          <span>{knowledgeLabel(mode)}</span>
        </div>
        {expanded && (
          <div className="yanyi-context__details">
            {!compact && context.paragraph !== undefined && context.paragraph !== selection && (
              <p>{context.paragraph.slice(0, 800)}</p>
            )}
            <button
              className="yanyi-secondary-action"
              disabled={selection === '' || context.tabId === undefined}
              onClick={() => void adapter.highlightSource(context, selection)}
              type="button"
            >
              <ExternalLink aria-hidden="true" size={13} />
              跳转并高亮原文
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function messageKnowledgeLabel(intent: AssistantIntent, mode: KnowledgeMode): string {
  if (intent === 'translate') return '精确翻译';
  if (mode === 'page_only') return '页面依据';
  if (mode === 'general') return '通用知识';
  return '页面优先 · 背景补充已标记';
}

function MessageActions({
  message,
  onEdit,
  onTerm,
}: {
  message: ConversationMessage;
  onEdit: (content: string) => void;
  onTerm: (message: ConversationMessage) => void;
}) {
  const { adapter, retry, store } = useController();
  const context = useStore(store, (state) => state.context);
  const [status, setStatus] = useState<'idle' | 'copied' | 'saved' | 'error'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setStatus('copied');
    } catch {
      setStatus('error');
    }
  };
  const saveNote = async () => {
    const saved = await adapter.saveNote(message.content, context.selection || undefined);
    setStatus(saved ? 'saved' : 'error');
  };
  return (
    <div className="yanyi-message__actions" aria-label="消息操作">
      {message.role === 'user' ? (
        <button onClick={() => onEdit(message.content)} type="button">
          <PencilLine aria-hidden="true" size={12} /> 编辑重发
        </button>
      ) : (
        <>
          {message.content !== '' && (
            <button onClick={() => void copy()} type="button">
              {status === 'copied' ? (
                <Check aria-hidden="true" size={12} />
              ) : (
                <Clipboard aria-hidden="true" size={12} />
              )}
              {status === 'copied' ? '已复制' : '复制'}
            </button>
          )}
          {message.status === 'complete' && (
            <button onClick={() => void saveNote()} type="button">
              <NotebookPen aria-hidden="true" size={12} />
              {status === 'saved' ? '已保存' : '保存笔记'}
            </button>
          )}
          {message.status === 'complete' &&
            message.intent === 'translate' &&
            context.selection.trim() !== '' && (
              <button onClick={() => onTerm(message)} type="button">
                <Tag aria-hidden="true" size={12} /> 保存译法
              </button>
            )}
          {(message.status === 'failed' || message.status === 'cancelled') && (
            <button onClick={() => void retry(message.id)} type="button">
              <RefreshCcw aria-hidden="true" size={12} /> 重试
            </button>
          )}
        </>
      )}
      {status === 'error' && <span role="status">操作失败</span>}
    </div>
  );
}

function MessageTimeline({ onEdit }: { onEdit: (content: string) => void }) {
  const { adapter, store } = useController();
  const messages = useStore(store, (state) => state.messages);
  const mode = useStore(store, (state) => state.knowledgeMode);
  const context = useStore(store, (state) => state.context);
  const endRef = useRef<HTMLDivElement>(null);
  const [termMessage, setTermMessage] = useState<ConversationMessage>();
  const [termTarget, setTermTarget] = useState('');
  const [termStatus, setTermStatus] = useState('');

  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView === 'function')
      endRef.current.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="yanyi-conversation-empty">
        <MessageSquareText aria-hidden="true" size={22} />
        <strong>围绕当前内容继续阅读</strong>
        <p>翻译、解释和追问会保留在同一条时间线中。页面内容与背景知识会明确标记。</p>
      </div>
    );
  }

  return (
    <div className="yanyi-timeline" role="log" aria-label="当前对话">
      {messages.map((message) => (
        <article
          className={`yanyi-message yanyi-message--${message.role}`}
          data-status={message.status}
          key={message.id}
        >
          <header>
            <strong>{message.role === 'user' ? '你' : '研译助手'}</strong>
            {message.role === 'assistant' && (
              <span>{messageKnowledgeLabel(message.intent, mode)}</span>
            )}
          </header>
          <div className="yanyi-message__content">
            {message.role === 'assistant' ? (
              message.content === '' &&
              (message.status === 'sending' || message.status === 'streaming') ? (
                <span className="yanyi-generating">
                  <LoaderCircle aria-hidden="true" size={14} />{' '}
                  {message.status === 'sending' ? '正在读取当前上下文…' : '正在生成回答…'}
                </span>
              ) : (
                <SafeMarkdown content={message.content} />
              )
            ) : (
              <p>{message.content}</p>
            )}
          </div>
          {message.error !== undefined && (
            <p className="yanyi-inline-error" role="alert">
              {message.error}
            </p>
          )}
          {message.citations !== undefined && message.citations.length > 0 && (
            <div className="yanyi-citations" aria-label="相关依据">
              <strong>相关依据</strong>
              {message.citations.map((citation) => (
                <button
                  disabled={citation.source !== 'page'}
                  key={citation.id}
                  onClick={() => void adapter.highlightSource(context, citation.excerpt)}
                  type="button"
                >
                  <span>
                    {citation.source === 'page'
                      ? '页面'
                      : citation.source === 'workspace'
                        ? '工作区'
                        : '背景'}
                  </span>
                  <strong>{citation.title}</strong>
                  <small>{citation.excerpt}</small>
                </button>
              ))}
            </div>
          )}
          <MessageActions message={message} onEdit={onEdit} onTerm={setTermMessage} />
          {termMessage?.id === message.id && (
            <div className="yanyi-term-editor" aria-label="保存术语译法">
              <label htmlFor={`term-${message.id}`}>
                确认“{context.selection.slice(0, 72)}”的译法
              </label>
              <input
                autoComplete="off"
                id={`term-${message.id}`}
                maxLength={500}
                name="confirmed-term-translation"
                onChange={(event) => setTermTarget(event.currentTarget.value)}
                placeholder="输入确认后的译法…"
                value={termTarget}
              />
              <div>
                <button onClick={() => setTermMessage(undefined)} type="button">
                  取消
                </button>
                <button
                  disabled={termTarget.trim() === ''}
                  onClick={() => {
                    void adapter
                      .saveGlossary(context.selection, termTarget.trim())
                      .then((saved) => {
                        setTermStatus(saved ? '术语已保存。' : '术语保存失败，请检查本地服务。');
                        if (saved) setTermMessage(undefined);
                      });
                  }}
                  type="button"
                >
                  保存术语
                </button>
              </div>
              {termStatus !== '' && <p role="status">{termStatus}</p>}
            </div>
          )}
        </article>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function ConversationComposer({ compact = false }: { compact?: boolean }) {
  const { startNewChat, stop, store, submit } = useController();
  const draft = useStore(store, (state) => state.draft);
  const status = useStore(store, (state) => state.status);
  const mode = useStore(store, (state) => state.knowledgeMode);
  const context = useStore(store, (state) => state.context);
  const modelReady = useStore(
    store,
    (state) => state.modelCatalogReady && state.modelSelectionReady,
  );
  const composing = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const running = status === 'sending' || status === 'streaming' || status === 'stopping';

  const submitDraft = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    if (running || !modelReady || draft.trim() === '') return;
    void submit(draft, 'follow_up');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      composing.current ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <form className="yanyi-composer" onSubmit={submitDraft}>
      <ModelControls compact={compact} />
      <div className="yanyi-composer__controls">
        <label>
          <span>回答范围</span>
          <select
            aria-label="回答知识范围"
            autoComplete="off"
            disabled={running}
            name="knowledge-mode"
            onChange={(event) =>
              store.getState().dispatch({
                type: 'knowledge.set',
                mode: event.currentTarget.value as KnowledgeMode,
              })
            }
            value={mode}
          >
            {knowledgeOptions.map((option) => (
              <option key={option.value} title={option.description} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {/* Available in both modes: this is the only action that starts a new
            conversation for the current site. */}
        <button disabled={running} onClick={() => void startNewChat()} type="button">
          新聊天
        </button>
      </div>
      <label className="yanyi-visually-hidden" htmlFor="yanyi-follow-up">
        继续询问
      </label>
      <div className="yanyi-composer__input">
        <textarea
          autoComplete="off"
          id="yanyi-follow-up"
          name="follow-up"
          maxLength={16_000}
          onChange={(event) =>
            store.getState().dispatch({ type: 'draft.set', draft: event.currentTarget.value })
          }
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onKeyDown={onKeyDown}
          placeholder={
            !modelReady
              ? '正在读取模型配置…'
              : context.selection.trim() === ''
                ? '先在网页中选择内容…'
                : '继续询问当前内容…'
          }
          ref={textareaRef}
          rows={compact ? 2 : 3}
          value={draft}
        />
        {running ? (
          <button
            aria-label="停止生成"
            className="yanyi-send yanyi-send--stop"
            disabled={status === 'stopping'}
            onClick={() => void stop()}
            type="button"
          >
            <Square aria-hidden="true" size={14} />
          </button>
        ) : (
          <button
            aria-label="发送"
            className="yanyi-send"
            disabled={!modelReady || draft.trim() === '' || context.selection.trim() === ''}
            type="submit"
          >
            <ArrowUp aria-hidden="true" size={16} />
          </button>
        )}
      </div>
      <div className="yanyi-composer__footnote">
        <small>模型回答可能有误，请核对页面依据。</small>
        <small>Enter 发送 · Shift + Enter 换行</small>
      </div>
    </form>
  );
}

function ModelControls({ compact }: { compact: boolean }) {
  const { adapter, store } = useController();
  const models = useStore(store, (state) => state.modelCatalog);
  const selection = useStore(store, (state) => state.modelSelection);
  const conversationId = useStore(store, (state) => state.conversationId);
  const running = useStore(
    store,
    (state) =>
      state.status === 'sending' || state.status === 'streaming' || state.status === 'stopping',
  );
  const error = useStore(store, (state) => state.modelError);
  const [providerId, setProviderId] = useState(
    selection?.providerId ?? models[0]?.providerId ?? 'deepseek',
  );
  const [verifying, setVerifying] = useState(false);
  const providers = useMemo(() => [...new Set(models.map((model) => model.providerId))], [models]);
  const providerModels = models.filter((model) => model.providerId === providerId);
  const activeSelection = selection?.providerId === providerId ? selection : undefined;
  const selectedModel = providerModels.find((model) => model.modelId === activeSelection?.modelId);

  useEffect(() => {
    if (!providers.includes(providerId) && providers[0] !== undefined) setProviderId(providers[0]);
  }, [providerId, providers]);

  useEffect(() => {
    if (selection?.providerId !== undefined && providers.includes(selection.providerId))
      setProviderId(selection.providerId);
  }, [providers, selection?.providerId]);

  const persist = async (
    modelId: string,
    thinkingEnabled: boolean,
    reasoningEffort?: 'high' | 'max',
  ) => {
    const option = models.find(
      (model) => model.providerId === providerId && model.modelId === modelId,
    );
    // Only a model the provider refuses is rejected. An unverified model is
    // selectable and runs with safe defaults.
    if (option !== undefined && modelState(option) === 'unavailable') {
      store.getState().dispatch({
        type: 'model.error',
        message: '所选模型当前不可用。研译不会自动切换模型或供应商。',
      });
      return;
    }
    if (thinkingEnabled && thinkingSupport(option) === 'unsupported') {
      store.getState().dispatch({
        type: 'model.error',
        message: '该模型已确认不支持思考模式，未发送不兼容参数。',
      });
      return;
    }
    const next = {
      scope: conversationId === undefined ? ('task' as const) : ('conversation' as const),
      scopeId: conversationId ?? 'assistant',
      task: 'assistant',
      providerId,
      modelId,
      thinkingEnabled,
      ...(thinkingEnabled && reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(activeSelection?.apiProfileId === undefined
        ? {}
        : { apiProfileId: activeSelection.apiProfileId }),
    };
    if (await adapter.saveModelSelection(next)) {
      store.getState().dispatch({ type: 'model.selection.loaded', selection: next });
    } else {
      store.getState().dispatch({
        type: 'model.error',
        message: '模型配置未保存；当前会话仍使用原配置。',
      });
    }
  };
  const thinking = thinkingControlState(selectedModel, running);
  const efforts = reasoningEffortOptions(selectedModel);

  /** Runs one user-initiated capability probe for the selected model. */
  const verify = async () => {
    if (selectedModel === undefined || adapter.verifyModelCapability === undefined) return;
    setVerifying(true);
    try {
      const result = await adapter.verifyModelCapability(
        providerId,
        selectedModel.modelId,
        // Probing thinking costs more, so only ask when its support is unknown.
        thinkingSupport(selectedModel) === 'unknown',
      );
      store.getState().dispatch({ type: 'model.error', message: result.message });
      if (result.models !== undefined && result.models.length > 0) {
        store.getState().dispatch({ type: 'model.catalog.loaded', models: result.models });
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className={`yanyi-model-controls ${compact ? 'is-compact' : ''}`}>
      <label>
        <span>Provider</span>
        <select
          aria-label="模型供应商"
          autoComplete="off"
          disabled={running || providers.length === 0}
          name="provider"
          onChange={(event) => setProviderId(event.currentTarget.value)}
          value={providerId}
        >
          {providers.length === 0 && <option value="deepseek">目录未连接</option>}
          {providers.map((provider) => (
            <option key={provider} translate="no" value={provider}>
              {provider === 'deepseek' ? 'DeepSeek' : provider}
            </option>
          ))}
        </select>
      </label>
      <label className="yanyi-model-controls__model">
        <span>模型</span>
        <select
          aria-label="会话模型"
          autoComplete="off"
          disabled={running || providerModels.length === 0}
          name="model"
          onChange={(event) => void persist(event.currentTarget.value, false)}
          value={activeSelection?.modelId ?? ''}
        >
          <option disabled value="">
            任务预设（当前）
          </option>
          {providerModels.map((model) => {
            const presentation = presentModel(model);
            return (
              <option
                // Only an unavailable model is unselectable.
                disabled={!presentation.selectable}
                key={`${model.providerId}:${model.modelId}`}
                translate="no"
                value={model.modelId}
              >
                {model.modelId}
                {presentation.badge === '' ? '' : ` · ${presentation.badge}`}
              </option>
            );
          })}
        </select>
      </label>
      <label>
        <span>思考</span>
        <select
          aria-label="思考模式"
          autoComplete="off"
          disabled={thinking.disabled || activeSelection === undefined}
          name="thinking-mode"
          title={thinking.hint}
          onChange={(event) =>
            void persist(
              activeSelection?.modelId ?? '',
              event.currentTarget.value === 'enabled',
              event.currentTarget.value === 'enabled' ? efforts[0] : undefined,
            )
          }
          value={activeSelection?.thinkingEnabled === true ? 'enabled' : 'disabled'}
        >
          <option value="disabled">关闭</option>
          <option value="enabled">启用</option>
        </select>
      </label>
      {activeSelection?.thinkingEnabled === true && efforts.length > 0 && (
        <label>
          <span>强度</span>
          <select
            aria-label="思考强度"
            autoComplete="off"
            disabled={running}
            name="reasoning-effort"
            onChange={(event) =>
              void persist(
                activeSelection.modelId,
                true,
                event.currentTarget.value as 'high' | 'max',
              )
            }
            value={activeSelection.reasoningEffort ?? efforts[0] ?? 'high'}
          >
            {efforts.map((effort) => (
              <option key={effort} value={effort}>
                {effort.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      )}
      {/* Verification is user initiated: research never runs bulk paid probes. */}
      {selectedModel !== undefined &&
        adapter.verifyModelCapability !== undefined &&
        (presentModel(selectedModel).canVerify || thinking.showVerify) && (
          <button
            className="yanyi-model-controls__verify"
            disabled={running || verifying}
            onClick={() => void verify()}
            title="对所选模型执行一次最小能力验证请求"
            type="button"
          >
            {verifying ? '验证中…' : '验证模型'}
          </button>
        )}
      {selectedModel !== undefined && thinking.label !== '思考模式' && (
        <span className="yanyi-model-controls__status" role="status">
          {thinking.label}
        </span>
      )}
      {error !== undefined && (
        <span className="yanyi-model-controls__error" role="status">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Shortcut intents. "解释这段" is one of these rather than a separate feature:
 * clicking it sends an ordinary follow-up message through the same chat pipeline,
 * so there is no second conversation system to maintain.
 */
const quickIntentPrompts: readonly {
  label: string;
  prompt: string;
  intent: AssistantIntent;
}[] = [
  // 'explain' keeps the explanation task preset from AGENT.md; it is still the
  // same chat pipeline and the same conversation, just a preset prompt.
  { label: '解释这段', prompt: '请结合当前页面语境解释所选内容。', intent: 'explain' },
  { label: '总结', prompt: '请用要点总结所选内容。', intent: 'follow_up' },
  { label: '为什么', prompt: '请说明所选内容为什么如此设计或成立。', intent: 'follow_up' },
  { label: '举例', prompt: '请给出一个具体例子说明所选内容。', intent: 'follow_up' },
];

function QuickIntents() {
  const { store, submit } = useController();
  const running = useStore(
    store,
    (state) =>
      state.status === 'sending' || state.status === 'streaming' || state.status === 'stopping',
  );
  const ready = useStore(store, (state) => state.modelCatalogReady && state.modelSelectionReady);
  const hasSelection = useStore(store, (state) => state.context.selection.trim() !== '');

  return (
    <div className="yanyi-quick-intents" role="group" aria-label="快捷提问">
      {quickIntentPrompts.map(({ label, prompt, intent }) => (
        <button
          disabled={running || !ready || !hasSelection}
          key={label}
          onClick={() => void submit(prompt, intent)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export interface ConversationPanelProps {
  compact?: boolean;
  autoPrompt?: { key: string; prompt: string; intent: AssistantIntent };
  beforeTimeline?: ReactNode;
  /** Shows the shortcut intent row (used by the selection popover). */
  quickIntents?: boolean;
}

export function ConversationPanel({
  compact = false,
  autoPrompt,
  beforeTimeline,
  quickIntents = false,
}: ConversationPanelProps) {
  const { store, submit } = useController();
  const announcement = useStore(store, (state) => state.announcement);
  const modelReady = useStore(
    store,
    (state) => state.modelCatalogReady && state.modelSelectionReady,
  );
  const startedKey = useRef<string | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modelReady || autoPrompt === undefined || startedKey.current === autoPrompt.key) return;
    startedKey.current = autoPrompt.key;
    void submit(autoPrompt.prompt, autoPrompt.intent);
  }, [autoPrompt, modelReady, submit]);

  const editMessage = (content: string) => {
    store.getState().dispatch({ type: 'draft.set', draft: content });
    queueMicrotask(() =>
      panelRef.current?.querySelector<HTMLTextAreaElement>('#yanyi-follow-up')?.focus(),
    );
  };

  return (
    <div
      className={`yanyi-conversation ${compact ? 'yanyi-conversation--compact' : ''}`}
      ref={panelRef}
    >
      <ContextSourceBar compact={compact} />
      {quickIntents && <QuickIntents />}
      <div className="yanyi-conversation__stream">
        {beforeTimeline}
        <MessageTimeline onEdit={editMessage} />
      </div>
      <ConversationComposer compact={compact} />
      <span aria-live="polite" className="yanyi-visually-hidden" role="status">
        {announcement}
      </span>
    </div>
  );
}
