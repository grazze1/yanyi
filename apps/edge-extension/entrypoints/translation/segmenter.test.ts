import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  MAX_PAGE_SEGMENTS,
  MAX_SEGMENT_CHARS,
  scanPage,
  stableHash,
  TextNodeIdentityRegistry,
} from './segmenter';
import { TranslationRenderer } from './renderer';

function page() {
  return new JSDOM(`<!doctype html><html><head></head><body>
    <h1>Translation pipeline reference page with enough useful content to include.</h1>
    <p id="copy">Use <code>cargo test</code> with https://example.test/api and cite [12] before deployment.</p>
    <pre>must never scan this source</pre><p hidden>Hidden source must never leave the page.</p>
    <div contenteditable="true">Editable source must never leave the page.</div>
    <ul><li>Nested list parent description contains enough useful words for one segment.<ul><li>Nested child description contains enough useful words for another segment.</li></ul></li></ul>
  </body></html>`);
}

describe('DOM segmenter and renderer', () => {
  it('does not alias distinct source text in the persistent translation cache', () => {
    // This pair is a published FNV-1a/32 collision. A cache identity must distinguish them.
    expect(stableHash('costarring')).not.toBe(stableHash('liquid'));
  });

  it('emits deterministic, versioned 128-bit fingerprints so legacy cache keys expire', () => {
    const fingerprint = stableHash('研译 / PyTorch v2.4');

    expect(fingerprint).toBe(stableHash('研译 / PyTorch v2.4'));
    expect(fingerprint).toMatch(/^fnv1a128-v1-[0-9a-f]{32}$/u);
    expect(fingerprint).not.toMatch(/^[0-9a-f]{8}$/u);
  });

  it('walks visible TextNodes including short controls, links, tables, and open shadow roots', () => {
    const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <nav><a id="docs" href="/docs">Docs</a><button id="save">Save</button></nav>
      <table><tbody><tr><th>API</th><td>Stable</td></tr></tbody></table>
      <span id="status">Ready</span><code>cargo test</code><span hidden>Hidden label</span>
      <section id="shadow-host"></section>
    </body></html>`);
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Node: dom.window.Node,
      NodeFilter: dom.window.NodeFilter,
      Element: dom.window.Element,
      HTMLElement: dom.window.HTMLElement,
      ShadowRoot: dom.window.ShadowRoot,
      HTMLIFrameElement: dom.window.HTMLIFrameElement,
      getComputedStyle: dom.window.getComputedStyle,
    });
    const shadow = dom.window.document
      .querySelector('#shadow-host')
      ?.attachShadow({ mode: 'open' });
    shadow!.innerHTML = '<button id="shadow-action">Run</button>';

    const result = scanPage(dom.window.document, '00000000-0000-4000-8000-000000000010');
    const sources = result.segments.map(({ sourceText }) => sourceText);

    expect(sources).toEqual(
      expect.arrayContaining(['Docs', 'Save', 'API', 'Stable', 'Ready', 'Run']),
    );
    expect(sources).not.toContain('cargo test');
    expect(sources).not.toContain('Hidden label');
    expect(result.diagnostics.discoveredVisible).toBeGreaterThanOrEqual(7);
    expect(result.diagnostics.protected).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.queued).toBe(result.segments.length);
    expect(result.segments.find(({ sourceText }) => sourceText === 'Save')).toMatchObject({
      domRole: 'button',
      partIndex: 0,
      partCount: 1,
    });
  });

  it('discovers same-origin iframe text and derives a bounded local page profile', () => {
    const dom = new JSDOM(
      `<!doctype html><html><head><title>PyTorch CUDA API Guide</title></head><body>
        <nav><button>Install</button></nav><h1>PyTorch CUDA Reference</h1>
        <p><span translate="no">CUDA Graphs</span> improve GPU execution.</p>
        <iframe id="same-origin"></iframe>
      </body></html>`,
      { url: 'https://docs.example.test/api' },
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
      getComputedStyle: dom.window.getComputedStyle,
    });
    const frame = dom.window.document.querySelector('#same-origin') as HTMLIFrameElement | null;
    const frameDocument = frame?.contentDocument;
    if (frameDocument === null || frameDocument === undefined)
      throw new Error('Expected iframe document');
    frameDocument.body.innerHTML = '<button>Frame action</button>';

    const result = scanPage(dom.window.document, '00000000-0000-4000-8000-000000000012');

    expect(result.segments.map(({ sourceText }) => sourceText)).toContain('Frame action');
    expect(result.pageProfile).toMatchObject({
      pageTitle: 'PyTorch CUDA API Guide',
      site: 'docs.example.test',
      documentType: 'webpage',
    });
    expect(result.pageProfile.acronyms).toEqual(expect.arrayContaining(['CUDA', 'API', 'GPU']));
    expect(result.pageProfile.protectedTerms).toContain('CUDA Graphs');
    expect(result.pageProfile.uiVocabulary).toContain('Install');
  });

  it('does not misclassify ordinary Title Case headings as protected product names', () => {
    const dom = new JSDOM(`<!doctype html><html><head><title>Getting Started</title></head><body>
      <h1>Install Dependencies</h1>
      <p>PyTorch integrates with GitHub and TensorRT for deployment.</p>
    </body></html>`);
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Node: dom.window.Node,
      NodeFilter: dom.window.NodeFilter,
      Element: dom.window.Element,
      HTMLElement: dom.window.HTMLElement,
      ShadowRoot: dom.window.ShadowRoot,
      HTMLIFrameElement: dom.window.HTMLIFrameElement,
      getComputedStyle: dom.window.getComputedStyle,
    });

    const profile = scanPage(
      dom.window.document,
      '00000000-0000-4000-8000-000000000015',
    ).pageProfile;

    expect(profile.productNames).toEqual(expect.arrayContaining(['PyTorch', 'GitHub', 'TensorRT']));
    expect(profile.productNames).not.toEqual(
      expect.arrayContaining(['Getting Started', 'Install Dependencies', 'Getting', 'Started']),
    );
  });

  it('reports over-budget nodes instead of silently truncating discovery', () => {
    const buttons = Array.from(
      { length: MAX_PAGE_SEGMENTS + 5 },
      (_, index) => `<button>Action ${index}</button>`,
    ).join('');
    const dom = new JSDOM(`<!doctype html><html><body>${buttons}</body></html>`);
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Node: dom.window.Node,
      NodeFilter: dom.window.NodeFilter,
      Element: dom.window.Element,
      HTMLElement: dom.window.HTMLElement,
      ShadowRoot: dom.window.ShadowRoot,
      HTMLIFrameElement: dom.window.HTMLIFrameElement,
      getComputedStyle: dom.window.getComputedStyle,
    });

    const result = scanPage(dom.window.document, '00000000-0000-4000-8000-000000000011');

    expect(result.segments).toHaveLength(MAX_PAGE_SEGMENTS);
    expect(result.capped).toBe(true);
    expect(result.diagnostics.eligible).toBe(MAX_PAGE_SEGMENTS + 5);
    expect(result.diagnostics.overBudget).toBe(5);
    expect(result.continuationCursor).toBe(MAX_PAGE_SEGMENTS);
    expect(result.untranslated.filter(({ reason }) => reason === 'over_budget')).toHaveLength(5);
  });

  it('continues every unqueued node even when viewport priority changes between batches', () => {
    const buttons = Array.from(
      { length: MAX_PAGE_SEGMENTS + 5 },
      (_, index) =>
        `<button data-index="${String(index)}">Action ${String(index)} documentation</button>`,
    ).join('');
    const dom = new JSDOM(`<!doctype html><html><body>${buttons}</body></html>`);
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Node: dom.window.Node,
      NodeFilter: dom.window.NodeFilter,
      Element: dom.window.Element,
      HTMLElement: dom.window.HTMLElement,
      ShadowRoot: dom.window.ShadowRoot,
      HTMLIFrameElement: dom.window.HTMLIFrameElement,
      getComputedStyle: dom.window.getComputedStyle,
    });
    let scrolled = false;
    for (const button of dom.window.document.querySelectorAll('button')) {
      const index = Number(button.getAttribute('data-index'));
      button.getBoundingClientRect = () => {
        const inViewport = scrolled ? index >= MAX_PAGE_SEGMENTS : index < MAX_PAGE_SEGMENTS;
        const top = inViewport ? 10 : 10_000;
        return {
          x: 0,
          y: top,
          top,
          right: 100,
          bottom: top + 20,
          left: 0,
          width: 100,
          height: 20,
          toJSON: () => ({}),
        };
      };
    }
    const registry = new TextNodeIdentityRegistry();
    const sessionId = '00000000-0000-4000-8000-000000000016';
    const first = scanPage(dom.window.document, sessionId, undefined, {
      identityRegistry: registry,
    });
    expect(first.segments).toHaveLength(MAX_PAGE_SEGMENTS);
    expect(first.continuationCursor).toBeDefined();
    if (first.continuationCursor === undefined) throw new Error('expected continuation cursor');

    scrolled = true;
    const continuation = scanPage(
      dom.window.document,
      sessionId,
      { continuationCursor: first.continuationCursor },
      {
        identityRegistry: registry,
        excludeSegmentIds: new Set(first.segments.map(({ segmentId }) => segmentId)),
      },
    );

    expect(continuation.segments.map(({ sourceText }) => sourceText)).toEqual(
      Array.from(
        { length: 5 },
        (_, offset) => `Action ${String(MAX_PAGE_SEGMENTS + offset)} documentation`,
      ),
    );
    expect(continuation.continuationCursor).toBeUndefined();
  });

  it('does not scan hidden/editable/pre content and protects opaque fragments', () => {
    const dom = page();
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Node: dom.window.Node,
      Element: dom.window.Element,
      HTMLElement: dom.window.HTMLElement,
      getComputedStyle: dom.window.getComputedStyle,
    });
    const result = scanPage(dom.window.document, '00000000-0000-4000-8000-000000000001');
    const copy = result.segments.find((segment) => segment.sourceText.includes('__YANYI_URL_0__'));
    expect(copy?.sourceText).toContain('__YANYI_URL_0__');
    expect(copy?.sourceText).toContain('__YANYI_CITATION_1__');
    expect(result.segments.some((segment) => segment.sourceText.includes('cargo test'))).toBe(
      false,
    );
    expect(result.segments.some((segment) => segment.sourceText.includes('Hidden source'))).toBe(
      false,
    );
    expect(result.segments.some((segment) => segment.sourceText.includes('Editable source'))).toBe(
      false,
    );
  });

  it('commits only a final validated segment and restores idempotently', () => {
    const dom = page();
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Node: dom.window.Node,
      Element: dom.window.Element,
      HTMLElement: dom.window.HTMLElement,
      getComputedStyle: dom.window.getComputedStyle,
    });
    const segment = scanPage(
      dom.window.document,
      '00000000-0000-4000-8000-000000000001',
    ).segments.find((item) => item.element.id === 'copy' && item.sourceText === 'Use');
    expect(segment).toBeDefined();
    const renderer = new TranslationRenderer(dom.window.document, (operation) => operation());
    const translation = '请使用';
    expect(renderer.renderCompleted(segment!, translation, 'replace')).toBe(true);
    expect(dom.window.document.querySelector('#copy')?.textContent).toContain('请使用');
    expect(dom.window.document.querySelector('#copy code')?.textContent).toBe('cargo test');
    expect(dom.window.document.querySelector('[data-yanyi-owned="translation"]')).toBeNull();
    renderer.restore();
    renderer.restore();
    expect(dom.window.document.querySelector('[data-yanyi-owned="translation"]')).toBeNull();
    expect(dom.window.document.querySelector('#copy')?.textContent).toContain('Use cargo test');
  });

  it('switches inline TextNodes between inherited below and in-place replace modes', () => {
    const dom = new JSDOM(
      '<!doctype html><html><head></head><body><button id="save" data-state="ready">Save</button></body></html>',
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
      getComputedStyle: dom.window.getComputedStyle,
    });
    const button = dom.window.document.querySelector('#save') as HTMLButtonElement | null;
    if (button === null) throw new Error('Expected save button');
    let clicks = 0;
    button.addEventListener('click', () => (clicks += 1));
    const segment = scanPage(dom.window.document, '00000000-0000-4000-8000-000000000013')
      .segments[0]!;
    const renderer = new TranslationRenderer(dom.window.document, (operation) => operation());

    expect(renderer.renderCompleted(segment, '保存', 'below')).toBe(true);
    expect(segment.node.data).toBe('Save');
    expect(button.querySelector('[data-yanyi-owned="translation"]')).toMatchObject({
      dataset: expect.objectContaining({ yanyiLayout: 'inline', yanyiMode: 'below' }),
    });
    expect(dom.window.document.querySelector('style')?.textContent).toContain(
      'background: transparent',
    );

    renderer.applyMode('replace');
    expect(segment.node.data).toBe('保存');
    expect(button.querySelector('[data-yanyi-owned="translation"]')).toBeNull();
    button.click();
    expect(clicks).toBe(1);
    expect(button.dataset.state).toBe('ready');

    renderer.applyMode('bilingual');
    expect(segment.node.data).toBe('Save');
    expect(
      button.querySelector('[data-yanyi-owned="translation"]')?.getAttribute('data-yanyi-layout'),
    ).toBe('inline');
    renderer.restore();
    expect(button.textContent).toBe('Save');
  });

  it('applies validated website scope and ignored selectors before content leaves the page', () => {
    const dom = page();
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Node: dom.window.Node,
      Element: dom.window.Element,
      HTMLElement: dom.window.HTMLElement,
      getComputedStyle: dom.window.getComputedStyle,
    });
    const result = scanPage(dom.window.document, '00000000-0000-4000-8000-000000000001', {
      forceContentSelector: 'body',
      ignoredSelectors: ['#copy'],
      translateTables: false,
    });
    expect(result.segments.some((segment) => segment.element.id === 'copy')).toBe(false);
    expect(
      result.segments.some((segment) => segment.sourceText.includes('Translation pipeline')),
    ).toBe(true);
  });

  it('assigns each split part only its own ordered placeholders and protected nodes', () => {
    const opening =
      'The opening section explains reliable systems architecture for production deployments. '.repeat(
        9,
      );
    const later =
      'The later section discusses validation, observability, and recovery across services. '.repeat(
        9,
      );
    const dom = new JSDOM(`<!doctype html><html><body>
      <p id="long">${opening}${later} Read https://example.test/guide and cite [42] and [42] before release.</p>
    </body></html>`);
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Node: dom.window.Node,
      Element: dom.window.Element,
      HTMLElement: dom.window.HTMLElement,
      getComputedStyle: dom.window.getComputedStyle,
    });

    expect(dom.window.document.querySelector('#long')?.textContent?.length).toBeGreaterThan(
      MAX_SEGMENT_CHARS,
    );
    const parts = scanPage(
      dom.window.document,
      '00000000-0000-4000-8000-000000000002',
    ).segments.filter((segment) => segment.element.id === 'long' && segment.partCount > 1);

    expect(parts).toHaveLength(2);
    expect(parts.map((part) => part.placeholders)).toEqual([
      [],
      ['__YANYI_URL_0__', '__YANYI_CITATION_1__', '__YANYI_CITATION_2__'],
    ]);
    expect(parts.map((part) => part.placeholdersDetailed.map(({ token }) => token))).toEqual(
      parts.map((part) => part.placeholders),
    );
    expect(parts.every((part) => part.nodeId === parts[0]?.nodeId)).toBe(true);
    expect(parts.map((part) => part.partIndex)).toEqual([0, 1]);
    expect(
      scanPage(dom.window.document, '00000000-0000-4000-8000-000000000003').diagnostics,
    ).toMatchObject({
      eligible: 1,
      queued: 1,
    });
  });

  it('never splits through a protected placeholder token at the segment boundary', () => {
    const source = `${'A'.repeat(1_190)} https://example.test/${'path/'.repeat(20)} final words remain translatable.`;
    const dom = new JSDOM(`<!doctype html><html><body><p>${source}</p></body></html>`);
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Node: dom.window.Node,
      NodeFilter: dom.window.NodeFilter,
      Element: dom.window.Element,
      HTMLElement: dom.window.HTMLElement,
      ShadowRoot: dom.window.ShadowRoot,
      HTMLIFrameElement: dom.window.HTMLIFrameElement,
      getComputedStyle: dom.window.getComputedStyle,
    });

    const parts = scanPage(dom.window.document, '00000000-0000-4000-8000-000000000014').segments;

    expect(parts.length).toBeGreaterThan(1);
    expect(
      parts.filter(({ placeholders }) => placeholders.includes('__YANYI_URL_0__')),
    ).toHaveLength(1);
    expect(parts.every(({ sourceText }) => !sourceText.includes('__YANYI_URL_'))).toBe(false);
    expect(parts.every(({ sourceText }) => sourceText.length <= MAX_SEGMENT_CHARS)).toBe(true);
  });

  it('protects versions, API identifiers, snake_case names, and CLI flags in ordinary text', () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <p>PyTorch v2.4 calls torch.nn.Module with max_output_tokens and --strict during validation.</p>
    </body></html>`);
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Node: dom.window.Node,
      NodeFilter: dom.window.NodeFilter,
      Element: dom.window.Element,
      HTMLElement: dom.window.HTMLElement,
      ShadowRoot: dom.window.ShadowRoot,
      HTMLIFrameElement: dom.window.HTMLIFrameElement,
      getComputedStyle: dom.window.getComputedStyle,
    });

    const segment = scanPage(dom.window.document, '00000000-0000-4000-8000-000000000015')
      .segments[0];

    expect(segment?.placeholdersDetailed.map(({ kind, text }) => ({ kind, text }))).toEqual([
      { kind: 'VERSION', text: 'v2.4' },
      { kind: 'IDENTIFIER', text: 'torch.nn.Module' },
      { kind: 'IDENTIFIER', text: 'max_output_tokens' },
      { kind: 'IDENTIFIER', text: '--strict' },
    ]);
    expect(segment?.sourceText.match(/__YANYI_[A-Z]+_[0-9]+__/gu)).toHaveLength(4);
  });
});
