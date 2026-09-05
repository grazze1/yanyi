import { type ReactNode, type SyntheticEvent, useCallback, useEffect, useState } from 'react';
import {
  Archive,
  BadgeCheck,
  BookOpenCheck,
  BrainCircuit,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Cpu,
  Database,
  FileClock,
  Globe2,
  FolderOpen,
  History,
  KeyRound,
  LibraryBig,
  LoaderCircle,
  MemoryStick,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Wifi,
} from 'lucide-react';
import {
  desktopApi,
  type ApiConfigStatus,
  type CandidateTermRecord,
  type ConversationDetailRecord,
  type ConversationRecord,
  type ConversationStatus,
  type DashboardSummary,
  type EnvironmentStatus,
  type GlossaryEntryRecord,
  globalMemoryTypeLabels,
  globalMemoryTypes,
  type GlobalMemoryImportPreview,
  type GlobalMemoryInput,
  type GlobalMemoryRecord,
  type GlobalMemoryType,
  type MemoryCandidateRecord,
  type ModelCatalogRecord,
  type ModelSelectionRecord,
  type TaskPresetRecord,
  type WebsiteRuleRecord,
} from './desktopApi';

type Page =
  | 'home'
  | 'workspaces'
  | 'glossary'
  | 'candidates'
  | 'rules'
  | 'history'
  | 'memory'
  | 'settings'
  | 'diagnostics';
const navigation: readonly [Page, typeof BookOpenCheck, string][] = [
  ['home', BookOpenCheck, '首页'],
  ['workspaces', BriefcaseBusiness, '工作区'],
  ['glossary', LibraryBig, '术语库'],
  ['candidates', FileClock, '候选术语'],
  ['rules', Globe2, '网站规则'],
  ['history', History, '历史对话'],
  ['memory', MemoryStick, '记忆管理'],
  ['settings', Settings, '模型与 API'],
  ['diagnostics', ShieldCheck, '数据与诊断'],
];

function useLoad<T>(loader: () => Promise<T>, dependencies: readonly unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError(undefined);
    void loader()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [...dependencies, version]);
  return { data, error, refresh };
}

function StateFrame<T>({
  data,
  error,
  children,
}: {
  data: T | undefined;
  error: string | undefined;
  refresh?: () => void;
  children: (data: T) => ReactNode;
}) {
  if (error !== undefined)
    return (
      <div className="inline-state inline-state--error" role="alert">
        <strong>无法读取本地数据</strong>
        <span>{error}</span>
      </div>
    );
  if (data === undefined)
    return (
      <div className="inline-state" aria-live="polite">
        <LoaderCircle className="spin" aria-hidden="true" size={20} />
        正在读取 SQLite…
      </div>
    );
  return children(data);
}

function PageHeader({
  eyebrow,
  title,
  description,
  onRefresh,
}: {
  eyebrow: string;
  title: string;
  description: string;
  onRefresh?: () => void;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {onRefresh !== undefined && (
        <button className="icon-button" aria-label="刷新当前页面" title="刷新" onClick={onRefresh}>
          <RefreshCw aria-hidden="true" size={18} />
        </button>
      )}
    </header>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function HomePage() {
  const summary = useLoad(desktopApi.dashboard, []);
  const cards: readonly [keyof DashboardSummary, string][] = [
    ['workspaces', '工作区'],
    ['glossaryEntries', '正式术语'],
    ['candidateTerms', '待确认术语'],
    ['conversations', '历史会话'],
    ['confirmedMemories', '确认记忆'],
    ['translatedPages', '翻译页面'],
    ['cacheEntries', '缓存条目'],
  ];
  return (
    <>
      <PageHeader
        eyebrow="LOCAL KNOWLEDGE DESK"
        title="阅读资产总览"
        description="工作区、术语与记忆只保存在本机 SQLite。"
        onRefresh={summary.refresh}
      />
      <StateFrame<DashboardSummary> {...summary}>
        {(data) => (
          <div className="metric-grid">
            {cards.map(([key, label]) => (
              <article key={key}>
                <span>{label}</span>
                <strong>{data[key]}</strong>
              </article>
            ))}
          </div>
        )}
      </StateFrame>
      <section className="notice-card">
        <ShieldCheck aria-hidden="true" size={22} />
        <div>
          <strong>本地优先边界</strong>
          <p>网页内容只能通过受限协议进入 Native Host；API Key 使用 Windows DPAPI 保存。</p>
        </div>
      </section>
    </>
  );
}

function WorkspacesPage() {
  const state = useLoad(desktopApi.workspaces, []);
  const [pending, setPending] = useState(false);
  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const domain = formText(form, 'domain');
    setPending(true);
    try {
      await desktopApi.saveWorkspace({
        name: formText(form, 'name'),
        description: formText(form, 'description'),
        primaryDomain: domain === '' ? undefined : domain,
      });
      target.reset();
      state.refresh();
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACES"
        title="工作区"
        description="隔离文档、术语、会话和长期记忆。"
        onRefresh={state.refresh}
      />
      <form className="quick-form" onSubmit={(event) => void submit(event)}>
        <label>
          名称
          <input name="name" required maxLength={80} placeholder="例如：PX4 学习" />
        </label>
        <label>
          主要领域
          <input name="domain" maxLength={80} placeholder="机器人学" />
        </label>
        <label className="grow">
          描述
          <input name="description" maxLength={240} placeholder="这个工作区用于什么" />
        </label>
        <button className="primary-button" disabled={pending}>
          {pending ? '保存中…' : '创建工作区'}
        </button>
      </form>
      <StateFrame {...state}>
        {(items) =>
          items.length === 0 ? (
            <Empty title="还没有工作区" detail="创建一个工作区后，术语和记忆会按项目隔离。" />
          ) : (
            <div className="record-grid">
              {items.map((item) => (
                <article key={item.id} className={item.archivedAt ? 'muted-record' : ''}>
                  <div>
                    <span className="record-kicker">{item.primaryDomain ?? '未指定领域'}</span>
                    <h2>{item.name}</h2>
                    <p>{item.description || '暂无描述'}</p>
                  </div>
                  <div className="row-actions">
                    <button
                      onClick={() =>
                        void desktopApi
                          .archiveWorkspace(item.id, !item.archivedAt)
                          .then(state.refresh)
                      }
                    >
                      {item.archivedAt ? '恢复' : '归档'}
                    </button>
                    <button
                      className="danger-quiet"
                      aria-label={`删除 ${item.name}`}
                      onClick={() => {
                        if (confirm(`删除工作区“${item.name}”？关联数据将按数据库外键策略处理。`))
                          void desktopApi.deleteWorkspace(item.id).then(state.refresh);
                      }}
                    >
                      <Trash2 aria-hidden="true" size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )
        }
      </StateFrame>
    </>
  );
}

function GlossaryPage() {
  const [search, setSearch] = useState('');
  const [transfer, setTransfer] = useState('');
  const state = useLoad(() => desktopApi.glossary(search), [search]);
  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const targetTerm = formText(form, 'target');
    await desktopApi.saveGlossary({
      sourceTerm: formText(form, 'source'),
      targetTerm: targetTerm === '' ? undefined : targetTerm,
      strategy: formText(form, 'strategy'),
      scope: formText(form, 'scope'),
    });
    target.reset();
    state.refresh();
  }
  async function importGlossary(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setTransfer('正在验证并导入…');
    try {
      const result = await desktopApi.importGlossary(
        formText(form, 'path'),
        formText(form, 'strategy') as 'merge' | 'overwrite' | 'skip',
      );
      setTransfer(
        `已导入 ${String(result.inserted)} 条，更新 ${String(result.updated)} 条，跳过 ${String(result.skipped)} 条。`,
      );
      state.refresh();
    } catch (reason) {
      setTransfer(reason instanceof Error ? reason.message : String(reason));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="TERMINOLOGY"
        title="术语库"
        description="用户确认译法始终覆盖模型判断。"
        onRefresh={state.refresh}
      />
      <form className="quick-form" onSubmit={(e) => void submit(e)}>
        <label>
          原文术语
          <input name="source" required maxLength={160} />
        </label>
        <label>
          中文译法
          <input name="target" maxLength={160} />
        </label>
        <label>
          策略
          <select name="strategy">
            <option value="fixed">固定翻译</option>
            <option value="never_translate">永不翻译</option>
            <option value="polysemous">多义术语</option>
            <option value="first_with_source">首次附原文</option>
            <option value="always_with_source">始终附原文</option>
          </select>
        </label>
        <label>
          范围
          <select name="scope">
            <option value="global">全局</option>
            <option value="workspace">工作区</option>
            <option value="current_site">当前网站</option>
            <option value="page_temporary">当前页面</option>
          </select>
        </label>
        <button className="primary-button">保存术语</button>
      </form>
      <label className="search-box">
        <Search aria-hidden="true" size={17} />
        <span className="sr-only">搜索术语</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索原文或译文"
        />
      </label>
      <StateFrame {...state}>
        {(items: GlossaryEntryRecord[]) =>
          items.length === 0 ? (
            <Empty title="没有匹配术语" detail="新增固定译法、永不翻译词或多义词规则。" />
          ) : (
            <div className="data-table" role="table">
              <div className="table-head" role="row">
                <span>原文</span>
                <span>译法</span>
                <span>策略 / 范围</span>
                <span>操作</span>
              </div>
              {items.map((item) => (
                <div className="table-row" role="row" key={item.id}>
                  <code>{item.sourceTerm}</code>
                  <strong>{item.targetTerm ?? '保留原文'}</strong>
                  <span>
                    {item.strategy} · {item.scope}
                  </span>
                  <button
                    className="danger-quiet"
                    onClick={() => void desktopApi.deleteGlossary(item.id).then(state.refresh)}
                    aria-label={`删除术语 ${item.sourceTerm}`}
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                </div>
              ))}
            </div>
          )
        }
      </StateFrame>
      <section className="notice-card">
        <div>
          <strong>术语导入与导出</strong>
          <p>JSON 导入会校验大小、结构、策略和作用域；导出文件写入本地 exports 目录。</p>
          <button
            onClick={() =>
              void desktopApi.exportGlossary().then((path) => setTransfer(`已导出：${path}`))
            }
          >
            导出 JSON
          </button>
        </div>
      </section>
      <form className="quick-form" onSubmit={(event) => void importGlossary(event)}>
        <label className="grow">
          JSON 文件路径
          <input name="path" required placeholder="C:\\Users\\…\\glossary.json" />
        </label>
        <label>
          冲突策略
          <select name="strategy">
            <option value="merge">合并</option>
            <option value="overwrite">覆盖</option>
            <option value="skip">跳过</option>
          </select>
        </label>
        <button>验证并导入</button>
      </form>
      {transfer !== '' && (
        <p className="operation-message" role="status">
          {transfer}
        </p>
      )}
    </>
  );
}

function CandidatesPage() {
  const state = useLoad(desktopApi.candidates, []);
  return (
    <>
      <PageHeader
        eyebrow="TERM INBOX"
        title="候选术语"
        description="候选项不会自动写入正式术语库。"
        onRefresh={state.refresh}
      />
      <StateFrame {...state}>
        {(items: CandidateTermRecord[]) =>
          items.length === 0 ? (
            <Empty title="没有待确认候选" detail="翻译页面后，高频专业实体会在这里等待确认。" />
          ) : (
            <div className="record-list">
              {items.map((item) => (
                <article key={item.id}>
                  <div>
                    <code>{item.sourceTerm}</code>
                    <strong>{item.suggestedTranslation ?? '暂无建议译法'}</strong>
                    <p>{item.exampleText ?? '没有保存页面正文示例'}</p>
                  </div>
                  <span className="confidence">
                    出现 {String(item.occurrenceCount)} 次
                    {item.confidence !== undefined
                      ? ` · ${String(Math.round(item.confidence * 100))}%`
                      : ''}
                  </span>
                  <div className="row-actions">
                    <button
                      onClick={() =>
                        void desktopApi.setCandidateState(item.id, 'accepted').then(state.refresh)
                      }
                    >
                      接受
                    </button>
                    <button
                      onClick={() =>
                        void desktopApi.setCandidateState(item.id, 'ignored').then(state.refresh)
                      }
                    >
                      忽略
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )
        }
      </StateFrame>
    </>
  );
}

function RulesPage() {
  const state = useLoad(desktopApi.websiteRules, []);
  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const path = formText(form, 'path');
    await desktopApi.saveWebsiteRule({
      domainPattern: formText(form, 'domain'),
      urlPattern: path === '' ? undefined : path,
      defaultMode: 'below',
      translateNewContent: true,
      autoTranslate: false,
      translateNavigation: false,
      translateButtons: false,
      translateTables: true,
      protectLinkText: true,
      pdfStrategy: 'selection_only',
    });
    target.reset();
    state.refresh();
  }
  return (
    <>
      <PageHeader
        eyebrow="SITE POLICIES"
        title="网站规则"
        description="按域名和路径控制正文范围、动态内容与保护策略。"
        onRefresh={state.refresh}
      />
      <form className="quick-form" onSubmit={(e) => void submit(e)}>
        <label>
          域名
          <input name="domain" required placeholder="docs.ros.org" />
        </label>
        <label className="grow">
          路径前缀
          <input name="path" placeholder="/en/jazzy/" />
        </label>
        <button className="primary-button">添加规则</button>
      </form>
      <StateFrame {...state}>
        {(items: WebsiteRuleRecord[]) =>
          items.length === 0 ? (
            <Empty title="没有网站规则" detail="添加规则后可为文档站设置稳定的翻译范围。" />
          ) : (
            <div className="record-list">
              {items.map((item) => (
                <article key={item.id}>
                  <div>
                    <code>
                      {item.domainPattern}
                      {item.urlPattern ?? ''}
                    </code>
                    <p>
                      {item.dynamicStrategy} · 表格{item.translateTables ? '开启' : '关闭'} ·
                      链接保护{item.protectLinkText ? '开启' : '关闭'}
                    </p>
                  </div>
                  <span className="version-badge">
                    v{String(item.version)}
                    {item.isBuiltin ? ' · 内置' : ''}
                  </span>
                </article>
              ))}
            </div>
          )
        }
      </StateFrame>
    </>
  );
}

const localDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatLocalTime(value: string | undefined): string {
  if (value === undefined || value === '') return '尚无消息';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value.slice(0, 16) : localDateTimeFormatter.format(date);
}

const conversationStatusLabels: Record<ConversationStatus, string> = {
  active: '进行中',
  archived: '已归档',
  legacy: '旧版记录',
};

function HistoryPage() {
  const pageSize = 20;
  const messagePageSize = 40;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ConversationStatus>('active');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [messageOffset, setMessageOffset] = useState(0);
  const [operation, setOperation] = useState('');
  const list = useLoad(
    () => desktopApi.conversations({ search, status, offset, limit: pageSize }),
    [search, status, offset],
  );
  const detail = useLoad<ConversationDetailRecord | null>(
    () =>
      selectedId === undefined
        ? Promise.resolve(null)
        : desktopApi.conversation(selectedId, messageOffset, messagePageSize),
    [selectedId, messageOffset],
  );

  async function renameConversation(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
    conversationId: string,
  ) {
    event.preventDefault();
    const title = formText(new FormData(event.currentTarget), 'title');
    setOperation('正在保存标题…');
    try {
      await desktopApi.renameConversation(conversationId, title);
      setOperation('标题已保存。');
      list.refresh();
      detail.refresh();
    } catch (reason) {
      setOperation(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function toggleArchive(item: ConversationRecord) {
    setOperation(item.status === 'archived' ? '正在恢复会话…' : '正在归档会话…');
    try {
      await desktopApi.archiveConversation(item.id, item.status !== 'archived');
      setOperation(item.status === 'archived' ? '会话已恢复。' : '会话已归档。');
      setSelectedId(undefined);
      list.refresh();
    } catch (reason) {
      setOperation(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function copyConversationId(conversationId: string) {
    try {
      await navigator.clipboard.writeText(conversationId);
      setOperation('会话 ID 已复制，可交给浏览器助手继续同一会话。');
    } catch {
      setOperation(`无法访问剪贴板。请手动复制：${conversationId}`);
    }
  }

  async function permanentlyDeleteConversation(item: ConversationRecord) {
    const confirmed = confirm(
      `永久删除“${item.title}”？此操作会删除全部消息。建议先在数据与诊断页备份数据库。`,
    );
    if (!confirmed) return;
    setOperation('正在永久删除会话…');
    try {
      await desktopApi.deleteConversation(item.id, true);
      setSelectedId(undefined);
      setOperation('会话已永久删除。');
      list.refresh();
    } catch (reason) {
      setOperation(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="CONVERSATION LEDGER"
        title="历史对话"
        description="按状态检索本地会话，核对消息链并恢复准确的 conversation ID。"
        onRefresh={() => {
          list.refresh();
          detail.refresh();
        }}
      />
      <div className="history-controls">
        <label className="search-box">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">搜索历史对话</span>
          <input
            name="conversationSearch"
            type="search"
            autoComplete="off"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
              setSelectedId(undefined);
            }}
            placeholder="搜索标题或消息内容…"
          />
        </label>
        <div className="status-tabs" aria-label="会话状态筛选">
          {(['active', 'archived', 'legacy'] as const).map((value) => (
            <button
              key={value}
              className={status === value ? 'active' : ''}
              aria-pressed={status === value}
              onClick={() => {
                setStatus(value);
                setOffset(0);
                setSelectedId(undefined);
              }}
            >
              {conversationStatusLabels[value]}
            </button>
          ))}
        </div>
      </div>
      <div className="history-workbench">
        <section className="history-index" aria-label="会话列表">
          <StateFrame {...list}>
            {(items) =>
              items.length === 0 ? (
                <Empty
                  title={`没有${conversationStatusLabels[status]}会话`}
                  detail="解释或追问完成后，会话会自动保存在本机。"
                />
              ) : (
                <div className="history-index-list">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      className={
                        selectedId === item.id ? 'history-index-row active' : 'history-index-row'
                      }
                      aria-pressed={selectedId === item.id}
                      onClick={() => {
                        setSelectedId(item.id);
                        setMessageOffset(0);
                        setOperation('');
                      }}
                    >
                      <span className="history-row-heading">
                        <strong>{item.title}</strong>
                        <small>{conversationStatusLabels[item.status]}</small>
                      </span>
                      <span>{item.lastMessage || '尚无消息内容'}</span>
                      <time>{formatLocalTime(item.lastMessageAt ?? item.updatedAt)}</time>
                    </button>
                  ))}
                </div>
              )
            }
          </StateFrame>
          <div className="pager" aria-label="会话列表分页">
            <button
              disabled={offset === 0}
              onClick={() => {
                setOffset(Math.max(0, offset - pageSize));
                setSelectedId(undefined);
              }}
            >
              <ChevronLeft aria-hidden="true" size={15} />
              上一页
            </button>
            <span>第 {String(Math.floor(offset / pageSize) + 1)} 页</span>
            <button
              disabled={(list.data?.length ?? 0) < pageSize}
              onClick={() => {
                setOffset(offset + pageSize);
                setSelectedId(undefined);
              }}
            >
              下一页
              <ChevronRight aria-hidden="true" size={15} />
            </button>
          </div>
        </section>
        <section className="conversation-detail" aria-label="会话详情">
          {selectedId === undefined ? (
            <Empty title="选择一条会话" detail="消息、模型与可恢复的会话 ID 会显示在这里。" />
          ) : (
            <StateFrame {...detail}>
              {(record) =>
                record === null ? (
                  <Empty title="会话不可用" detail="该会话可能已被删除。" />
                ) : (
                  <>
                    <div className="conversation-ledger">
                      <div>
                        <span>CONVERSATION ID</span>
                        <code translate="no" title={record.conversation.id}>
                          {record.conversation.id}
                        </code>
                      </div>
                      <dl>
                        <div>
                          <dt>状态</dt>
                          <dd>{conversationStatusLabels[record.conversation.status]}</dd>
                        </div>
                        <div>
                          <dt>知识范围</dt>
                          <dd>{record.conversation.knowledgeMode}</dd>
                        </div>
                        <div>
                          <dt>当前模型</dt>
                          <dd>{record.conversation.currentModelId ?? '未记录'}</dd>
                        </div>
                      </dl>
                      <button onClick={() => void copyConversationId(record.conversation.id)}>
                        <Copy aria-hidden="true" size={15} />
                        复制 ID
                      </button>
                    </div>
                    <div className="conversation-heading">
                      <form
                        key={record.conversation.id}
                        onSubmit={(event) => void renameConversation(event, record.conversation.id)}
                      >
                        <label>
                          <span className="sr-only">会话标题</span>
                          <input
                            name="title"
                            required
                            maxLength={200}
                            autoComplete="off"
                            defaultValue={record.conversation.title}
                          />
                        </label>
                        <button title="保存标题">
                          <Save aria-hidden="true" size={15} />
                          保存标题
                        </button>
                      </form>
                      <div className="row-actions">
                        <button onClick={() => void toggleArchive(record.conversation)}>
                          {record.conversation.status === 'archived' ? (
                            <RotateCcw aria-hidden="true" size={15} />
                          ) : (
                            <Archive aria-hidden="true" size={15} />
                          )}
                          {record.conversation.status === 'archived' ? '恢复' : '归档'}
                        </button>
                        <button
                          className="danger-quiet"
                          onClick={() => void permanentlyDeleteConversation(record.conversation)}
                        >
                          <Trash2 aria-hidden="true" size={15} />
                          删除
                        </button>
                      </div>
                    </div>
                    <div className="message-ledger" aria-label="消息时间线">
                      {record.messages.length === 0 ? (
                        <Empty
                          title="该会话没有消息"
                          detail="会话元数据仍会保留，直到你主动删除。"
                        />
                      ) : (
                        record.messages.map((message) => (
                          <article
                            key={message.id}
                            className={`message-entry message-entry--${message.role}`}
                          >
                            <header>
                              <span>
                                {message.role === 'user'
                                  ? '你'
                                  : message.role === 'assistant'
                                    ? '研译助手 · AI 生成'
                                    : message.role}
                              </span>
                              <small>
                                #{String(message.sequence + 1)} ·{' '}
                                {formatLocalTime(message.createdAt)}
                              </small>
                            </header>
                            <p>{message.content}</p>
                            {message.contentTruncated && (
                              <small className="truncated-note">
                                本页仅显示该消息前 65,536 个字符。
                              </small>
                            )}
                          </article>
                        ))
                      )}
                    </div>
                    <div className="pager pager--messages" aria-label="消息分页">
                      <button
                        disabled={record.messageOffset === 0}
                        onClick={() =>
                          setMessageOffset(Math.max(0, record.messageOffset - messagePageSize))
                        }
                      >
                        <ChevronLeft aria-hidden="true" size={15} />
                        较早
                      </button>
                      <span>
                        {String(record.totalMessages === 0 ? 0 : record.messageOffset + 1)}–
                        {String(record.messageOffset + record.messages.length)} /{' '}
                        {String(record.totalMessages)}
                      </span>
                      <button
                        disabled={!record.hasMore}
                        onClick={() =>
                          setMessageOffset(record.messageOffset + record.messages.length)
                        }
                      >
                        较新
                        <ChevronRight aria-hidden="true" size={15} />
                      </button>
                    </div>
                  </>
                )
              }
            </StateFrame>
          )}
        </section>
      </div>
      {operation !== '' && (
        <p className="operation-message" role="status">
          {operation}
        </p>
      )}
    </>
  );
}

function MemorySearchList() {
  const [search, setSearch] = useState('');
  const state = useLoad(() => desktopApi.memories(search), [search]);
  return (
    <>
      <PageHeader
        eyebrow="CONFIRMED MEMORY"
        title="记忆管理"
        description="只有用户确认的事实和偏好才会成为长期记忆。"
        onRefresh={state.refresh}
      />
      <label className="search-box">
        <Search aria-hidden="true" size={17} />
        <span className="sr-only">搜索记忆</span>
        <input
          name="memorySearch"
          type="search"
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索记忆内容…"
        />
      </label>
      <StateFrame {...state}>
        {(items) =>
          items.length === 0 ? (
            <Empty title="没有确认记忆" detail="候选记忆需要确认后才会显示在这里。" />
          ) : (
            <div className="record-list">
              {items.map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.content}</strong>
                    <p>
                      {item.sourceType} · {item.kind}
                    </p>
                  </div>
                  <time>{formatLocalTime(item.updatedAt)}</time>
                </article>
              ))}
            </div>
          )
        }
      </StateFrame>
    </>
  );
}

const emptyGlobalMemory: GlobalMemoryInput = {
  type: 'profile',
  title: '',
  content: '',
  enabled: true,
  pinned: false,
  priority: 0,
  tags: [],
};

/**
 * Global memory editor.
 *
 * Real CRUD, not a placeholder. Content is stored only on this machine, and only
 * memories relevant to the current task are ever sent to a model.
 */
function GlobalMemorySection() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<GlobalMemoryType | ''>('');
  const [draft, setDraft] = useState<GlobalMemoryInput>(emptyGlobalMemory);
  const [editingId, setEditingId] = useState<string>();
  const [status, setStatus] = useState('');
  const memories = useLoad(
    () => desktopApi.globalMemories(search, typeFilter === '' ? undefined : typeFilter),
    [search, typeFilter],
  );
  const snapshot = useLoad(desktopApi.globalMemorySnapshot, []);

  const refreshAll = () => {
    memories.refresh();
    snapshot.refresh();
  };

  const save = async () => {
    if (draft.content.trim() === '') {
      setStatus('记忆内容不能为空。');
      return;
    }
    try {
      if (editingId === undefined) await desktopApi.createGlobalMemory(draft);
      else await desktopApi.updateGlobalMemory(editingId, draft);
      setStatus(editingId === undefined ? '记忆已新建。' : '记忆已更新。');
      setDraft(emptyGlobalMemory);
      setEditingId(undefined);
      refreshAll();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const edit = (memory: GlobalMemoryRecord) => {
    setEditingId(memory.id);
    setDraft({
      type: memory.type,
      title: memory.title,
      content: memory.content,
      enabled: memory.enabled,
      pinned: memory.pinned,
      priority: memory.priority,
      tags: [],
    });
    setStatus('');
  };

  const exportMemories = async () => {
    try {
      const json = await desktopApi.exportGlobalMemories();
      await navigator.clipboard.writeText(json);
      setStatus('全部记忆已复制为 JSON，可粘贴保存。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="GLOBAL MEMORY"
        title="全局记忆"
        description="记录你是谁、偏好什么、希望模型如何回答。仅保存在本机，按相关性注入，不会整体发送。"
        onRefresh={refreshAll}
      />

      <StateFrame {...snapshot}>
        {(current) => (
          <div className="memory-snapshot">
            <div>
              <span>稳定前缀版本</span>
              <strong>v{current.version}</strong>
            </div>
            <div>
              <span>指纹</span>
              <strong translate="no">{current.fingerprint}</strong>
            </div>
            <div>
              <span>固定记忆条数</span>
              <strong>{current.memoryCount}</strong>
            </div>
            <p>
              固定（pinned）记忆构成稳定 Prompt 前缀，只在你修改相关记忆时才变化，因此可被 Provider
              前缀缓存命中。使用次数等统计不会影响该前缀。
            </p>
          </div>
        )}
      </StateFrame>

      <form
        className="memory-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h3>{editingId === undefined ? '新建记忆' : '编辑记忆'}</h3>
        <div className="memory-editor__row">
          <label>
            <span>类型</span>
            <select
              name="memoryType"
              value={draft.type}
              onChange={(event) =>
                setDraft({ ...draft, type: event.target.value as GlobalMemoryType })
              }
            >
              {globalMemoryTypes.map((type) => (
                <option key={type} value={type}>
                  {globalMemoryTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>标题（可选）</span>
            <input
              name="memoryTitle"
              autoComplete="off"
              maxLength={200}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="例如：研究方向"
            />
          </label>
          <label>
            <span>优先级</span>
            <input
              name="memoryPriority"
              type="number"
              min={-100}
              max={100}
              value={draft.priority}
              onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) })}
            />
          </label>
        </div>
        <label>
          <span>内容</span>
          <textarea
            name="memoryContent"
            maxLength={4000}
            rows={3}
            value={draft.content}
            onChange={(event) => setDraft({ ...draft, content: event.target.value })}
            placeholder="例如：我是飞行器设计与工程专业本科生，熟悉 Python、ROS 2 与 PX4。"
          />
        </label>
        <div className="memory-editor__row">
          <label className="memory-editor__check">
            <input
              name="memoryEnabled"
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />
            <span>启用</span>
          </label>
          <label className="memory-editor__check">
            <input
              name="memoryPinned"
              type="checkbox"
              checked={draft.pinned}
              onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })}
            />
            <span>固定（进入稳定前缀，始终参与）</span>
          </label>
          <div className="row-actions">
            <button type="submit">{editingId === undefined ? '新建' : '保存修改'}</button>
            {editingId !== undefined && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(undefined);
                  setDraft(emptyGlobalMemory);
                }}
              >
                取消编辑
              </button>
            )}
            <button type="button" onClick={() => void exportMemories()}>
              导出全部
            </button>
          </div>
        </div>
        {status !== '' && (
          <p className="memory-editor__status" role="status">
            {status}
          </p>
        )}
      </form>

      <div className="memory-filters">
        <label className="search-box">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">搜索全局记忆</span>
          <input
            name="globalMemorySearch"
            type="search"
            autoComplete="off"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索记忆内容…"
          />
        </label>
        <label>
          <span className="sr-only">按类型筛选</span>
          <select
            name="globalMemoryTypeFilter"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as GlobalMemoryType | '')}
          >
            <option value="">全部类型</option>
            {globalMemoryTypes.map((type) => (
              <option key={type} value={type}>
                {globalMemoryTypeLabels[type]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <StateFrame {...memories}>
        {(items) =>
          items.length === 0 ? (
            <Empty
              title="还没有全局记忆"
              detail="新建一条，或从 TXT / MD / JSON 文件导入后确认写入。"
            />
          ) : (
            <div className="record-list">
              {items.map((item) => (
                <article key={item.id} data-disabled={!item.enabled}>
                  <div>
                    <strong>
                      {item.pinned && <span className="memory-badge">固定</span>}
                      {!item.enabled && <span className="memory-badge is-muted">已禁用</span>}
                      {item.title === '' ? item.content : `${item.title}：${item.content}`}
                    </strong>
                    <p>
                      {globalMemoryTypeLabels[item.type]} · 来源 {item.sourceType} · 优先级{' '}
                      {item.priority} · 已使用 {item.usageCount} 次 ·{' '}
                      {item.lastUsedAt === undefined
                        ? '尚未使用'
                        : `最近使用 ${formatLocalTime(item.lastUsedAt)}`}
                    </p>
                  </div>
                  <div className="row-actions">
                    <button onClick={() => edit(item)}>编辑</button>
                    <button
                      onClick={() =>
                        void desktopApi
                          .setGlobalMemoryPinned(item.id, !item.pinned)
                          .then(refreshAll)
                      }
                    >
                      {item.pinned ? '取消固定' : '固定'}
                    </button>
                    <button
                      onClick={() =>
                        void desktopApi
                          .setGlobalMemoryEnabled(item.id, !item.enabled)
                          .then(refreshAll)
                      }
                    >
                      {item.enabled ? '禁用' : '启用'}
                    </button>
                    <button
                      onClick={() => void desktopApi.deleteGlobalMemory(item.id).then(refreshAll)}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )
        }
      </StateFrame>

      <GlobalMemoryImportSection onApplied={refreshAll} />
    </>
  );
}

/**
 * Import flow: choose file → parse → review candidates → confirm.
 *
 * A file never becomes memory on its own; only candidates the user ticks are
 * written.
 */
function GlobalMemoryImportSection({ onApplied }: { onApplied: () => void }) {
  const [path, setPath] = useState('');
  const [defaultType, setDefaultType] = useState<GlobalMemoryType>('custom');
  const [preview, setPreview] = useState<GlobalMemoryImportPreview>();
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('');

  const loadPreview = async () => {
    setStatus('');
    try {
      const result = await desktopApi.previewGlobalMemoryImport(path.trim(), defaultType);
      setPreview(result);
      // Duplicates start unticked: they already exist and cannot be written twice.
      setAccepted(
        new Set(
          result.candidates
            .filter((candidate) => candidate.state === 'pending')
            .map((candidate) => candidate.id),
        ),
      );
    } catch (error) {
      setPreview(undefined);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const apply = async () => {
    if (preview === undefined) return;
    try {
      const created = await desktopApi.applyGlobalMemoryImport(preview.jobId, [...accepted]);
      setStatus(`已确认写入 ${String(created)} 条记忆。`);
      setPreview(undefined);
      setAccepted(new Set());
      setPath('');
      onApplied();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const discard = async () => {
    if (preview === undefined) return;
    await desktopApi.discardGlobalMemoryImport(preview.jobId).catch(() => undefined);
    setPreview(undefined);
    setAccepted(new Set());
    setStatus('已放弃本次导入，未写入任何记忆。');
  };

  return (
    <>
      <h2 className="section-title">导入记忆</h2>
      <div className="memory-import">
        <p>
          支持 <code>.txt</code>、<code>.md</code> 和 <code>.json</code>。导入只生成候选，
          必须逐条确认后才会保存。
        </p>
        <div className="memory-import__row">
          <label>
            <span>文件路径</span>
            <input
              name="memoryImportPath"
              autoComplete="off"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="C:\\Users\\you\\Documents\\profile.md"
            />
          </label>
          <label>
            <span>默认类型</span>
            <select
              name="memoryImportType"
              value={defaultType}
              onChange={(event) => setDefaultType(event.target.value as GlobalMemoryType)}
            >
              {globalMemoryTypes.map((type) => (
                <option key={type} value={type}>
                  {globalMemoryTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          <button disabled={path.trim() === ''} onClick={() => void loadPreview()} type="button">
            解析文件
          </button>
        </div>
        {status !== '' && <p role="status">{status}</p>}

        {preview !== undefined && (
          <div className="memory-import__review">
            <h3>
              候选记忆 · {preview.sourceName}（{preview.sourceFormat.toUpperCase()}）
            </h3>
            <div className="record-list">
              {preview.candidates.map((candidate) => (
                <article key={candidate.id}>
                  <label className="memory-import__check">
                    <input
                      name={`candidate-${candidate.id}`}
                      type="checkbox"
                      disabled={candidate.state === 'duplicate'}
                      checked={accepted.has(candidate.id)}
                      onChange={(event) => {
                        const next = new Set(accepted);
                        if (event.target.checked) next.add(candidate.id);
                        else next.delete(candidate.id);
                        setAccepted(next);
                      }}
                    />
                    <div>
                      <strong>{candidate.content}</strong>
                      <p>
                        {globalMemoryTypeLabels[candidate.type]}
                        {candidate.state === 'duplicate' && ' · 已存在，不会重复写入'}
                        {candidate.glossaryHint && ' · 这更像术语规则，建议改为保存到术语库'}
                      </p>
                    </div>
                  </label>
                </article>
              ))}
            </div>
            <div className="row-actions">
              <button disabled={accepted.size === 0} onClick={() => void apply()} type="button">
                确认写入 {accepted.size} 条
              </button>
              <button onClick={() => void discard()} type="button">
                放弃导入
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function MemoryPage() {
  const candidates = useLoad(desktopApi.memoryCandidates, []);
  return (
    <>
      <GlobalMemorySection />
      <h2 className="section-title">会话派生记忆</h2>
      <MemorySearchList />
      <h2 className="section-title">待确认长期记忆</h2>
      <StateFrame {...candidates}>
        {(items: MemoryCandidateRecord[]) =>
          items.length === 0 ? (
            <Empty
              title="没有待确认记忆"
              detail="自动摘要不会直接写入长期记忆；候选事实会在这里等待确认。"
            />
          ) : (
            <div className="record-list">
              {items.map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.content}</strong>
                    <p>
                      {item.sourceType} · 置信度{' '}
                      {item.confidence === undefined
                        ? '—'
                        : `${String(Math.round(item.confidence * 100))}%`}
                    </p>
                  </div>
                  <div className="row-actions">
                    <button
                      onClick={() =>
                        void desktopApi
                          .setMemoryCandidateState(item.id, 'confirmed')
                          .then(candidates.refresh)
                      }
                    >
                      确认写入
                    </button>
                    <button
                      onClick={() =>
                        void desktopApi
                          .setMemoryCandidateState(item.id, 'rejected')
                          .then(candidates.refresh)
                      }
                    >
                      拒绝
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )
        }
      </StateFrame>
    </>
  );
}

function reasoningEfforts(model: ModelCatalogRecord | undefined): ('high' | 'max')[] {
  if (model === undefined) return [];
  try {
    const values: unknown = JSON.parse(model.reasoningEffortsJson);
    return Array.isArray(values)
      ? values.filter((value): value is 'high' | 'max' => value === 'high' || value === 'max')
      : [];
  } catch {
    return [];
  }
}

function TaskModelEditor({
  preset,
  models,
  selection,
  onSaved,
}: {
  preset: TaskPresetRecord;
  models: ModelCatalogRecord[];
  selection: ModelSelectionRecord | null;
  onSaved: () => void;
}) {
  const [modelId, setModelId] = useState(selection?.modelId ?? preset.modelId);
  const [thinking, setThinking] = useState(selection?.thinkingEnabled ?? preset.thinkingEnabled);
  const [effort, setEffort] = useState<'high' | 'max' | ''>(
    selection?.reasoningEffort ?? (preset.reasoningEffort as 'high' | 'max' | undefined) ?? '',
  );
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState(false);
  const [pending, setPending] = useState(false);
  const model = models.find((item) => item.modelId === modelId);
  const efforts = reasoningEfforts(model);
  const unavailable = model === undefined || model.availability === 'unavailable';

  useEffect(() => {
    setModelId(selection?.modelId ?? preset.modelId);
    setThinking(selection?.thinkingEnabled ?? preset.thinkingEnabled);
    setEffort(
      selection?.reasoningEffort ?? (preset.reasoningEffort as 'high' | 'max' | undefined) ?? '',
    );
  }, [preset, selection]);

  async function save() {
    setPending(true);
    setSaveError(false);
    setMessage('正在保存…');
    try {
      await desktopApi.saveModelSelection('deepseek', {
        scope: 'task',
        scopeId: preset.task,
        task: preset.task,
        modelId,
        thinkingEnabled: thinking,
        ...(thinking && effort !== '' ? { reasoningEffort: effort } : {}),
      });
      setMessage('已持久化');
      onSaved();
    } catch (reason) {
      setSaveError(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="task-model-row">
      <div className="task-model-name">
        <span>{preset.label}</span>
        <small translate="no">{preset.task}</small>
      </div>
      <label>
        <span className="sr-only">{preset.label}模型</span>
        <select
          name={`model-${preset.id}`}
          translate="no"
          value={modelId}
          onChange={(event) => {
            const nextModel = models.find((item) => item.modelId === event.target.value);
            setModelId(event.target.value);
            if (nextModel?.supportsThinking !== true) {
              setThinking(false);
              setEffort('');
            }
          }}
        >
          {model === undefined && modelId !== '' && (
            <option value={modelId} disabled>
              {modelId}（目录中不存在）
            </option>
          )}
          {models.map((item) => (
            <option
              key={item.modelId}
              value={item.modelId}
              disabled={item.availability === 'unavailable'}
            >
              {item.providerId} / {item.modelId}
              {item.availability === 'unavailable' ? '（不可用）' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-control">
        <input
          type="checkbox"
          name={`thinking-${preset.id}`}
          checked={thinking}
          disabled={model?.supportsThinking !== true}
          onChange={(event) => {
            setThinking(event.target.checked);
            if (!event.target.checked) setEffort('');
          }}
        />
        思考模式
      </label>
      <label>
        <span className="sr-only">{preset.label}推理强度</span>
        <select
          name={`effort-${preset.id}`}
          value={effort}
          disabled={!thinking || efforts.length === 0}
          onChange={(event) => setEffort(event.target.value as 'high' | 'max' | '')}
        >
          <option value="">不指定</option>
          {efforts.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <div className="model-save-cell" role="status" aria-live="polite">
        <button type="button" disabled={pending || unavailable} onClick={() => void save()}>
          <Save aria-hidden="true" size={14} />
          {pending ? '保存中…' : '保存'}
        </button>
        <small className={saveError ? 'error-text' : ''}>{message}</small>
      </div>
    </article>
  );
}

function SettingsPage() {
  const api = useLoad(desktopApi.apiStatus, []);
  const controls = useLoad(async () => {
    const [presets, models] = await Promise.all([
      desktopApi.taskPresets(),
      desktopApi.modelCatalog('deepseek'),
    ]);
    const selections = await Promise.all(
      presets.map((preset) => desktopApi.modelSelection(preset.task)),
    );
    return { presets, models, selections };
  }, []);
  const [testResult, setTestResult] = useState('');
  const [refreshingModels, setRefreshingModels] = useState(false);

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const proxy = formText(form, 'proxyUrl');
    setTestResult('正在加密并保存配置…');
    try {
      await desktopApi.saveApi({
        baseUrl: formText(form, 'baseUrl'),
        apiKey: formText(form, 'apiKey'),
        proxyUrl: proxy === '' ? undefined : proxy,
        firstTokenTimeoutMs: Number(formText(form, 'firstTokenTimeoutMs')),
        totalTimeoutMs: Number(formText(form, 'totalTimeoutMs')),
        maxConcurrency: Number(formText(form, 'maxConcurrency')),
        maxRetries: Number(formText(form, 'maxRetries')),
      });
      target.reset();
      setTestResult('API 配置已使用 DPAPI 保存。');
      api.refresh();
    } catch (reason) {
      setTestResult(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function testConnection() {
    setTestResult('正在校验模型并发送极小流式请求…');
    try {
      const result = await desktopApi.testApi();
      setTestResult(
        `连接通过 · ${result.model} · ${String(result.elapsedMs)} ms · ${String(result.totalTokens ?? 0)} tokens`,
      );
    } catch (reason) {
      setTestResult(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function refreshCatalog() {
    setRefreshingModels(true);
    setTestResult('正在通过 /models 刷新可用性；不会发送计费对话请求…');
    try {
      const models = await desktopApi.refreshModelCatalog('deepseek');
      setTestResult(`模型目录已刷新，共 ${String(models.length)} 个模型。`);
      controls.refresh();
    } catch (reason) {
      setTestResult(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRefreshingModels(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="PROVIDER CONTROL"
        title="模型与 API"
        description="模型可用性来自 /models；能力来自已审核适配器，两者不会互相冒充。"
        onRefresh={() => {
          api.refresh();
          controls.refresh();
        }}
      />
      <StateFrame {...api}>
        {(status: ApiConfigStatus) => (
          <>
            <div className={`api-status ${status.configured ? 'api-status--ready' : ''}`}>
              <KeyRound aria-hidden="true" size={20} />
              <div>
                <strong>{status.configured ? 'API Key 已配置' : '尚未配置 API Key'}</strong>
                <span>
                  {status.baseUrl} · {status.maskedKey ?? '未保存密钥'}
                </span>
              </div>
              {status.configured && (
                <button
                  className="danger-quiet"
                  onClick={() => void desktopApi.clearApi().then(api.refresh)}
                >
                  清除
                </button>
              )}
            </div>
            <form className="settings-form" onSubmit={(event) => void submit(event)}>
              <label>
                Base URL
                <input name="baseUrl" type="url" required defaultValue={status.baseUrl} />
              </label>
              <label>
                API Key
                <input
                  name="apiKey"
                  type="password"
                  required
                  autoComplete="off"
                  placeholder="仅本次提交可见"
                />
              </label>
              <label>
                代理地址
                <input name="proxyUrl" type="url" defaultValue={status.proxyUrl} />
              </label>
              <label>
                首 Token 超时（ms）
                <input
                  name="firstTokenTimeoutMs"
                  type="number"
                  min="1000"
                  max="600000"
                  defaultValue={status.firstTokenTimeoutMs}
                />
              </label>
              <label>
                总请求超时（ms）
                <input
                  name="totalTimeoutMs"
                  type="number"
                  min="1000"
                  max="600000"
                  defaultValue={status.totalTimeoutMs}
                />
              </label>
              <label>
                最大并发
                <input
                  name="maxConcurrency"
                  type="number"
                  min="1"
                  max="8"
                  defaultValue={status.maxConcurrency}
                />
              </label>
              <label>
                最大重试
                <input
                  name="maxRetries"
                  type="number"
                  min="0"
                  max="8"
                  defaultValue={status.maxRetries}
                />
              </label>
              <button className="primary-button">安全保存</button>
            </form>
            <div className="provider-actions">
              <button disabled={!status.configured} onClick={() => void testConnection()}>
                测试真实连接（极小请求）
              </button>
              <button
                disabled={!status.configured || refreshingModels}
                onClick={() => void refreshCatalog()}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={refreshingModels ? 'spin' : ''}
                  size={15}
                />
                {refreshingModels ? '刷新中…' : '刷新模型目录'}
              </button>
              {!status.configured && <span>保存 API Key 后才能请求 /models。</span>}
            </div>
            {testResult !== '' && (
              <p className="operation-message" role="status">
                {testResult}
              </p>
            )}
          </>
        )}
      </StateFrame>

      <h2 className="section-title">Provider 与模型能力</h2>
      <StateFrame {...controls}>
        {({ models }) =>
          models.length === 0 ? (
            <Empty title="模型目录为空" detail="配置 API 后刷新 /models；研译不会猜测可用模型。" />
          ) : (
            <div className="model-catalog-scroll">
              <table className="model-catalog">
                <caption className="sr-only">模型能力目录</caption>
                <thead>
                  <tr>
                    <th scope="col">Provider / 模型</th>
                    <th scope="col">可用性</th>
                    <th scope="col">能力来源</th>
                    <th scope="col">能力</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => (
                    <tr key={`${model.providerId}:${model.modelId}`}>
                      <td>
                        <small>
                          {model.providerId} · {model.owner}
                        </small>
                        <code translate="no">{model.modelId}</code>
                      </td>
                      <td>
                        <span className={`availability availability--${model.availability}`}>
                          {model.availability === 'available' ? (
                            <CheckCircle2 aria-hidden="true" size={14} />
                          ) : (
                            <CircleAlert aria-hidden="true" size={14} />
                          )}
                          {model.availability === 'available'
                            ? '可用'
                            : model.availability === 'unavailable'
                              ? '不可用'
                              : '待刷新'}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`capability-source ${
                            model.capabilityStatus === 'verified'
                              ? 'capability-source--verified'
                              : ''
                          }`}
                        >
                          {model.capabilityStatus === 'verified' ? (
                            <BadgeCheck aria-hidden="true" size={14} />
                          ) : (
                            <CircleAlert aria-hidden="true" size={14} />
                          )}
                          {model.capabilityStatus === 'verified'
                            ? '已审核'
                            : model.capabilityStatus === 'manual'
                              ? '人工配置'
                              : '未验证'}
                        </span>
                      </td>
                      <td>
                        <div className="capability-list">
                          <span>
                            <BrainCircuit aria-hidden="true" size={13} />
                            {model.supportsThinking === true
                              ? `思考 · ${reasoningEfforts(model).join('/') || '强度未指定'}`
                              : model.supportsThinking === false
                                ? '不支持思考'
                                : '思考未验证'}
                          </span>
                          <span>
                            <MessageSquareText aria-hidden="true" size={13} />
                            {model.supportsStreaming === true ? '流式' : '流式未知'}
                          </span>
                          <span>
                            <Cpu aria-hidden="true" size={13} />
                            {model.supportsTools === true ? '工具' : '工具未知'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </StateFrame>

      <h2 className="section-title">任务模型映射</h2>
      <p className="section-description">单次请求仍可覆盖这里的选择；不可用模型不会自动回退。</p>
      <StateFrame {...controls}>
        {({ presets, models, selections }) => (
          <div className="task-model-table">
            <div className="task-model-head">
              <span>任务</span>
              <span>模型</span>
              <span>思考</span>
              <span>强度</span>
              <span>操作</span>
            </div>
            {presets.map((preset, index) => (
              <TaskModelEditor
                key={preset.id}
                preset={preset}
                models={models}
                selection={selections[index] ?? null}
                onSaved={controls.refresh}
              />
            ))}
          </div>
        )}
      </StateFrame>
    </>
  );
}

function DiagnosticsPage() {
  const state = useLoad(desktopApi.environment, []);
  const registration = useLoad(desktopApi.nativeRegistration, []);
  const startup = useLoad(desktopApi.startupStatus, []);
  const [message, setMessage] = useState('');
  async function action(operation: () => Promise<unknown>) {
    setMessage('正在处理…');
    try {
      const result = await operation();
      setMessage(typeof result === 'string' ? result : '操作已完成。');
      state.refresh();
      registration.refresh();
      startup.refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="LOCAL DIAGNOSTICS"
        title="数据与诊断"
        description="核对数据库、协议、注册、备份和本地隐私边界。"
        onRefresh={() => {
          state.refresh();
          registration.refresh();
          startup.refresh();
        }}
      />
      <StateFrame {...state}>
        {(status: EnvironmentStatus) => (
          <div className="diagnostic-grid">
            <article>
              <Database aria-hidden="true" />
              <span>SQLite Schema</span>
              <strong>v{status.databaseSchemaVersion}</strong>
              <small title={status.databasePath}>{status.databasePath}</small>
            </article>
            <article>
              <Wifi aria-hidden="true" />
              <span>Native Messaging</span>
              <strong>{status.nativeHostName}</strong>
              <small>Protocol v{status.protocolVersion}</small>
            </article>
          </div>
        )}
      </StateFrame>
      <StateFrame {...registration}>
        {(value) => (
          <section className="api-status">
            <Wifi aria-hidden="true" size={20} />
            <div>
              <strong>浏览器注册</strong>
              <span>
                Edge {value.edge ? '已注册' : '未注册'} · Chrome{' '}
                {value.chrome ? '已注册' : '未注册'}
              </span>
            </div>
            <button onClick={() => void action(desktopApi.repairNativeRegistration)}>
              修复注册
            </button>
          </section>
        )}
      </StateFrame>
      <section className="system-actions" aria-label="数据与系统操作">
        <button onClick={() => void action(() => desktopApi.openDirectory('data'))}>
          <FolderOpen aria-hidden="true" size={17} />
          打开数据目录
        </button>
        <button onClick={() => void action(() => desktopApi.openDirectory('logs'))}>
          <FolderOpen aria-hidden="true" size={17} />
          打开日志目录
        </button>
        <button onClick={() => void action(desktopApi.exportData)}>备份数据库</button>
        <button onClick={() => void action(desktopApi.exportDiagnostics)}>导出脱敏诊断</button>
        <button
          onClick={() => {
            if (confirm('清理全部翻译缓存？术语、历史和工作区不会删除。'))
              void action(desktopApi.clearCache);
          }}
        >
          清理翻译缓存
        </button>
        <button onClick={() => void action(() => desktopApi.setStartup(!(startup.data ?? false)))}>
          {startup.data ? '关闭' : '开启'}开机启动
        </button>
      </section>
      <form
        className="quick-form"
        onSubmit={(event) => {
          event.preventDefault();
          const path = formText(new FormData(event.currentTarget), 'path');
          void action(() => desktopApi.scheduleImport(path));
        }}
      >
        <label className="grow">
          导入 SQLite 备份路径
          <input name="path" required placeholder="C:\\Users\\…\\yanyi-backup.db" />
        </label>
        <button>验证并安排重启导入</button>
      </form>
      {message !== '' && (
        <p className="operation-message" role="status">
          {message}
        </p>
      )}
      <div className="notice-card">
        <ShieldCheck aria-hidden="true" size={22} />
        <div>
          <strong>诊断包默认脱敏</strong>
          <p>
            不包含 API Key、页面正文、译文或 URL
            查询参数。导入前会验证、迁移，并在替换当前数据库前自动备份。
          </p>
        </div>
      </div>
    </>
  );
}

function CurrentPage({ page }: { page: Page }) {
  switch (page) {
    case 'home':
      return <HomePage />;
    case 'workspaces':
      return <WorkspacesPage />;
    case 'glossary':
      return <GlossaryPage />;
    case 'candidates':
      return <CandidatesPage />;
    case 'rules':
      return <RulesPage />;
    case 'history':
      return <HistoryPage />;
    case 'memory':
      return <MemoryPage />;
    case 'settings':
      return <SettingsPage />;
    case 'diagnostics':
      return <DiagnosticsPage />;
  }
}

export function App() {
  const [page, setPage] = useState<Page>('home');
  return (
    <main className="desktop-shell">
      <a className="skip-link" href="#desktop-content">
        跳到主要内容
      </a>
      <aside>
        <div className="desktop-brand">
          <span aria-hidden="true">研</span>
          <div>
            <strong>研译 · 本地版</strong>
            <small>技术阅读控制台</small>
          </div>
        </div>
        <nav aria-label="主导航">
          {navigation.map(([id, Icon, label]) => (
            <button
              key={id}
              className={page === id ? 'active' : ''}
              aria-current={page === id ? 'page' : undefined}
              onClick={() => setPage(id)}
            >
              <Icon aria-hidden="true" size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="desktop-service-status">
          <CheckCircle2 aria-hidden="true" size={18} />
          <span>
            <strong>本地数据层</strong>
            <small>SQLite · WAL · DPAPI</small>
          </span>
        </div>
      </aside>
      <section id="desktop-content" className="desktop-content" tabIndex={-1}>
        <CurrentPage page={page} />
        <footer>
          <span>研译 v0.1.0</span>
          <span>本地优先 · 用户确认事实优先</span>
        </footer>
      </section>
    </main>
  );
}
