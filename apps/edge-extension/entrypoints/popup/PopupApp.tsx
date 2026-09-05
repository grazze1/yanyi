import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Bot,
  Braces,
  BriefcaseBusiness,
  ChevronDown,
  CircleHelp,
  Columns2,
  Ellipsis,
  ExternalLink,
  Languages,
  LoaderCircle,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Square,
  Stethoscope,
  Tag,
  X,
} from 'lucide-react';
import { Button, StatusDot } from '@yanyi/ui';
import {
  defaultModelProfiles,
  languageLabel,
  sourceLanguageOptions,
  targetLanguageOptions,
  technicalTagSuggestions,
  topLevelDomains,
  type SourceLanguageId,
  type TargetLanguageId,
  type TranslationMode,
  type TranslationPreferencePatch,
} from '@yanyi/shared-types';
import type { PopupAdapter } from './popupAdapter';
import { usePopupStore } from './popupStore';

const modeOptions: readonly {
  id: TranslationMode;
  label: string;
  icon: typeof Languages;
}[] = [
  { id: 'replace', label: '替换原文', icon: Languages },
  { id: 'below', label: '原文下方', icon: BookOpen },
  { id: 'bilingual', label: '双语对照', icon: Columns2 },
];

const domainIcons = [Bot, Sparkles, Braces, Tag, BriefcaseBusiness] as const;

/**
 * Glossary, workspaces, history and settings belong to the desktop management app.
 * The popup keeps only the immediate reading flow and reaches those surfaces
 * through the overflow menu instead of bottom-row primary buttons.
 */
const overflowLinks = [
  { icon: ExternalLink, label: '打开研译管理端', section: 'settings' },
  { icon: Stethoscope, label: '诊断', section: 'diagnostics' },
] as const;

function connectionPresentation(connection: string) {
  switch (connection) {
    case 'connected':
      return { tone: 'success' as const, text: '本地服务已连接' };
    case 'connecting':
      return { tone: 'info' as const, text: '正在连接本地服务…' };
    case 'offline':
      return { tone: 'danger' as const, text: '本地服务离线' };
    default:
      return { tone: 'muted' as const, text: '本地服务未连接' };
  }
}

export function PopupApp({ adapter }: { adapter: PopupAdapter }) {
  const { snapshot, busy, setSnapshot, setBusy, updatePreferences } = usePopupStore();
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showAllDomains, setShowAllDomains] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [showOverflow, setShowOverflow] = useState(false);
  const [sidePanelError, setSidePanelError] = useState<string>();
  const preferenceMutationCount = useRef(0);
  const preferenceRevision = useRef(0);
  const preferenceQueue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading || preferenceMutationCount.current > 0) return;
      loading = true;
      const revision = preferenceRevision.current;
      try {
        const next = await adapter.load();
        if (active && revision === preferenceRevision.current) setSnapshot(next);
      } finally {
        loading = false;
      }
    };
    void refresh();
    const refreshTimer = setInterval(() => void refresh(), 750);
    return () => {
      active = false;
      clearInterval(refreshTimer);
    };
  }, [adapter, setSnapshot]);

  const connection = useMemo(
    () => connectionPresentation(snapshot?.connection ?? 'connecting'),
    [snapshot?.connection],
  );

  if (busy || snapshot === undefined) {
    return (
      <main className="popup-shell popup-loading" aria-live="polite">
        <LoaderCircle aria-hidden="true" className="spin" size={24} />
        <p>正在读取当前页面…</p>
      </main>
    );
  }

  const current = snapshot;

  const disabled = snapshot.connection !== 'connected' || snapshot.page === 'untranslatable';
  const translating = snapshot.page === 'translating';
  const paused = snapshot.page === 'paused';
  const primaryLabel = snapshot.page === 'translated' ? '更新翻译' : '翻译此页面';

  async function start() {
    setBusy(true);
    const accepted = await adapter.startTranslation();
    if (accepted) {
      setSnapshot({ ...current, page: 'translating' });
    } else {
      setSnapshot({
        ...current,
        page: 'error',
        message: '本地服务未就绪，未修改当前页面。',
      });
    }
  }

  async function pause() {
    if (await adapter.pauseTranslation()) setSnapshot({ ...current, page: 'paused' });
  }

  async function resume() {
    if (await adapter.resumeTranslation()) setSnapshot({ ...current, page: 'translating' });
  }

  async function cancel() {
    await adapter.cancelTranslation();
    setSnapshot({ ...current, page: 'ready', completedSegments: 0 });
  }

  async function restore() {
    if (await adapter.restoreTranslation()) {
      const next = { ...current, page: 'ready' as const, completedSegments: 0, totalSegments: 0 };
      delete next.message;
      setSnapshot(next);
    }
  }

  async function changeMode(mode: TranslationMode) {
    await savePreferences({ mode });
  }

  /**
   * Runs inside the click handler so the user gesture reaches sidePanel.open().
   * A refused open reports why instead of leaving the button looking inert.
   */
  async function openSidePanel() {
    setSidePanelError(undefined);
    const outcome = await adapter.openSidePanel();
    if (!outcome.opened) setSidePanelError(outcome.message);
  }

  async function savePreferences(patch: TranslationPreferencePatch) {
    const revision = ++preferenceRevision.current;
    preferenceMutationCount.current += 1;
    updatePreferences(patch);
    const operation = preferenceQueue.current.then(() => adapter.updatePreferences(patch));
    preferenceQueue.current = operation.then(
      () => undefined,
      () => undefined,
    );
    try {
      const saved = await operation;
      if (revision !== preferenceRevision.current) return;
      if (saved !== undefined) {
        setSnapshot(saved);
      } else {
        const latest = await adapter.load();
        setSnapshot({ ...latest, message: '设置未保存，请确认本地服务和扩展后台仍在运行。' });
      }
    } catch {
      if (revision === preferenceRevision.current) {
        const latest = await adapter.load();
        setSnapshot({ ...latest, message: '设置未保存，请确认本地服务和扩展后台仍在运行。' });
      }
    } finally {
      preferenceMutationCount.current -= 1;
    }
  }

  async function addTechnicalTag(tag: string) {
    const normalized = tag.trim();
    if (normalized === '' || current.tags.includes(normalized)) return;
    await savePreferences({ tags: [...current.tags, normalized] });
    setTagQuery('');
  }

  const suggestedTags = [
    ...new Set(
      (current.primaryDomain === null
        ? Object.values(technicalTagSuggestions).flat()
        : technicalTagSuggestions[current.primaryDomain]
      ).filter((tag) => tag.toLocaleLowerCase().includes(tagQuery.trim().toLocaleLowerCase())),
    ),
  ].slice(0, 8);

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            研
          </span>
          <div>
            <h1>研译</h1>
            <p>技术文档智能翻译</p>
          </div>
        </div>
        <div className="header-actions">
          <button
            aria-controls="popup-overflow-menu"
            aria-expanded={showOverflow}
            className="icon-button"
            aria-label="更多选项"
            onClick={() => setShowOverflow((value) => !value)}
          >
            <Ellipsis aria-hidden="true" size={20} />
          </button>
        </div>
      </header>

      {showOverflow && (
        <nav className="popup-overflow" id="popup-overflow-menu" aria-label="管理入口">
          {overflowLinks.map(({ icon: Icon, label, section }) => (
            <button
              key={section}
              onClick={() => {
                setShowOverflow(false);
                void adapter.openOptions(section);
              }}
              type="button"
            >
              <Icon aria-hidden="true" size={15} />
              {label}
            </button>
          ))}
          <p>术语库、工作区、历史与完整设置在研译桌面端管理。</p>
        </nav>
      )}

      <section
        className={`connection-card connection-card--${snapshot.connection}`}
        aria-live="polite"
      >
        <div>
          <StatusDot tone={connection.tone} />
          <strong>{connection.text}</strong>
        </div>
        <button
          aria-controls="translation-language-picker"
          className="language-button"
          aria-expanded={showLanguagePicker}
          aria-label="选择翻译语言"
          onClick={() => setShowLanguagePicker((value) => !value)}
        >
          <Languages aria-hidden="true" size={16} />
          <span translate="no">
            {languageLabel(snapshot.sourceLanguage)} → {languageLabel(snapshot.targetLanguage)}
          </span>
          <ChevronDown aria-hidden="true" size={14} />
        </button>
      </section>

      {showLanguagePicker && (
        <section
          className="language-picker"
          id="translation-language-picker"
          aria-label="翻译语言设置"
        >
          <label>
            <span>源语言</span>
            <select
              aria-label="源语言"
              autoComplete="off"
              name="source-language"
              onChange={(event) =>
                void savePreferences({ sourceLanguage: event.target.value as SourceLanguageId })
              }
              value={snapshot.sourceLanguage}
            >
              {sourceLanguageOptions.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <span className="language-flow" aria-hidden="true">
            →
          </span>
          <label>
            <span>目标语言</span>
            <select
              aria-label="目标语言"
              autoComplete="off"
              name="target-language"
              onChange={(event) =>
                void savePreferences({ targetLanguage: event.target.value as TargetLanguageId })
              }
              value={snapshot.targetLanguage}
            >
              {targetLanguageOptions.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {snapshot.message !== undefined && (
        <section className={`inline-message inline-message--${snapshot.page}`} role="status">
          <ShieldAlert aria-hidden="true" size={18} />
          <span>{snapshot.message}</span>
          {snapshot.connection !== 'connected' && (
            <button onClick={() => void adapter.openOptions('diagnostics')}>查看诊断</button>
          )}
        </section>
      )}

      <div className="popup-scroll-region">
        <section className="settings-section" aria-labelledby="mode-heading">
          <div className="section-heading">
            <h2 id="mode-heading">翻译模式</h2>
          </div>
          <div className="segmented-control" role="radiogroup" aria-label="翻译显示模式">
            {modeOptions.map(({ id, label, icon: Icon }) => (
              <button
                aria-checked={snapshot.mode === id}
                className={snapshot.mode === id ? 'is-selected' : ''}
                key={id}
                onClick={() => void changeMode(id)}
                role="radio"
              >
                <Icon aria-hidden="true" size={17} />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section domain-section" aria-labelledby="domain-heading">
          <div className="section-heading">
            <h2 id="domain-heading">领域选择</h2>
            <button
              aria-controls="translation-domain-grid"
              aria-expanded={showAllDomains}
              className="icon-button small"
              aria-label={showAllDomains ? '收起领域' : '展开全部领域'}
              onClick={() => setShowAllDomains((value) => !value)}
            >
              <ChevronDown aria-hidden="true" size={16} />
            </button>
          </div>
          <div className="domain-grid" id="translation-domain-grid">
            {topLevelDomains
              .slice(0, showAllDomains ? topLevelDomains.length : 5)
              .map((domain, index) => {
                const Icon = domainIcons[index] ?? Bot;
                return (
                  <button
                    className={
                      snapshot.primaryDomain === domain ? 'domain-card is-selected' : 'domain-card'
                    }
                    key={domain}
                    onClick={() => void savePreferences({ primaryDomain: domain })}
                    title={domain}
                  >
                    <Icon aria-hidden="true" size={22} />
                    <span>{domain.replace(/与.*$/u, '').replace(/、.*$/u, '')}</span>
                  </button>
                );
              })}
          </div>
          {snapshot.primaryDomain === null && (
            <p className="automatic-domain-note">未手动指定，翻译时将按当前网站规则自动选择。</p>
          )}
          <p className="micro-label">已选技术标签</p>
          <div className="chip-list" aria-label="已选技术标签">
            {snapshot.tags.length === 0 ? (
              <span className="empty-chip">未选择技术标签</span>
            ) : (
              snapshot.tags.map((tag) => (
                <span className="chip" key={tag} translate="no">
                  {tag}
                  <button
                    aria-label={`移除 ${tag}`}
                    onClick={() =>
                      void savePreferences({ tags: current.tags.filter((item) => item !== tag) })
                    }
                  >
                    <X aria-hidden="true" size={13} />
                  </button>
                </span>
              ))
            )}
            <button
              aria-controls="translation-tag-picker"
              aria-expanded={showTagPicker}
              className="add-chip"
              aria-label="添加技术标签"
              onClick={() => setShowTagPicker((value) => !value)}
            >
              <Plus aria-hidden="true" size={15} />
            </button>
          </div>
          {showTagPicker && (
            <div className="tag-picker" id="translation-tag-picker" aria-label="可添加的技术标签">
              <input
                aria-label="搜索或输入技术标签"
                autoComplete="off"
                name="technical-tag"
                onChange={(event) => setTagQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  void addTechnicalTag(tagQuery);
                }}
                placeholder="例如 Transformer…"
                spellCheck={false}
                value={tagQuery}
              />
              <div className="tag-options">
                {suggestedTags.map((tag) => (
                  <button
                    disabled={snapshot.tags.includes(tag)}
                    key={tag}
                    onClick={() => void addTechnicalTag(tag)}
                    translate="no"
                  >
                    {tag}
                  </button>
                ))}
                {tagQuery.trim() !== '' && !suggestedTags.includes(tagQuery.trim()) && (
                  <button onClick={() => void addTechnicalTag(tagQuery)}>
                    添加“{tagQuery.trim()}”
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="settings-section" aria-labelledby="model-heading">
          <div className="section-heading">
            <h2 id="model-heading">模型预设</h2>
          </div>
          <div className="model-grid">
            {defaultModelProfiles.slice(0, 3).map((profile) => (
              <button
                className={
                  snapshot.modelProfileId === profile.id ? 'model-card is-selected' : 'model-card'
                }
                key={profile.id}
                onClick={() => void savePreferences({ modelProfileId: profile.id })}
              >
                {profile.id === 'whole-page' ? (
                  <Play aria-hidden="true" size={17} />
                ) : (
                  <Sparkles aria-hidden="true" size={17} />
                )}
                <span>
                  <strong>{profile.label}</strong>
                  <small translate="no">
                    {profile.model.replace('deepseek-', '')} · {profile.thinking}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>

        {(translating || paused) && (
          <section className="translation-progress" aria-live="polite">
            <div className="progress-copy">
              <span>
                {paused ? '翻译已暂停' : '正在翻译页面内容'}
                {snapshot.translationBatch === undefined
                  ? ''
                  : ` · 第 ${String(snapshot.translationBatch)} 批`}
              </span>
              <strong>
                {snapshot.completedSegments}/{snapshot.totalSegments}
              </strong>
            </div>
            <progress max={snapshot.totalSegments} value={snapshot.completedSegments}>
              {snapshot.completedSegments}/{snapshot.totalSegments}
            </progress>
            <div className="progress-actions">
              {paused ? (
                <Button onClick={() => void resume()}>
                  <Play aria-hidden="true" size={16} />
                  继续
                </Button>
              ) : (
                <Button onClick={() => void pause()}>
                  <Pause aria-hidden="true" size={16} />
                  暂停
                </Button>
              )}
              <Button variant="ghost" onClick={() => void cancel()}>
                <Square aria-hidden="true" size={14} />
                取消
              </Button>
            </div>
          </section>
        )}

        {snapshot.scanDiagnostics !== undefined && (
          <details className="scan-report">
            <summary>
              <span>扫描报告</span>
              <strong>
                {snapshot.scanDiagnostics.queued}/{snapshot.scanDiagnostics.eligible} 已入队
              </strong>
            </summary>
            <dl>
              <div>
                <dt>可见文本</dt>
                <dd>{snapshot.scanDiagnostics.discoveredVisible}</dd>
              </div>
              <div>
                <dt>合格节点</dt>
                <dd>{snapshot.scanDiagnostics.eligible}</dd>
              </div>
              <div>
                <dt>已入队</dt>
                <dd>{snapshot.scanDiagnostics.queued}</dd>
              </div>
              <div>
                <dt>已完成</dt>
                <dd>{snapshot.scanDiagnostics.completed}</dd>
              </div>
              <div>
                <dt>已保护</dt>
                <dd>{snapshot.scanDiagnostics.protected}</dd>
              </div>
              <div>
                <dt>已忽略</dt>
                <dd>{snapshot.scanDiagnostics.ignored}</dd>
              </div>
              <div>
                <dt>翻译失败</dt>
                <dd>{snapshot.scanDiagnostics.failed}</dd>
              </div>
              <div>
                <dt>动态过期</dt>
                <dd>{snapshot.scanDiagnostics.stale}</dd>
              </div>
              <div>
                <dt>已取消</dt>
                <dd>{snapshot.scanDiagnostics.cancelled}</dd>
              </div>
              <div>
                <dt>超出预算</dt>
                <dd>{snapshot.scanDiagnostics.overBudget}</dd>
              </div>
              <div>
                <dt>未扫描</dt>
                <dd>{snapshot.scanDiagnostics.notScanned}</dd>
              </div>
              <div>
                <dt>不支持</dt>
                <dd>{snapshot.scanDiagnostics.unsupported}</dd>
              </div>
            </dl>
            {snapshot.hasMoreBatches === true && (
              <div className="scan-report__continuation" role="status">
                <div>
                  <strong>全文续批中</strong>
                  <span>
                    {snapshot.translationBatch === undefined
                      ? '当前批完成后会自动处理下一批。'
                      : `正在处理第 ${String(snapshot.translationBatch)} 批，完成后自动继续。`}
                  </span>
                </div>
                <button onClick={() => void openSidePanel()} type="button">
                  <PanelRightOpen aria-hidden="true" size={14} />
                  查看任务
                </button>
              </div>
            )}
          </details>
        )}
      </div>

      <footer className="popup-footer">
        {snapshot.page === 'pdf' ? (
          <div className="pdf-callout">
            <BookOpen aria-hidden="true" size={18} />
            <span>在 PDF 中选择文字后翻译或解释</span>
          </div>
        ) : (
          <div className="primary-actions">
            <Button
              disabled={disabled || translating || paused}
              onClick={() => void start()}
              variant="primary"
            >
              {snapshot.page === 'translated' ? (
                <RotateCcw aria-hidden="true" size={18} />
              ) : (
                <Play aria-hidden="true" size={18} />
              )}
              {primaryLabel}
            </Button>
            <Button onClick={() => void openSidePanel()}>
              <PanelRightOpen aria-hidden="true" size={18} />
              打开侧边栏
            </Button>
            {snapshot.page === 'translated' && (
              <Button variant="ghost" onClick={() => void restore()}>
                还原原文
              </Button>
            )}
          </div>
        )}

        {sidePanelError !== undefined && (
          <p className="popup-sidepanel-error" role="alert">
            {sidePanelError}
          </p>
        )}
        <div className="version-row">
          <span>研译 · Edge First</span>
          <span>
            v0.1.0
            <CircleHelp aria-hidden="true" size={14} />
          </span>
        </div>
      </footer>
    </main>
  );
}
