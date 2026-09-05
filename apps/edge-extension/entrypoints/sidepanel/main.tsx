import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import ReactDOM from 'react-dom/client';
import {
  BookOpen,
  MessageSquareText,
  NotebookPen,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  Tag,
} from 'lucide-react';
import { browser } from 'wxt/browser';
import type { AssistantIntent } from '@yanyi/protocol';
import type { PopupSnapshot } from '@yanyi/shared-types';
import '@yanyi/design-tokens/tokens.css';
import { assistantStyles } from '../assistant/assistantStyles';
import {
  applyAssistantStreamEvent,
  ConversationPanel,
  ConversationProvider,
} from '../assistant/ConversationPanel';
import { createBrowserAssistantAdapter } from '../assistant/browserAssistantAdapter';
import { createConversationStore } from '../assistant/conversationStore';
import type { AssistantAdapter, SelectionContext } from '../assistant/types';
import { createSidePanelSelectionLaunch } from './selectionLaunch';
import './sidepanel.css';

type SidePanelView = 'assistant' | 'page' | 'notes';

/** URL of the tab the Side Panel is attached to, used to scope conversation restore. */
async function activeTabUrl(): Promise<string | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return tab?.url;
}

const views = [
  { id: 'assistant', label: '助手', icon: MessageSquareText },
  { id: 'page', label: '页面', icon: BookOpen },
  { id: 'notes', label: '笔记', icon: NotebookPen },
] as const;

function PageTranslationView() {
  const [snapshot, setSnapshot] = useState<PopupSnapshot>();

  useEffect(() => {
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        const response: unknown = await browser.runtime
          .sendMessage({ type: 'yanyi.status.get', tabId: tab?.id })
          .catch(() => undefined);
        if (active && typeof response === 'object' && response !== null && 'snapshot' in response)
          setSnapshot((response as { snapshot: PopupSnapshot }).snapshot);
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 750);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const control = async (
    type:
      | 'yanyi.translation.pause'
      | 'yanyi.translation.resume'
      | 'yanyi.translation.cancel'
      | 'yanyi.translation.restore',
  ) => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    await browser.runtime.sendMessage({ type, tabId: tab?.id }).catch(() => undefined);
  };
  const completed = snapshot?.completedSegments ?? 0;
  const total = snapshot?.totalSegments ?? 0;
  const progress = total === 0 ? 0 : Math.min(100, Math.round((completed / total) * 100));
  const connected = snapshot?.connection === 'connected';

  return (
    <section className="sidepanel-page" aria-labelledby="page-translation-heading">
      <div className="sidepanel-section-heading">
        <div>
          <span>PAGE TRANSLATION</span>
          <h2 id="page-translation-heading">当前页面</h2>
        </div>
        <span className={`sidepanel-connection ${connected ? 'is-connected' : ''}`}>
          {connected ? '本地服务已连接' : '等待本地服务'}
        </span>
      </div>
      <div className="sidepanel-progress-card" aria-live="polite">
        <div>
          <strong>
            {snapshot?.page === 'translating'
              ? '正在翻译'
              : snapshot?.page === 'paused'
                ? '翻译已暂停'
                : snapshot?.page === 'translated'
                  ? '翻译已完成'
                  : snapshot?.page === 'error'
                    ? '页面翻译失败'
                    : '等待开始'}
          </strong>
          <span>{total > 0 ? `${String(completed)} / ${String(total)}` : '尚无任务'}</span>
        </div>
        <div
          aria-label={`翻译进度 ${String(progress)}%`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
          className="sidepanel-progress-track"
          role="progressbar"
        >
          <span style={{ width: `${String(progress)}%` }} />
        </div>
        <p>{snapshot?.message ?? '代码、公式和链接保持原样；完整片段通过校验后才会写回页面。'}</p>
        <div className="sidepanel-page-actions">
          {snapshot?.page === 'translating' && (
            <button onClick={() => void control('yanyi.translation.pause')} type="button">
              <Pause aria-hidden="true" size={14} /> 暂停
            </button>
          )}
          {snapshot?.page === 'paused' && (
            <button
              className="is-primary"
              onClick={() => void control('yanyi.translation.resume')}
              type="button"
            >
              <Play aria-hidden="true" size={14} /> 继续
            </button>
          )}
          {(snapshot?.page === 'translating' || snapshot?.page === 'paused') && (
            <button onClick={() => void control('yanyi.translation.cancel')} type="button">
              <Square aria-hidden="true" size={13} /> 取消
            </button>
          )}
          {(snapshot?.page === 'translated' || completed > 0) && (
            <button onClick={() => void control('yanyi.translation.restore')} type="button">
              <RotateCcw aria-hidden="true" size={14} /> 还原本页
            </button>
          )}
        </div>
      </div>
      <div className="sidepanel-page-guidance">
        <ShieldCheck aria-hidden="true" size={17} />
        <div>
          <strong>页面安全承诺</strong>
          <p>失败片段保留原文；还原使用本地快照，不执行反向翻译。</p>
        </div>
      </div>
    </section>
  );
}

function NotesView({
  adapter,
  selection,
}: {
  adapter: AssistantAdapter;
  selection: SelectionContext | undefined;
}) {
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const save = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    const content = note.trim();
    if (content === '') return;
    setStatus('正在保存…');
    const saved = await adapter.saveNote(content, selection?.text);
    setStatus(saved ? '笔记已保存到本地数据库。' : '笔记保存失败，请检查本地服务。');
    if (saved) setNote('');
  };
  return (
    <section className="sidepanel-notes" aria-labelledby="notes-heading">
      <div className="sidepanel-section-heading">
        <div>
          <span>LOCAL NOTE</span>
          <h2 id="notes-heading">记录当前理解</h2>
        </div>
      </div>
      {selection !== undefined && (
        <blockquote>
          <span>来源选区</span>
          {selection.text}
        </blockquote>
      )}
      <form onSubmit={(event) => void save(event)}>
        <label htmlFor="sidepanel-note">笔记内容</label>
        <textarea
          autoComplete="off"
          id="sidepanel-note"
          maxLength={16_000}
          name="note-content"
          onChange={(event) => setNote(event.currentTarget.value)}
          placeholder="记录你的理解；来源选区会单独保存…"
          rows={7}
          value={note}
        />
        <button disabled={note.trim() === ''} type="submit">
          保存笔记
        </button>
      </form>
      {status !== '' && <p role="status">{status}</p>}
    </section>
  );
}

function SelectionDataAction({
  adapter,
  selection,
}: {
  adapter: AssistantAdapter;
  selection: SelectionContext | undefined;
}) {
  const [target, setTarget] = useState('');
  const [status, setStatus] = useState('');
  if (selection?.intent !== 'glossary' && selection?.intent !== 'protect') return null;
  const source = selection.text.trim();
  return (
    <aside className="sidepanel-selection-action">
      <div>
        <Tag aria-hidden="true" size={15} />
        <strong>{selection.intent === 'protect' ? '保护原文' : '保存术语译法'}</strong>
      </div>
      <p>{source.slice(0, 180)}</p>
      {selection.intent === 'glossary' && (
        <input
          aria-label="确认后的中文译法"
          autoComplete="off"
          name="confirmed-selection-translation"
          maxLength={500}
          onChange={(event) => setTarget(event.currentTarget.value)}
          placeholder="输入确认后的中文译法…"
          value={target}
        />
      )}
      <button
        disabled={source === '' || (selection.intent === 'glossary' && target.trim() === '')}
        onClick={() => {
          void (
            selection.intent === 'protect'
              ? adapter.protectTerm(source)
              : adapter.saveGlossary(source, target.trim())
          ).then((saved) =>
            setStatus(saved ? '规则已保存并参与后续翻译。' : '保存失败，请检查本地服务。'),
          );
        }}
        type="button"
      >
        {selection.intent === 'protect' ? '设为永不翻译' : '保存术语'}
      </button>
      {status !== '' && <span role="status">{status}</span>}
    </aside>
  );
}

export function SidePanelApp() {
  const adapter = useMemo(() => createBrowserAssistantAdapter(), []);
  const store = useMemo(() => createConversationStore(), []);
  const [view, setView] = useState<SidePanelView>('assistant');
  const [selection, setSelection] = useState<SelectionContext>();
  const [autoPrompt, setAutoPrompt] = useState<
    { key: string; prompt: string; intent: AssistantIntent } | undefined
  >();

  useEffect(() => {
    let active = true;
    void (async () => {
      const [handoff, nextSelection] = await Promise.all([
        adapter.loadHandoff(),
        adapter.consumeSelection(),
      ]);
      if (!active) return;
      // Restoring the active conversation is scoped to the site the Side Panel is
      // showing, so opening it on a different site does not resurrect that thread.
      const restoreUrl = nextSelection?.url ?? (await activeTabUrl());
      const activeReference =
        handoff === undefined
          ? await (adapter.loadActiveConversation?.(restoreUrl) ?? Promise.resolve(undefined))
          : undefined;
      if (!active) return;
      if (handoff !== undefined) {
        store.getState().dispatch({ type: 'handoff.hydrate', handoff });
        if (handoff.activeTaskId !== undefined) {
          void adapter.loadTerminalEvent?.(handoff.activeTaskId).then((event) => {
            if (active && event !== undefined) applyAssistantStreamEvent(store, event);
          });
        }
      } else if (activeReference !== undefined && adapter.loadConversation !== undefined) {
        const restored = await adapter.loadConversation(activeReference.conversationId);
        if (!active) return;
        if (restored !== undefined)
          store.getState().dispatch({
            type: 'conversation.restore',
            conversation: restored,
            context: restored.context,
          });
      }
      const launch = createSidePanelSelectionLaunch(nextSelection);
      if (launch === undefined) return;
      setSelection(launch.selection);
      if (handoff === undefined)
        store.getState().dispatch({
          type: 'context.set',
          context: launch.context,
        });
      setView(launch.view);
      if (handoff === undefined && launch.autoPrompt !== undefined)
        setAutoPrompt(launch.autoPrompt);
    })();
    return () => {
      active = false;
    };
  }, [adapter, store]);

  return (
    <main className="sidepanel-shell yanyi-theme">
      <style>{assistantStyles}</style>
      <header className="sidepanel-header">
        <span aria-hidden="true" className="sidepanel-logo">
          研
        </span>
        <div>
          <h1>研译助手</h1>
          <p>{selection?.title ?? '技术阅读上下文助手'}</p>
        </div>
        <span className="sidepanel-model">任务模型</span>
      </header>
      <a className="sidepanel-skip" href="#sidepanel-main-content">
        跳到主要内容
      </a>
      <nav aria-label="侧边栏功能">
        {views.map(({ id, label, icon: Icon }) => (
          <button
            aria-current={view === id ? 'page' : undefined}
            className={view === id ? 'active' : ''}
            key={id}
            onClick={() => setView(id)}
            type="button"
          >
            <Icon aria-hidden="true" size={15} /> {label}
          </button>
        ))}
      </nav>
      <div className="sidepanel-content" id="sidepanel-main-content" tabIndex={-1}>
        {view === 'assistant' && (
          <ConversationProvider adapter={adapter} store={store}>
            <ConversationPanel
              beforeTimeline={<SelectionDataAction adapter={adapter} selection={selection} />}
              {...(autoPrompt === undefined ? {} : { autoPrompt })}
            />
          </ConversationProvider>
        )}
        {view === 'page' && <PageTranslationView />}
        {view === 'notes' && <NotesView adapter={adapter} selection={selection} />}
      </div>
    </main>
  );
}

const root = document.querySelector('#root');
if (root instanceof HTMLElement) ReactDOM.createRoot(root).render(<SidePanelApp />);
