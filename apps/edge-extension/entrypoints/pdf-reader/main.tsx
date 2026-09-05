import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  ChevronLeft,
  ChevronRight,
  FileUp,
  Languages,
  LoaderCircle,
  Search,
  Sparkles,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import { browser } from 'wxt/browser';
import {
  isProtocolEnvelope,
  type AssistantEventPayload,
  type TranslationProfile,
} from '@yanyi/protocol';
import { defaultModelProfiles } from '@yanyi/shared-types';
import { disabledOcrEngine } from './ocr-engine';
import '@yanyi/design-tokens/tokens.css';
import './pdf-reader.css';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_CHAPTER_PAGES = 3;
const MAX_ASSISTANT_CONTEXT = 20_000;
type ReaderMode = 'source' | 'translation' | 'bilingual';
type AssistantIntent = 'translate' | 'explain';

interface ReaderPosition {
  pageNumber: number;
  scale: number;
}
interface AssistantBridgeResponse {
  taskId?: string;
  accepted?: boolean;
}

function positionKey(fingerprint: string) {
  return `yanyi.pdf.position.v1.${fingerprint}`;
}
function translationKey(fingerprint: string, page: number) {
  return `yanyi.pdf.translation.v1.${fingerprint}.${String(page)}.page-v1`;
}

function isAssistantBridgeResponse(value: unknown): value is AssistantBridgeResponse {
  return typeof value === 'object' && value !== null;
}

async function extractPageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items
    .filter((item): item is typeof item & { str: string } => 'str' in item)
    .map((item) => item.str)
    .join(' ');
}

function PdfReader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTokenRef = useRef<symbol | undefined>(undefined);
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const activeCacheKeyRef = useRef<string | undefined>(undefined);
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy>();
  const [fingerprint, setFingerprint] = useState<string>();
  const [title, setTitle] = useState('未打开 PDF');
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [mode, setMode] = useState<ReaderMode>('source');
  const [pageText, setPageText] = useState('');
  const [translation, setTranslation] = useState('');
  const [answer, setAnswer] = useState('');
  const [selection, setSelection] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');

  async function openBytes(bytes: ArrayBuffer, nextTitle: string) {
    if (bytes.byteLength > MAX_PDF_BYTES) throw new Error('PDF 超过 50 MB 安全上限。');
    setLoading(true);
    setError(undefined);
    setTranslation('');
    setAnswer('');
    try {
      const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
      const nextFingerprint = pdf.fingerprints[0] ?? `${nextTitle}:${String(bytes.byteLength)}`;
      const stored = await browser.storage.local.get(positionKey(nextFingerprint));
      const position = stored[positionKey(nextFingerprint)] as ReaderPosition | undefined;
      setDocumentProxy(pdf);
      setFingerprint(nextFingerprint);
      setTitle(nextTitle);
      setPageNumber(Math.min(pdf.numPages, Math.max(1, position?.pageNumber ?? 1)));
      setScale(Math.min(3, Math.max(0.6, position?.scale ?? 1.2)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  function loadFile(file?: File) {
    if (file === undefined) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('请选择 PDF 文件。');
      return;
    }
    void file.arrayBuffer().then((bytes) => openBytes(bytes, file.name));
  }

  async function loadUrl(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const input = new FormData(event.currentTarget).get('url');
    if (typeof input !== 'string') return;
    const url = new URL(input);
    const granted = await browser.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) {
      setError('未授予该 PDF 地址的临时读取权限。');
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(url, { redirect: 'error' });
      if (!response.ok) throw new Error(`PDF 下载失败：HTTP ${String(response.status)}`);
      if (Number(response.headers.get('content-length') ?? 0) > MAX_PDF_BYTES)
        throw new Error('PDF 超过 50 MB 安全上限。');
      await openBytes(await response.arrayBuffer(), url.pathname.split('/').at(-1) ?? 'URL PDF');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    }
  }

  useEffect(() => {
    if (documentProxy === undefined) return;
    const renderToken = Symbol('pdf-render');
    renderTokenRef.current = renderToken;
    void (async () => {
      const page = await documentProxy.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const layer = textLayerRef.current;
      if (canvas === null || layer === null) return;
      const context = canvas.getContext('2d');
      if (context === null) return;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${String(viewport.width)}px`;
      canvas.style.height = `${String(viewport.height)}px`;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const content = await page.getTextContent();
      if (renderTokenRef.current !== renderToken) return;
      const items = content.items.filter(
        (
          item,
        ): item is typeof item & {
          str: string;
          transform: number[];
          width: number;
          height: number;
        } => 'str' in item,
      );
      setPageText(items.map((item) => item.str).join(' '));
      layer.replaceChildren();
      layer.style.width = `${String(viewport.width)}px`;
      layer.style.height = `${String(viewport.height)}px`;
      for (const item of items) {
        const span = document.createElement('span');
        span.textContent = item.str;
        span.style.left = `${String(item.transform[4] * scale)}px`;
        span.style.top = `${String(viewport.height - item.transform[5] * scale - item.height * scale)}px`;
        span.style.fontSize = `${String(Math.max(8, item.height * scale))}px`;
        layer.append(span);
      }
    })().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      renderTokenRef.current = undefined;
    };
  }, [documentProxy, pageNumber, scale]);

  useEffect(() => {
    if (fingerprint === undefined) return;
    void browser.storage.local.set({
      [positionKey(fingerprint)]: { pageNumber, scale } satisfies ReaderPosition,
    });
    void browser.storage.local.get(translationKey(fingerprint, pageNumber)).then((stored) => {
      const value = stored[translationKey(fingerprint, pageNumber)];
      setTranslation(typeof value === 'string' ? value : '');
    });
  }, [fingerprint, pageNumber, scale]);

  useEffect(() => {
    const handler = (message: unknown) => {
      if (
        typeof message !== 'object' ||
        message === null ||
        !('type' in message) ||
        message.type !== 'yanyi.assistant.event' ||
        !('event' in message) ||
        !isProtocolEnvelope(message.event)
      )
        return;
      const event = message.event;
      const payload = event.payload as unknown as AssistantEventPayload;
      if (payload.taskId !== activeTaskIdRef.current) return;
      if (event.type === 'assistant.delta') setAnswer((value) => value + (payload.delta ?? ''));
      if (event.type === 'assistant.completed') {
        setLoading(false);
        setAnswer((streamedAnswer) => {
          const completedAnswer =
            payload.answer?.trim() === '' ? streamedAnswer : (payload.answer ?? streamedAnswer);
          if (activeCacheKeyRef.current !== undefined) {
            setTranslation(completedAnswer);
            void browser.storage.local.set({ [activeCacheKeyRef.current]: completedAnswer });
          }
          return completedAnswer;
        });
      }
      if (event.type === 'assistant.failed') {
        setError(payload.error?.message ?? 'PDF 任务失败。');
        setLoading(false);
      }
      if (event.type === 'assistant.cancelled') {
        setLoading(false);
      }
    };
    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  }, []);

  async function startTask(
    intent: AssistantIntent,
    content: string,
    prompt: string,
    cacheKey?: string,
  ) {
    if (content.trim() === '') {
      setError(`当前页没有可用文本层；${disabledOcrEngine.statusMessage}`);
      return;
    }
    const configuredProfile = defaultModelProfiles.find(({ id }) =>
      intent === 'translate' ? id === 'precise' : id === 'explain',
    );
    if (configuredProfile === undefined) {
      setError('当前任务没有可用模型预设，请在桌面端恢复或选择模型。');
      return;
    }
    const profile: TranslationProfile = {
      model: configuredProfile.model,
      thinking: configuredProfile.thinking,
      ...(configuredProfile.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: configuredProfile.reasoningEffort }),
      maxOutputTokens: 8192,
      streaming: true,
    };
    setLoading(true);
    setError(undefined);
    setAnswer('');
    activeCacheKeyRef.current = cacheKey;
    const response: unknown = await browser.runtime
      .sendMessage({
        type: 'yanyi.assistant.start',
        payload: {
          intent,
          prompt,
          context: {
            selection: content.slice(0, 8_000),
            paragraph: content.slice(0, MAX_ASSISTANT_CONTEXT),
            heading: `PDF 第 ${String(pageNumber)} 页`,
            title,
          },
          profile,
        },
      })
      .catch(() => undefined);
    if (
      !isAssistantBridgeResponse(response) ||
      !response.accepted ||
      response.taskId === undefined
    ) {
      setLoading(false);
      setError('Native Host 未连接，任务未发送。');
      return;
    }
    activeTaskIdRef.current = response.taskId;
  }

  async function translateChapter() {
    if (documentProxy === undefined || fingerprint === undefined) return;
    setLoading(true);
    const end = Math.min(documentProxy.numPages, pageNumber + MAX_CHAPTER_PAGES - 1);
    const pages = await Promise.all(
      Array.from({ length: end - pageNumber + 1 }, (_, index) => pageNumber + index).map(
        async (page) => `\n[第 ${String(page)} 页]\n${await extractPageText(documentProxy, page)}`,
      ),
    );
    await startTask(
      'translate',
      pages.join('').slice(0, MAX_ASSISTANT_CONTEXT),
      `翻译从第 ${String(pageNumber)} 页开始的当前章节片段；页面标记保持原样。该片段最多包含 ${String(MAX_CHAPTER_PAGES)} 页。`,
    );
  }

  function stopTask() {
    if (activeTaskIdRef.current !== undefined)
      void browser.runtime.sendMessage({
        type: 'yanyi.assistant.cancel',
        taskId: activeTaskIdRef.current,
      });
  }

  const highlightedSearch =
    search.trim() !== '' && pageText.toLowerCase().includes(search.trim().toLowerCase());
  return (
    <main className="pdf-shell">
      <header>
        <div className="brand">
          <span aria-hidden="true">研</span>
          <div>
            <strong>PDF 双语阅读器</strong>
            <small title={title}>{title}</small>
          </div>
        </div>
        <div className="reader-actions">
          <label className="file-button">
            <FileUp aria-hidden="true" size={16} />
            打开本地 PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => loadFile(event.currentTarget.files?.[0])}
            />
          </label>
          <form onSubmit={(event) => void loadUrl(event)}>
            <input name="url" type="url" aria-label="PDF 地址" placeholder="https://…/paper.pdf" />
            <button>打开 URL</button>
          </form>
        </div>
      </header>
      <nav aria-label="PDF 阅读控制">
        <button
          disabled={pageNumber <= 1}
          onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
        >
          <ChevronLeft aria-hidden="true" />
          上一页
        </button>
        <span>
          {String(pageNumber)} / {String(documentProxy?.numPages ?? 0)}
        </span>
        <button
          disabled={documentProxy === undefined || pageNumber >= documentProxy.numPages}
          onClick={() => setPageNumber((value) => value + 1)}
        >
          下一页
          <ChevronRight aria-hidden="true" />
        </button>
        <button aria-label="缩小" onClick={() => setScale((value) => Math.max(0.6, value - 0.1))}>
          <ZoomOut aria-hidden="true" />
        </button>
        <button aria-label="放大" onClick={() => setScale((value) => Math.min(3, value + 0.1))}>
          <ZoomIn aria-hidden="true" />
        </button>
        <label className="pdf-search">
          <Search aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="搜索当前页"
          />
        </label>
        {search !== '' && (
          <span className={highlightedSearch ? 'found' : 'not-found'}>
            {highlightedSearch ? '当前页有匹配' : '当前页无匹配'}
          </span>
        )}
        <div className="mode-group" role="group" aria-label="阅读模式">
          {(['source', 'translation', 'bilingual'] as const).map((value) => (
            <button aria-pressed={mode === value} key={value} onClick={() => setMode(value)}>
              {value === 'source' ? '原文' : value === 'translation' ? '译文' : '双语'}
            </button>
          ))}
        </div>
        <button
          disabled={documentProxy === undefined || loading || fingerprint === undefined}
          onClick={() =>
            void startTask(
              'translate',
              pageText,
              '翻译当前 PDF 页面',
              fingerprint === undefined ? undefined : translationKey(fingerprint, pageNumber),
            )
          }
        >
          <Languages aria-hidden="true" />
          翻译当前页
        </button>
        <button
          disabled={documentProxy === undefined || loading}
          title={`从当前页起，最多读取 ${String(MAX_CHAPTER_PAGES)} 页和 ${String(MAX_ASSISTANT_CONTEXT)} 字符`}
          onClick={() => void translateChapter()}
        >
          <BookIcon />
          翻译当前章
        </button>
        <button
          disabled={selection === '' || loading}
          onClick={() => void startTask('explain', selection, '解释当前 PDF 选区')}
        >
          <Sparkles aria-hidden="true" />
          解释选区
        </button>
        {loading && (
          <button onClick={stopTask}>
            <Square aria-hidden="true" />
            停止
          </button>
        )}
      </nav>
      {error !== undefined && (
        <div className="pdf-error" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <div className="pdf-loading" aria-live="polite">
          <LoaderCircle className="spin" aria-hidden="true" />
          正在处理 PDF；原文保持不变…
        </div>
      )}
      <section
        className={`reader-grid reader-grid--${mode}`}
        onMouseUp={() => setSelection(getSelection()?.toString().trim() ?? '')}
      >
        <div className="page-column" hidden={mode === 'translation'}>
          <div className="page-surface">
            <canvas ref={canvasRef} />
            <div className="text-layer" ref={textLayerRef} />
            {documentProxy === undefined && (
              <div className="pdf-empty">
                <FileUp aria-hidden="true" />
                <strong>打开文本型 PDF 开始阅读</strong>
                <span>本地文件不会上传；无文本层页面会明确提示 OCR 未启用。</span>
              </div>
            )}
          </div>
        </div>
        <article className="translation-column" hidden={mode === 'source'}>
          <span className="machine-label">研译 · 机器翻译</span>
          {translation !== '' ? (
            <p>{translation}</p>
          ) : (
            <div className="translation-empty">翻译当前页后，完整结果会在这里原子显示。</div>
          )}
          {answer !== '' && translation === '' && <p>{answer}</p>}
        </article>
      </section>
    </main>
  );
}

function BookIcon() {
  return <span aria-hidden="true">§</span>;
}
const root = document.querySelector('#root');
if (!(root instanceof HTMLElement)) throw new Error('无法初始化 PDF 阅读器。');
ReactDOM.createRoot(root).render(<PdfReader />);
