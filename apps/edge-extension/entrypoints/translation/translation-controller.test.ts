import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageTranslationController } from './translation-controller';

function installDom() {
  const dom = new JSDOM(
    `<!doctype html><html><head><title>Dynamic page</title></head><body>
      <main><p id="source">A stable technical paragraph contains enough useful words for translation.</p></main>
    </body></html>`,
    { url: 'https://docs.example.test/start' },
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    ShadowRoot: dom.window.ShadowRoot,
    HTMLIFrameElement: dom.window.HTMLIFrameElement,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
  });
  return dom;
}

describe('PageTranslationController', () => {
  afterEach(() => vi.useRealTimers());

  it('rejects a completed segment when a dynamic page changed after scanning', () => {
    const dom = installDom();
    const controller = new PageTranslationController(dom.window.document);
    const scan = controller.startScan();
    const segment = scan.segments.find(({ sourceText }) => sourceText.includes('stable technical'));
    if (segment === undefined) throw new Error('Expected the source segment to be scanned');

    const source = dom.window.document.querySelector('#source');
    if (source === null) throw new Error('Expected the source element');
    source.textContent = 'The page replaced this paragraph while translation was in progress.';

    const rendered = controller.completeSegment(
      {
        taskId: 'task-1',
        segmentId: segment.segmentId,
        sourceHash: segment.sourceHash,
        translation: '这段旧译文不应写入已经变化的页面。',
      },
      'below',
    );

    expect(rendered).toMatchObject({
      accepted: false,
      rendered: false,
      pending: false,
      reason: 'stale',
    });
    expect(dom.window.document.querySelector('[data-yanyi-owned="translation"]')).toBeNull();
    expect(source.textContent).toContain('replaced this paragraph');
    controller.restore();
  });

  it('buffers long-node parts and atomically commits only after every part arrives', () => {
    const dom = installDom();
    const source = dom.window.document.querySelector('#source');
    if (!(source instanceof dom.window.HTMLElement)) throw new Error('Expected source element');
    const original = `${'A reliable translation pipeline preserves page structure and context. '.repeat(20)}End.`;
    source.textContent = original;
    source.dataset.appState = 'preserved';
    const controller = new PageTranslationController(dom.window.document);
    const scan = controller.startScan();
    const firstNodeId = scan.segments[0]?.nodeId;
    const parts = scan.segments.filter(({ nodeId }) => nodeId === firstNodeId);
    expect(parts.length).toBeGreaterThan(1);

    const first = controller.completeSegment(
      {
        taskId: 'task-long',
        segmentId: parts[0]!.segmentId,
        sourceHash: parts[0]!.sourceHash,
        translation: '可靠的翻译流水线第一部分。',
      },
      'replace',
    );
    expect(first).toMatchObject({ accepted: true, rendered: false, pending: true });
    expect(source.textContent).toBe(original);

    for (const [index, part] of parts.slice(1).entries()) {
      const result = controller.completeSegment(
        {
          taskId: 'task-long',
          segmentId: part.segmentId,
          sourceHash: part.sourceHash,
          translation: `可靠的翻译流水线第 ${index + 2} 部分。`,
        },
        'replace',
      );
      if (index < parts.length - 2) expect(result.pending).toBe(true);
      else expect(result).toMatchObject({ accepted: true, rendered: true, pending: false });
    }

    expect(source.dataset.appState).toBe('preserved');
    expect(source.textContent).toContain('可靠的翻译流水线第一部分');
    controller.restore();
    controller.restore();
    expect(source.textContent).toBe(original);
    expect(source.dataset.appState).toBe('preserved');
  });

  it('discards buffered sibling parts when any part of the TextNode fails', () => {
    const dom = installDom();
    const source = dom.window.document.querySelector('#source');
    if (!(source instanceof dom.window.HTMLElement)) throw new Error('Expected source element');
    const original = `${'Atomic page translation must wait for every sibling part. '.repeat(24)}End.`;
    source.textContent = original;
    const controller = new PageTranslationController(dom.window.document);
    const scan = controller.startScan();
    const nodeId = scan.segments[0]?.nodeId;
    const parts = scan.segments.filter((segment) => segment.nodeId === nodeId);
    expect(parts.length).toBeGreaterThan(1);

    expect(
      controller.completeSegment(
        {
          taskId: 'task-failed-long-node',
          segmentId: parts[0]!.segmentId,
          sourceHash: parts[0]!.sourceHash,
          translation: 'First translated part.',
        },
        'replace',
      ),
    ).toMatchObject({ accepted: true, rendered: false, pending: true });

    expect(controller.failSegment(parts[1]!.segmentId)).toEqual(
      parts.map((part) => part.segmentId),
    );
    expect(
      controller.completeSegment(
        {
          taskId: 'task-failed-long-node',
          segmentId: parts[1]!.segmentId,
          sourceHash: parts[1]!.sourceHash,
          translation: 'Late translated part.',
        },
        'replace',
      ),
    ).toMatchObject({ accepted: false, rendered: false, pending: false, reason: 'failed' });
    expect(source.textContent).toBe(original);
    expect(controller.getDiagnostics()).toMatchObject({ completed: 0, failed: 1 });
    controller.restore();
  });

  it('rescans dynamic text after a 500 ms debounce without looping on owned commits', async () => {
    vi.useFakeTimers();
    const dom = installDom();
    const updates: { pageSessionId: string; segments: { sourceText: string }[] }[] = [];
    const controller = new PageTranslationController(dom.window.document, {
      onScanUpdate: (update) => updates.push(update),
    });
    const initial = controller.startScan();
    const dynamic = dom.window.document.createElement('button');
    dynamic.textContent = 'Retry';
    dom.window.document.querySelector('main')?.append(dynamic);

    await vi.advanceTimersByTimeAsync(499);
    expect(updates).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.pageSessionId).toBe(initial.pageSessionId);
    expect(updates[0]?.segments.map(({ sourceText }) => sourceText)).toContain('Retry');

    const segment = initial.segments[0]!;
    controller.completeSegment(
      {
        taskId: 'task-owned',
        segmentId: segment.segmentId,
        sourceHash: segment.sourceHash,
        translation: '稳定的技术段落。',
      },
      'below',
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(updates).toHaveLength(1);
    controller.restore();
  });

  it('requeues a changed TextNode version and rejects the old source hash', async () => {
    vi.useFakeTimers();
    const dom = installDom();
    const updates: {
      segments: { sourceText: string; segmentId: string; sourceHash: string }[];
      diagnostics: { completed: number; failed: number; stale: number };
    }[] = [];
    const controller = new PageTranslationController(dom.window.document, {
      onScanUpdate: (update) => updates.push(update),
    });
    const initial = controller.startScan();
    const old = initial.segments[0]!;
    const source = dom.window.document.querySelector('#source')?.firstChild;
    if (source?.nodeType !== dom.window.Node.TEXT_NODE) throw new Error('Expected source TextNode');
    source.textContent =
      'A dynamically updated technical paragraph must be translated as a new version.';

    await vi.advanceTimersByTimeAsync(500);

    const replacement = updates
      .at(-1)
      ?.segments.find(({ sourceText }) => sourceText.includes('dynamically updated'));
    expect(replacement).toBeDefined();
    expect(replacement?.segmentId).not.toBe(old.segmentId);
    expect(
      controller.completeSegment(
        {
          taskId: 'old-task',
          segmentId: old.segmentId,
          sourceHash: old.sourceHash,
          translation: '迟到的旧译文。',
        },
        'replace',
      ),
    ).toMatchObject({ accepted: false, rendered: false });
    expect(
      controller.completeSegment(
        {
          taskId: 'new-task',
          segmentId: replacement!.segmentId,
          sourceHash: replacement!.sourceHash,
          translation: '动态更新后的技术段落会作为新版本重新翻译。',
        },
        'replace',
      ),
    ).toMatchObject({ accepted: true, rendered: true });
    const lateButton = dom.window.document.createElement('button');
    lateButton.textContent = 'Retry current action';
    dom.window.document.querySelector('main')?.append(lateButton);
    await vi.advanceTimersByTimeAsync(500);
    expect(updates.at(-1)?.diagnostics).toMatchObject({ completed: 1, failed: 0, stale: 1 });
    expect(dom.window.document.querySelector('#source')?.textContent).toContain('动态更新后');
    controller.restore();
  });

  it('observes and requeues dynamic text inside an open ShadowRoot', async () => {
    vi.useFakeTimers();
    const dom = installDom();
    const host = dom.window.document.createElement('div');
    dom.window.document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button>Start</button>';
    const updates: { segments: { sourceText: string }[] }[] = [];
    const controller = new PageTranslationController(dom.window.document, {
      onScanUpdate: (update) => updates.push(update),
    });
    const initial = controller.startScan();
    expect(initial.segments.map(({ sourceText }) => sourceText)).toContain('Start');
    const shadowText = shadow.querySelector('button')?.firstChild;
    if (shadowText?.nodeType !== dom.window.Node.TEXT_NODE)
      throw new Error('Expected shadow TextNode');
    shadowText.textContent = 'Stop';

    await vi.advanceTimersByTimeAsync(500);

    expect(updates.at(-1)?.segments.map(({ sourceText }) => sourceText)).toContain('Stop');
    controller.restore();
  });

  it('discovers an open ShadowRoot attached to an existing host after the initial scan', async () => {
    vi.useFakeTimers();
    const dom = installDom();
    const host = dom.window.document.createElement('div');
    host.id = 'late-shadow-host';
    dom.window.document.body.append(host);
    const updates: { segments: { sourceText: string }[] }[] = [];
    const controller = new PageTranslationController(dom.window.document, {
      onScanUpdate: (update) => updates.push(update),
    });
    controller.startScan();

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button>Late shadow action</button>';
    await vi.advanceTimersByTimeAsync(500);

    expect(updates.at(-1)?.segments.map(({ sourceText }) => sourceText)).toContain(
      'Late shadow action',
    );
    controller.restore();
  });

  it('restores a replace-mode snapshot before a framework moves and rescans the TextNode', async () => {
    vi.useFakeTimers();
    const dom = installDom();
    const updates: { segments: { sourceText: string }[] }[] = [];
    const controller = new PageTranslationController(dom.window.document, {
      onScanUpdate: (update) => updates.push(update),
    });
    const initial = controller.startScan();
    const segment = initial.segments[0]!;
    expect(
      controller.completeSegment(
        {
          taskId: 'move-task',
          segmentId: segment.segmentId,
          sourceHash: segment.sourceHash,
          translation: '稳定的技术段落。',
        },
        'replace',
      ),
    ).toMatchObject({ rendered: true });
    const source = dom.window.document.querySelector('#source');
    const destination = dom.window.document.createElement('section');
    dom.window.document.body.append(destination);
    if (source === null) throw new Error('Expected source paragraph');
    destination.append(source);

    await vi.advanceTimersByTimeAsync(500);

    expect(source.textContent).toContain('A stable technical paragraph');
    expect(updates.at(-1)?.segments.map(({ sourceText }) => sourceText)).toContain(
      'A stable technical paragraph contains enough useful words for translation.',
    );
    controller.restore();
  });

  it('rotates the page session on SPA navigation and rejects late completions', () => {
    const dom = installDom();
    const updates: { pageSessionId: string; reason: string }[] = [];
    const controller = new PageTranslationController(dom.window.document, {
      onScanUpdate: (update) => updates.push(update),
    });
    const initial = controller.startScan();
    const old = initial.segments[0]!;

    dom.window.history.pushState({}, '', '/next');
    const navigation = controller.handleNavigation();

    expect(navigation.pageSessionId).not.toBe(initial.pageSessionId);
    expect(updates.at(-1)?.reason).toBe('navigation');
    expect(
      controller.completeSegment(
        {
          taskId: 'late-task',
          segmentId: old.segmentId,
          sourceHash: old.sourceHash,
          translation: '这条迟到消息必须被拒绝。',
        },
        'replace',
      ),
    ).toMatchObject({ accepted: false, rendered: false, pending: false });
    controller.restore();
  });
});
