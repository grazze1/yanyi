import { expect, test, chromium, type BrowserContext } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const edgeExtensionId = 'ajpiobadehjdkionkgfkpipjfgdgopjn';
const chromeExtensionId = 'clneblfdkkemjfehjgolimihblegcice';
const edgeExecutable = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const chromeExecutable = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const screenshots = resolve('docs/screenshots');

async function launchExtension(
  outputName: 'edge-mv3' | 'edge-mv3-test' | 'chrome-mv3' | 'chrome-mv3-test',
  profileName: string,
  deviceScaleFactor: number,
  executablePath = edgeExecutable,
  processEnv?: Record<string, string>,
): Promise<BrowserContext> {
  const extensionPath = resolve(`apps/edge-extension/.output/${outputName}`);
  const profilePath = resolve(
    `.playwright-profile/${profileName}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  return chromium.launchPersistentContext(profilePath, {
    executablePath,
    headless: false,
    viewport: { width: 380, height: 640 },
    deviceScaleFactor,
    env: { ...process.env, ...processEnv },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });
}

function isolatedNativeEnvironment(
  profileName: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const nonce = `${String(Date.now())}-${Math.random().toString(16).slice(2)}`;
  return {
    YANYI_DATA_DIR: resolve('test-results/native-e2e', `${profileName}-${nonce}`),
    ...overrides,
  };
}

async function startTranslationFixture(
  responseDelayMs = 0,
  translationForSource?: (sourceText: string, defaultTranslation: string) => string,
) {
  const providerRequests: unknown[] = [];
  const server = createServer((request, response) => {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head><title>Control systems fixture</title></head>
        <body><main><h1>Feedback control systems</h1>
        <p id="source">A feedback controller continuously reduces tracking error while preserving system stability under bounded disturbances.</p>
        </main></body></html>`);
      return;
    }
    let requestBody = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      requestBody += chunk;
    });
    request.on('end', () => {
      let parsedRequest: unknown;
      try {
        parsedRequest = JSON.parse(requestBody);
        providerRequests.push(parsedRequest);
      } catch {
        parsedRequest = undefined;
      }
      const messages =
        typeof parsedRequest === 'object' && parsedRequest !== null && 'messages' in parsedRequest
          ? (parsedRequest as { messages?: { role?: string; content?: string }[] }).messages
          : undefined;
      const systemPrompt = messages?.find(({ role }) => role === 'system')?.content ?? '';
      const sourceText = messages?.find(({ role }) => role === 'user')?.content ?? '';
      const placeholders = sourceText.match(/__YANYI_[A-Z]+_\d+__/gu) ?? [];
      const translationBase = systemPrompt.includes('"targetLanguage":"ja"')
        ? 'フィードバック制御器は追従誤差を継続的に低減し、有界外乱の下でもシステムの安定性を維持します。'
        : '反馈控制器会持续减小跟踪误差，同时在有界扰动下保持系统稳定。';
      const defaultTranslation = `${translationBase}${placeholders.join('')}`;
      const translation =
        translationForSource?.(sourceText, defaultTranslation) ?? defaultTranslation;
      const sendTranslation = () => {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        });
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: translation } }] })}\n\n`,
        );
        response.write(
          'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":12,"total_tokens":20}}\n\n',
        );
        response.end('data: [DONE]\n\n');
      };
      if (responseDelayMs > 0) setTimeout(sendTranslation, responseDelayMs);
      else sendTranslation();
    });
  });
  await new Promise<void>((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Fixture server failed');
  return {
    server,
    providerRequests,
    url: `http://127.0.0.1:${String(address.port)}/page`,
    providerUrl: `http://127.0.0.1:${String(address.port)}/`,
  };
}

async function startCoverageFixture() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
      <html lang="en">
        <head>
          <title>GPU systems guide</title>
          <style>
            body { color: #dbeafe; background: #0f172a; font: 16px/1.5 system-ui; }
            [hidden], .hidden { display: none; }
          </style>
        </head>
        <body>
          <nav aria-label="Documentation"><a href="#overview">Overview</a><button id="copy-button" data-action="copy" type="button">Copy command</button></nav>
          <main id="overview">
            <h1>GPU acceleration guide</h1>
            <div class="card"><span>Tensor cores accelerate mixed precision matrix operations.</span><a href="#details">Read details</a></div>
            <p id="details">The scheduler overlaps communication with computation across every worker.</p>
            <ul><li>Profile memory bandwidth before increasing the batch size.</li></ul>
            <table><tbody><tr><th>Device</th><td>Training throughput</td></tr></tbody></table>
            <p>Run <code>torch.compile(model)</code> and preserve <span aria-label="formula">E = mc²</span>.</p>
            <div id="shadow-host"></div>
            <div id="late-shadow-host"></div>
            <iframe title="Same-origin notes" srcdoc="<p>Same-origin frame guidance remains translatable.</p>"></iframe>
            <p class="hidden">This hidden sentence must not be queued.</p>
            <textarea>Editable text must stay untouched.</textarea>
          </main>
          <script>
            document.querySelector('#copy-button').addEventListener('click', (event) => {
              const button = event.currentTarget;
              button.dataset.clicks = String(Number(button.dataset.clicks || 0) + 1);
            });
            const root = document.querySelector('#shadow-host').attachShadow({ mode: 'open' });
            root.innerHTML = '<section><span>Open shadow DOM documentation label.</span></section>';
          </script>
        </body>
      </html>`);
  });
  await new Promise<void>((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Coverage fixture failed');
  return { server, url: `http://127.0.0.1:${String(address.port)}/coverage` };
}

test.beforeAll(async () => {
  await mkdir(screenshots, { recursive: true });
});

test('production Edge extension completes Native Host handshake and exposes core pages', async () => {
  test.skip(
    process.env.YANYI_E2E_PRODUCTION !== '1',
    'requires explicit Native Host registry setup',
  );
  const context = await launchExtension(
    'edge-mv3',
    'production-125',
    1.25,
    edgeExecutable,
    isolatedNativeEnvironment('production'),
  );
  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${edgeExtensionId}/popup.html`);
    await expect(popup.locator('.connection-card--connected')).toBeVisible({ timeout: 15_000 });
    await expect(popup.getByRole('main')).toHaveCSS('width', '380px');
    await popup.screenshot({ path: resolve(screenshots, 'popup-connected-125.png') });

    await popup.keyboard.press('Tab');
    await expect(popup.locator(':focus')).toBeVisible();

    const sidePanel = await context.newPage();
    await sidePanel.goto(`chrome-extension://${edgeExtensionId}/sidepanel.html`);
    await expect(sidePanel.locator('.sidepanel-shell')).toBeVisible();
    await expect(sidePanel.getByRole('navigation', { name: '侧边栏功能' })).toBeVisible();
    await sidePanel.getByRole('button', { name: '查看发送范围' }).click();
    await expect(sidePanel.locator('.yanyi-context__details')).toBeVisible();
    await expect(sidePanel.getByRole('textbox', { name: '继续询问' })).toBeVisible();
    await expect(sidePanel.getByRole('button', { name: '发送', exact: true })).toBeDisabled();

    await sidePanel.getByRole('button', { name: '页面', exact: true }).click();
    await expect(sidePanel.getByRole('heading', { name: '当前页面' })).toBeVisible();
    await expect(sidePanel.getByRole('progressbar')).toBeVisible();
    await expect(sidePanel.getByText('页面安全承诺')).toBeVisible();

    await sidePanel.getByRole('button', { name: '笔记', exact: true }).click();
    await expect(sidePanel.getByRole('heading', { name: '记录当前理解' })).toBeVisible();
    await expect(sidePanel.getByRole('textbox', { name: '笔记内容' })).toBeVisible();
    await expect(sidePanel.getByRole('button', { name: '保存笔记' })).toBeDisabled();

    await sidePanel.getByRole('button', { name: '助手', exact: true }).click();
    await expect(sidePanel.getByRole('textbox', { name: '继续询问' })).toBeVisible();
    await sidePanel.screenshot({ path: resolve(screenshots, 'sidepanel-smoke.png') });

    const options = await context.newPage();
    await options.goto(`chrome-extension://${edgeExtensionId}/options.html`);
    await expect(options.getByRole('heading', { name: '扩展设置与诊断' })).toBeVisible();
    await expect(options.locator('body')).toContainText('DPAPI');
  } finally {
    await context.close();
  }
});

test('Edge fixture build renders core states and pages at 150% scale', async () => {
  for (const browser of [
    {
      name: 'edge',
      output: 'edge-mv3-test' as const,
      id: edgeExtensionId,
      executable: edgeExecutable,
    },
  ]) {
    const context = await launchExtension(
      browser.output,
      `${browser.name}-fixtures-150`,
      1.5,
      browser.executable,
    );
    try {
      for (const fixture of ['offline', 'error', 'pdf', 'scan-report'] as const) {
        const page = await context.newPage();
        await page.setViewportSize({ width: 360, height: 640 });
        await page.goto(`chrome-extension://${browser.id}/popup.html?fixture=${fixture}`);
        await expect(page.locator('.popup-shell')).toBeVisible();
        await expect(page.locator('.popup-shell')).toHaveCSS('width', '360px');
        if (fixture === 'scan-report') {
          const report = page.locator('details.scan-report');
          await report.locator('summary').click();
          await expect(report.locator('dt')).toHaveCount(12);
          await expect(report.getByRole('button', { name: '查看任务' })).toBeVisible();
          await report.scrollIntoViewIfNeeded();
          const overflow = await report.evaluate((element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          }));
          expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
        }
        await page.screenshot({
          path: resolve(screenshots, `${browser.name}-popup-${fixture}-150.png`),
        });
        if (fixture === 'offline')
          await expect(page.locator('.yanyi-button--primary')).toBeDisabled();
        if (fixture === 'pdf') await expect(page.locator('.pdf-callout')).toBeVisible();
        await page.close();
      }

      const preferences = await context.newPage();
      await preferences.setViewportSize({ width: 380, height: 640 });
      await preferences.goto(`chrome-extension://${browser.id}/popup.html?fixture=connected`);
      await preferences.getByRole('button', { name: '选择翻译语言' }).click();
      await preferences.getByLabel('源语言').selectOption('auto');
      await preferences.getByLabel('目标语言').selectOption('ja');
      await expect(preferences.getByLabel('源语言')).toHaveValue('auto');
      await expect(preferences.getByLabel('目标语言')).toHaveValue('ja');
      await preferences.screenshot({
        path: resolve(screenshots, `${browser.name}-popup-language-picker-150.png`),
      });
      await preferences.getByRole('button', { name: '选择翻译语言' }).click();
      await preferences.getByRole('button', { name: '人工智能' }).click();
      await preferences.getByRole('button', { name: '添加技术标签' }).click();
      await preferences.getByRole('button', { name: 'Transformer' }).click();
      await expect(preferences.getByRole('button', { name: '选择翻译语言' })).toContainText(
        '自动检测 → 日本語',
      );
      await expect(preferences.getByRole('button', { name: '人工智能' })).toHaveClass(
        /is-selected/u,
      );
      await expect(preferences.getByRole('button', { name: '移除 Transformer' })).toBeVisible();
      await preferences.locator('.domain-section').scrollIntoViewIfNeeded();
      await preferences.screenshot({
        path: resolve(screenshots, `${browser.name}-popup-preferences-150.png`),
      });

      // Desktop management surfaces must not occupy the popup. Glossary,
      // workspaces, history and full settings live in the desktop app; the popup
      // keeps only the immediate reading flow plus an overflow menu.
      await expect(preferences.locator('.secondary-nav')).toHaveCount(0);
      for (const label of ['术语库', '工作区', '历史']) {
        await expect(preferences.getByRole('button', { name: label })).toHaveCount(0);
      }
      await expect(preferences.getByRole('button', { name: '翻译此页面' })).toBeVisible();
      await expect(preferences.getByRole('button', { name: '打开侧边栏' })).toBeVisible();
      await preferences.getByRole('button', { name: '更多选项' }).click();
      await expect(preferences.getByRole('button', { name: '打开研译管理端' })).toBeVisible();
      await expect(preferences.getByRole('button', { name: '诊断' })).toBeVisible();
      // Every visible control has a real behaviour; none is a placeholder.
      const popupOverflow = await preferences.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(popupOverflow.scrollWidth).toBeLessThanOrEqual(popupOverflow.clientWidth);
      await preferences.screenshot({
        path: resolve(screenshots, `${browser.name}-popup-overflow-menu-150.png`),
      });
      await preferences.close();

      const sidePanel = await context.newPage();
      await sidePanel.setViewportSize({ width: 320, height: 700 });
      await sidePanel.goto(`chrome-extension://${browser.id}/sidepanel.html`);
      await expect(sidePanel.locator('.sidepanel-shell')).toBeVisible();
      await expect(sidePanel.getByRole('combobox', { name: '模型供应商' })).toBeVisible();
      await expect(sidePanel.getByRole('combobox', { name: '会话模型' })).toBeVisible();
      await expect(sidePanel.getByRole('combobox', { name: '思考模式' })).toBeVisible();
      await expect(sidePanel.getByRole('combobox', { name: '回答知识范围' })).toBeVisible();
      await expect(sidePanel.getByRole('textbox', { name: '继续询问' })).toBeVisible();
      await expect(sidePanel.getByText('模型回答可能有误，请核对页面依据。')).toBeVisible();
      const sidePanelOverflow = await sidePanel.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(sidePanelOverflow.scrollWidth).toBeLessThanOrEqual(sidePanelOverflow.clientWidth);
      await sidePanel.screenshot({
        path: resolve(screenshots, `${browser.name}-sidepanel-assistant-150.png`),
      });
      const options = await context.newPage();
      await options.goto(`chrome-extension://${browser.id}/options.html`);
      await expect(options.locator('body')).toContainText('扩展设置与诊断');
      const pdfReader = await context.newPage();
      await pdfReader.goto(`chrome-extension://${browser.id}/pdf-reader.html`);
      await expect(pdfReader.getByText('PDF 双语阅读器')).toBeVisible();
    } finally {
      await context.close();
    }
  }
});

test('Edge scan report remains readable at 420 px and 125% scale', async () => {
  const context = await launchExtension('edge-mv3-test', 'scan-report-125', 1.25);
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 420, height: 640 });
    await page.goto(`chrome-extension://${edgeExtensionId}/popup.html?fixture=scan-report`);
    const report = page.locator('details.scan-report');
    await report.locator('summary').click();
    await expect(report.locator('dt')).toHaveCount(12);
    await expect(report).toContainText('正在处理第 3 批，完成后自动继续。');
    await report.scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.popup-shell');
      const footer = document.querySelector<HTMLElement>('.popup-footer');
      const scanReport = document.querySelector<HTMLElement>('.scan-report');
      return {
        shellWidth: shell?.getBoundingClientRect().width,
        footerBottom: footer?.getBoundingClientRect().bottom,
        reportClientWidth: scanReport?.clientWidth,
        reportScrollWidth: scanReport?.scrollWidth,
        viewportHeight: innerHeight,
      };
    });
    expect(layout.shellWidth).toBe(380);
    expect(layout.footerBottom).toBeLessThanOrEqual(layout.viewportHeight + 0.5);
    expect(layout.reportScrollWidth).toBeDefined();
    expect(layout.reportClientWidth).toBeDefined();
    expect(layout.reportScrollWidth!).toBeLessThanOrEqual(layout.reportClientWidth!);
    await page.screenshot({ path: resolve(screenshots, 'edge-popup-scan-report-125-420.png') });
  } finally {
    await context.close();
  }
});

test('Edge selection popover exposes the shared chat controls inside Shadow DOM', async () => {
  const fixture = await startCoverageFixture();
  const context = await launchExtension('edge-mv3-test', 'selection-popover-150', 1.5);
  try {
    const contentPage = await context.newPage();
    await contentPage.goto(fixture.url);
    const bridge = await context.newPage();
    await bridge.goto(`chrome-extension://${edgeExtensionId}/popup.html?fixture=connected`);
    const targetTabId = await bridge.evaluate(async (targetUrl) => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: { tabs: { query: (query: object) => Promise<{ id?: number; url?: string }[]> } };
        }
      ).chrome;
      return (await extensionChrome.tabs.query({})).find(({ url }) => url === targetUrl)?.id;
    }, fixture.url);
    if (targetTabId === undefined) throw new Error('Selection fixture tab is missing an id');
    await bridge.evaluate(async (tabId) => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: {
            scripting: {
              executeScript: (input: {
                target: { tabId: number };
                files: string[];
              }) => Promise<unknown>;
            };
          };
        }
      ).chrome;
      await extensionChrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/content.js'],
      });
    }, targetTabId);
    await contentPage.evaluate(() => {
      const target = document.querySelector('#details')?.firstChild;
      if (!(target instanceof Text)) throw new Error('Selection TextNode is missing');
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const openResult = await bridge.evaluate(async (tabId) => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: { tabs: { sendMessage: (id: number, message: object) => Promise<unknown> } };
        }
      ).chrome;
      return extensionChrome.tabs.sendMessage(tabId, {
        type: 'yanyi.selection.popover.open',
        context: { intent: 'follow_up', tabId },
      });
    }, targetTabId);
    expect(openResult).toMatchObject({ accepted: true });
    const dialog = contentPage.getByRole('dialog', { name: '研译选区助手' });
    await expect(dialog).toBeVisible();
    await expect(contentPage.getByRole('combobox', { name: '模型供应商' })).toBeVisible();
    await expect(contentPage.getByRole('combobox', { name: '会话模型' })).toBeVisible();
    await expect(contentPage.getByRole('combobox', { name: '思考模式' })).toBeVisible();
    await expect(contentPage.getByRole('combobox', { name: '回答知识范围' })).toBeVisible();
    await expect(contentPage.getByRole('textbox', { name: '继续询问' })).toBeFocused();
    // "解释" is a shortcut intent inside 询问研译, not a separate feature.
    await expect(contentPage.getByRole('button', { name: '解释这段' })).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(8);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(372);
    expect(bounds!.y).toBeGreaterThanOrEqual(8);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(632);
    await contentPage.screenshot({ path: resolve(screenshots, 'edge-selection-popover-150.png') });

    // Widen the page so the drag has somewhere to go: in a 380 px viewport the
    // popover already fills the available width and is correctly clamped.
    await contentPage.setViewportSize({ width: 1000, height: 800 });
    await expect(dialog).toHaveAttribute('data-position-mode', 'anchored');
    const anchored = await dialog.boundingBox();
    expect(anchored).not.toBeNull();

    const handle = dialog.locator('[data-drag-handle="true"]');
    const handleBounds = await handle.boundingBox();
    expect(handleBounds).not.toBeNull();
    await contentPage.mouse.move(
      handleBounds!.x + handleBounds!.width / 2,
      handleBounds!.y + handleBounds!.height / 2,
    );
    await contentPage.mouse.down();
    await contentPage.mouse.move(
      handleBounds!.x + handleBounds!.width / 2 + 90,
      handleBounds!.y + handleBounds!.height / 2 + 60,
      { steps: 8 },
    );
    await contentPage.mouse.up();
    await expect(dialog).toHaveAttribute('data-position-mode', 'manual');
    const dragged = await dialog.boundingBox();
    expect(dragged).not.toBeNull();
    expect(dragged!.x).toBeGreaterThan(anchored!.x);
    expect(dragged!.y).toBeGreaterThan(anchored!.y);
    // Never leaves the viewport.
    expect(dragged!.x).toBeGreaterThanOrEqual(8);
    expect(dragged!.x + dragged!.width).toBeLessThanOrEqual(1000);
    expect(dragged!.y + dragged!.height).toBeLessThanOrEqual(800);
    // The composer still works after a drag, so the handle does not steal focus.
    const composer = contentPage.getByRole('textbox', { name: '继续询问' });
    await composer.fill('拖动后仍可输入');
    await expect(composer).toHaveValue('拖动后仍可输入');
    // Scrolling no longer moves a manually placed popover.
    await contentPage.mouse.wheel(0, 200);
    const afterScroll = await dialog.boundingBox();
    expect(afterScroll!.x).toBeCloseTo(dragged!.x, 0);
    expect(afterScroll!.y).toBeCloseTo(dragged!.y, 0);
    await contentPage.screenshot({
      path: resolve(screenshots, 'edge-selection-popover-dragged.png'),
    });

    // Restoring returns the popover to the selection anchor.
    await contentPage.getByRole('button', { name: '恢复自动定位' }).click();
    await expect(dialog).toHaveAttribute('data-position-mode', 'anchored');
    const restored = await dialog.boundingBox();
    expect(restored!.x).not.toBe(dragged!.x);

    await contentPage.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  } finally {
    await context.close();
    await new Promise<void>((resolveClose) => fixture.server.close(() => resolveClose()));
  }
});

test('Edge scanner queues visible UI TextNodes and reports every excluded node', async () => {
  const fixture = await startCoverageFixture();
  const context = await launchExtension('edge-mv3-test', 'text-node-coverage', 1.25);
  try {
    const contentPage = await context.newPage();
    await contentPage.goto(fixture.url);
    await expect(
      contentPage.getByRole('heading', { name: 'GPU acceleration guide' }),
    ).toBeVisible();

    const bridge = await context.newPage();
    await bridge.goto(`chrome-extension://${edgeExtensionId}/popup.html?fixture=connected`);
    const targetTabId = await bridge.evaluate(async (targetUrl) => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: { tabs: { query: (query: object) => Promise<{ id?: number; url?: string }[]> } };
        }
      ).chrome;
      return (await extensionChrome.tabs.query({})).find(({ url }) => url === targetUrl)?.id;
    }, fixture.url);
    if (targetTabId === undefined) throw new Error('Coverage fixture tab is missing an id');

    await bridge.evaluate(async (tabId) => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: {
            scripting: {
              executeScript: (input: {
                target: { tabId: number };
                files: string[];
              }) => Promise<unknown>;
            };
          };
        }
      ).chrome;
      await extensionChrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/content.js'],
      });
    }, targetTabId);

    const result = await bridge.evaluate(async (tabId) => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: {
            tabs: { sendMessage: (id: number, message: object) => Promise<unknown> };
          };
        }
      ).chrome;
      return extensionChrome.tabs.sendMessage(tabId, {
        type: 'yanyi.translation.scan.start',
        policy: { translateTables: true },
      });
    }, targetTabId);
    const scan = result as {
      segments: {
        segmentId: string;
        sourceText: string;
        sourceHash: string;
        domRole?: string;
      }[];
      diagnostics: {
        discoveredVisible: number;
        eligible: number;
        protected: number;
        ignored: number;
        queued: number;
        unsupported: number;
      };
      untranslated: { reason: string }[];
    };
    const queuedText = scan.segments.map(({ sourceText }) => sourceText).join('\n');
    expect(queuedText).toContain('Copy command');
    expect(queuedText).toContain('Tensor cores accelerate');
    expect(queuedText).toContain('Training throughput');
    expect(queuedText).toContain('Open shadow DOM documentation label');
    expect(queuedText).toContain('Same-origin frame guidance');
    expect(queuedText).not.toContain('This hidden sentence');
    expect(queuedText).not.toContain('Editable text must stay untouched');
    expect(scan.diagnostics.queued / scan.diagnostics.eligible).toBeGreaterThanOrEqual(0.95);
    expect(scan.diagnostics.protected + scan.diagnostics.ignored).toBeGreaterThan(0);
    expect(
      scan.diagnostics.queued +
        scan.diagnostics.protected +
        scan.diagnostics.ignored +
        scan.diagnostics.unsupported,
    ).toBeGreaterThanOrEqual(scan.diagnostics.discoveredVisible);

    await expect
      .poll(() =>
        contentPage.evaluate(
          () =>
            '__yanyiOpenShadowHook' in
            (window as typeof window & { __yanyiOpenShadowHook?: unknown }),
        ),
      )
      .toBe(true);
    await bridge.evaluate(() => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: {
            runtime: {
              onMessage: {
                addListener: (listener: (message: unknown) => void) => void;
              };
            };
          };
        }
      ).chrome;
      const auditWindow = window as typeof window & { __yanyiDynamicScans?: unknown[] };
      auditWindow.__yanyiDynamicScans = [];
      extensionChrome.runtime.onMessage.addListener((message: unknown) => {
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'yanyi.translation.scan.updated'
        )
          auditWindow.__yanyiDynamicScans?.push(message);
      });
    });
    await contentPage.evaluate(() => {
      const host = document.querySelector('#late-shadow-host');
      if (!(host instanceof HTMLElement)) throw new Error('Late shadow host is missing');
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = '<button>Late MAIN-world shadow action</button>';
    });
    await expect
      .poll(() =>
        bridge.evaluate(() => {
          const updates = (
            window as typeof window & {
              __yanyiDynamicScans?: { payload?: { segments?: { sourceText?: string }[] } }[];
            }
          ).__yanyiDynamicScans;
          return updates?.some(({ payload }) =>
            payload?.segments?.some(({ sourceText }) =>
              sourceText?.includes('Late MAIN-world shadow action'),
            ),
          );
        }),
      )
      .toBe(true);

    const buttonSegment = scan.segments.find(({ sourceText }) =>
      sourceText.includes('Copy command'),
    );
    if (buttonSegment === undefined) throw new Error('Button TextNode was not queued');
    const commit = await bridge.evaluate(
      async ({ tabId, segment }) => {
        const extensionChrome = (
          globalThis as unknown as {
            chrome: {
              tabs: { sendMessage: (id: number, message: object) => Promise<unknown> };
            };
          }
        ).chrome;
        return extensionChrome.tabs.sendMessage(tabId, {
          type: 'yanyi.translation.segment.completed',
          mode: 'replace',
          payload: {
            taskId: 'e2e-renderer',
            segmentId: segment.segmentId,
            sourceHash: segment.sourceHash,
            translation: '复制命令',
          },
        });
      },
      { tabId: targetTabId, segment: buttonSegment },
    );
    expect(commit).toMatchObject({ rendered: true });
    const button = contentPage.locator('#copy-button');
    await expect(button).toHaveText('复制命令');
    await expect(button).toHaveAttribute('data-action', 'copy');
    // The page toolbar intentionally floats above the top-right viewport; invoke the
    // preserved page control directly so this assertion measures listener identity,
    // not Playwright actionability beneath the extension's separate overlay.
    await button.evaluate((element: HTMLButtonElement) => element.click());
    await expect(button).toHaveAttribute('data-clicks', '1');

    await bridge.evaluate(async (tabId) => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: { tabs: { sendMessage: (id: number, message: object) => Promise<unknown> } };
        }
      ).chrome;
      await extensionChrome.tabs.sendMessage(tabId, {
        type: 'yanyi.translation.mode.set',
        mode: 'below',
      });
    }, targetTabId);
    await expect(button).toContainText('Copy command');
    const translation = contentPage.locator('[data-yanyi-translation-for]').filter({
      hasText: '复制命令',
    });
    await expect(translation).toHaveCount(1);
    const appearance = await translation.evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, color: style.color };
    });
    const buttonColor = await button.evaluate((element) => getComputedStyle(element).color);
    expect(appearance.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(appearance.color).toBe(buttonColor);

    await bridge.evaluate(async (tabId) => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: { tabs: { sendMessage: (id: number, message: object) => Promise<unknown> } };
        }
      ).chrome;
      await extensionChrome.tabs.sendMessage(tabId, { type: 'yanyi.translation.restore' });
    }, targetTabId);
    await expect(button).toHaveText('Copy command');
    await expect(contentPage.locator('[data-yanyi-translation-for]')).toHaveCount(0);
  } finally {
    await context.close();
    await new Promise<void>((resolveClose) => fixture.server.close(() => resolveClose()));
  }
});

test('Edge translates and restores an HTTP page through the native pipeline', async () => {
  test.skip(
    process.env.YANYI_E2E_NATIVE_TRANSLATION !== '1',
    'requires the registered Native Host and explicit integration opt-in',
  );
  const fixture = await startTranslationFixture();
  const context = await launchExtension(
    'edge-mv3-test',
    'native-translation',
    1,
    edgeExecutable,
    isolatedNativeEnvironment('native-translation', {
      YANYI_MOCK_SSE_URL: fixture.providerUrl,
    }),
  );
  try {
    const contentPage = await context.newPage();
    await contentPage.goto(fixture.url);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${edgeExtensionId}/popup.html`);
    await expect(popup.locator('.connection-card--connected')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() =>
        contentPage.evaluate(() => document.documentElement.dataset.yanyiContentReady === 'true'),
      )
      .toBe(false);
    await contentPage.bringToFront();
    const targetTabId = await popup.evaluate(async () => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: { tabs: { query: (query: object) => Promise<{ id?: number }[]> } };
        }
      ).chrome;
      const [tab] = await extensionChrome.tabs.query({ active: true, currentWindow: true });
      return tab?.id;
    });
    if (targetTabId === undefined) throw new Error('Active fixture tab is missing an id');
    const preferenceResponse = await popup.evaluate((tabId) => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage: (message: object) => Promise<unknown> } };
        }
      ).chrome;
      return extensionChrome.runtime.sendMessage({
        type: 'yanyi.translation.preferences.update',
        tabId,
        patch: {
          sourceLanguage: 'auto',
          targetLanguage: 'ja',
          mode: 'below',
          primaryDomain: '人工智能与机器学习',
          tags: ['PyTorch', 'Transformer'],
          modelProfileId: 'precise',
        },
      });
    }, targetTabId);
    expect(preferenceResponse).toMatchObject({
      accepted: true,
      snapshot: {
        sourceLanguage: 'auto',
        targetLanguage: 'ja',
        primaryDomain: '人工智能与机器学习',
        tags: ['PyTorch', 'Transformer'],
        modelProfileId: 'precise',
      },
    });
    await expect
      .poll(() => popup.getByRole('button', { name: '选择翻译语言' }).textContent())
      .toContain('日本語');
    await popup
      .getByRole('button', { name: '翻译此页面' })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect
      .poll(() =>
        contentPage.evaluate(() => document.documentElement.dataset.yanyiContentReady === 'true'),
      )
      .toBe(true);
    const inspection = await popup.evaluate((tabId) => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: { tabs: { sendMessage: (id: number, message: object) => Promise<unknown> } };
        }
      ).chrome;
      return extensionChrome.tabs.sendMessage(tabId, { type: 'yanyi.page.inspect' });
    }, targetTabId);
    expect(inspection).toMatchObject({ url: fixture.url });
    await expect(contentPage.locator('[data-yanyi-owned="toolbar"]')).toHaveCount(1, {
      timeout: 10_000,
    });
    const translation = contentPage.locator('[data-yanyi-owned="translation"]');
    await expect(translation.first()).toContainText('フィードバック制御器', { timeout: 15_000 });
    const systemPrompts = fixture.providerRequests.flatMap((request) => {
      if (typeof request !== 'object' || request === null || !('messages' in request)) return [];
      const messages = (request as { messages?: { role?: string; content?: string }[] }).messages;
      return (
        messages?.filter(({ role }) => role === 'system').map(({ content }) => content ?? '') ?? []
      );
    });
    expect(systemPrompts.length).toBeGreaterThan(0);
    expect(systemPrompts.join('\n')).toContain('"sourceLanguage":"auto"');
    expect(systemPrompts.join('\n')).toContain('"targetLanguage":"ja"');
    expect(systemPrompts.join('\n')).toContain('"domainId":"domain-ai-ml"');
    expect(systemPrompts.join('\n')).toContain('PyTorch');
    expect(systemPrompts.join('\n')).toContain('Transformer');
    const firstPageJobId = await popup.evaluate(async () => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: {
            storage: { session: { get: (key: string) => Promise<Record<string, unknown>> } };
          };
        }
      ).chrome;
      const key = 'yanyi.translation.active-route.v1';
      const stored = await extensionChrome.storage.session.get(key);
      return (stored[key] as { pageJobId?: string } | undefined)?.pageJobId;
    });
    const requestsBeforeDynamicUpdate = fixture.providerRequests.length;
    const dynamicMarker = String(Date.now()).replace(/\d/gu, (digit) =>
      String.fromCharCode(97 + Number(digit)),
    );
    await contentPage.evaluate((marker) => {
      const dynamic = document.createElement('p');
      dynamic.id = 'dynamic-after-final-batch';
      dynamic.textContent = `A late telemetry paragraph ${marker} appears after the first translation job has fully completed.`;
      document.querySelector('main')?.append(dynamic);
    }, dynamicMarker);
    await expect
      .poll(() => fixture.providerRequests.length, { timeout: 15_000 })
      .toBeGreaterThan(requestsBeforeDynamicUpdate);
    await expect(
      contentPage.locator('#dynamic-after-final-batch > [data-yanyi-owned="translation"]'),
    ).toContainText('フィードバック制御器', { timeout: 15_000 });
    const deltaCursor = await popup.evaluate(async () => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: {
            storage: { session: { get: (key: string) => Promise<Record<string, unknown>> } };
          };
        }
      ).chrome;
      const key = 'yanyi.translation.active-route.v1';
      const stored = await extensionChrome.storage.session.get(key);
      return stored[key] as
        { pageJobId?: string; batchIndex?: number; finalBatchSent?: boolean } | undefined;
    });
    expect(deltaCursor?.pageJobId).not.toBe(firstPageJobId);
    expect(deltaCursor).toMatchObject({ batchIndex: 0, finalBatchSent: true });
    await expect(popup.getByRole('button', { name: '还原原文' })).toBeVisible({ timeout: 10_000 });
    await popup.getByRole('button', { name: '还原原文' }).click();
    await expect(translation).toHaveCount(0);
    await expect(contentPage.locator('#source')).toBeVisible();
  } finally {
    await context.close();
    await new Promise<void>((resolveClose) => fixture.server.close(() => resolveClose()));
  }
});

test('Edge rejects stale Native completions and retranslates changed TextNodes', async () => {
  test.skip(
    process.env.YANYI_E2E_NATIVE_TRANSLATION !== '1',
    'requires the registered Native Host and explicit integration opt-in',
  );
  const staleTranslation = '旧请求返回的反馈控制系统译文绝不能写入已经变化的页面。';
  const currentTranslation = '更新后的反馈控制系统文本已经重新翻译，并与当前页面快照保持一致。';
  const fixture = await startTranslationFixture(1_000, (sourceText, defaultTranslation) => {
    if (sourceText.includes('Changed after scan.')) return currentTranslation;
    return sourceText.includes('sourceText') ? staleTranslation : defaultTranslation;
  });
  const context = await launchExtension(
    'edge-mv3-test',
    'native-dom-ack-rejected',
    1,
    edgeExecutable,
    isolatedNativeEnvironment('native-dom-ack-rejected', {
      YANYI_MOCK_SSE_URL: fixture.providerUrl,
    }),
  );
  try {
    const contentPage = await context.newPage();
    await contentPage.goto(fixture.url);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${edgeExtensionId}/popup.html`);
    await expect(popup.locator('.connection-card--connected')).toBeVisible({ timeout: 15_000 });
    await contentPage.bringToFront();
    const targetTabId = await popup.evaluate(async () => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: { tabs: { query: (query: object) => Promise<{ id?: number }[]> } };
        }
      ).chrome;
      const [tab] = await extensionChrome.tabs.query({ active: true, currentWindow: true });
      return tab?.id;
    });
    if (targetTabId === undefined) throw new Error('Active fixture tab is missing an id');
    await popup.evaluate(
      ({ tabId, uniqueTag }) => {
        const extensionChrome = (
          globalThis as unknown as {
            chrome: { runtime: { sendMessage: (message: object) => Promise<unknown> } };
          }
        ).chrome;
        return extensionChrome.runtime.sendMessage({
          type: 'yanyi.translation.preferences.update',
          tabId,
          patch: { tags: [uniqueTag] },
        });
      },
      { tabId: targetTabId, uniqueTag: `Yanyi-dom-ack-${String(Date.now())}` },
    );

    await popup
      .getByRole('button', { name: '翻译此页面' })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect
      .poll(() => fixture.providerRequests.length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    const requestsBeforeMutation = fixture.providerRequests.length;
    await contentPage.locator('h1, #source').evaluateAll((elements) => {
      for (const element of elements) {
        const sourceNode = element.firstChild;
        if (sourceNode?.nodeType !== Node.TEXT_NODE) throw new Error('Tracked TextNode is missing');
        sourceNode.nodeValue = `${sourceNode.nodeValue ?? ''} Changed after scan.`;
      }
    });

    await expect
      .poll(
        () =>
          popup.evaluate(async (tabId) => {
            const extensionChrome = (
              globalThis as unknown as {
                chrome: { runtime: { sendMessage: (message: object) => Promise<unknown> } };
              }
            ).chrome;
            return extensionChrome.runtime.sendMessage({ type: 'yanyi.status.get', tabId });
          }, targetTabId),
        { timeout: 20_000 },
      )
      .toMatchObject({
        snapshot: {
          page: 'translated',
          completedSegments: 2,
        },
      });
    expect(fixture.providerRequests.length).toBeGreaterThan(requestsBeforeMutation);
    await expect(contentPage.locator('[data-yanyi-owned="translation"]')).toHaveCount(2);
    await expect(contentPage.locator('[data-yanyi-owned="translation"]').first()).toContainText(
      currentTranslation,
    );
    await expect(contentPage.locator('body')).not.toContainText(staleTranslation);
    await expect(contentPage.locator('#source')).toContainText('Changed after scan.');

    const persistedRoute = await popup.evaluate(async () => {
      const extensionChrome = (
        globalThis as unknown as {
          chrome: {
            storage: { session: { get: (key: string) => Promise<Record<string, unknown>> } };
          };
        }
      ).chrome;
      const key = 'yanyi.translation.active-route.v1';
      const stored = await extensionChrome.storage.session.get(key);
      return stored[key];
    });
    expect(persistedRoute).toMatchObject({
      task: { state: 'completed', completed: 2 },
    });
    const cachedTranslations = Object.values(
      (persistedRoute as { completedByHash?: Record<string, string> }).completedByHash ?? {},
    );
    expect(cachedTranslations).toContain(currentTranslation);
    expect(cachedTranslations).not.toContain(staleTranslation);
  } finally {
    await context.close();
    await new Promise<void>((resolveClose) => fixture.server.close(() => resolveClose()));
  }
});

for (const liveSite of [
  {
    name: 'GitHub',
    url: 'https://github.com/pytorch/pytorch',
    hostname: 'github.com',
    readySelector: 'main',
    tag: 'GitHub',
  },
  {
    name: 'PyTorch documentation',
    url: 'https://docs.pytorch.org/docs/stable/index.html',
    hostname: 'docs.pytorch.org',
    readySelector: 'main',
    tag: 'PyTorch',
  },
] as const) {
  test(`Edge injects and starts translation on the live ${liveSite.name} page`, async () => {
    test.skip(
      process.env.YANYI_E2E_LIVE_SITES !== '1',
      'requires network access and the registered Native Host',
    );
    const fixture = await startTranslationFixture();
    const context = await launchExtension(
      'edge-mv3-test',
      `live-${liveSite.tag.toLowerCase()}`,
      1,
      edgeExecutable,
      isolatedNativeEnvironment(`live-${liveSite.tag.toLowerCase()}`, {
        YANYI_MOCK_SSE_URL: fixture.providerUrl,
      }),
    );
    try {
      const contentPage = await context.newPage();
      const response = await contentPage.goto(liveSite.url, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      expect(response?.status(), `${liveSite.name} did not return an HTTP response`).toBeLessThan(
        400,
      );
      await expect(contentPage.locator(liveSite.readySelector).first()).toBeVisible({
        timeout: 20_000,
      });

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${edgeExtensionId}/popup.html`);
      await expect(popup.locator('.connection-card--connected')).toBeVisible({ timeout: 15_000 });
      await contentPage.bringToFront();
      const targetTabId = await popup.evaluate(async () => {
        const extensionChrome = (
          globalThis as unknown as {
            chrome: { tabs: { query: (query: object) => Promise<{ id?: number }[]> } };
          }
        ).chrome;
        const [tab] = await extensionChrome.tabs.query({ active: true, currentWindow: true });
        return tab?.id;
      });
      if (targetTabId === undefined) throw new Error(`${liveSite.name} tab is missing an id`);

      const uniqueTag = `Yanyi-live-${liveSite.tag}-${String(Date.now())}`;
      const preferenceResponse = await popup.evaluate(
        ({ tabId, siteTag, runTag }) => {
          const extensionChrome = (
            globalThis as unknown as {
              chrome: { runtime: { sendMessage: (message: object) => Promise<unknown> } };
            }
          ).chrome;
          return extensionChrome.runtime.sendMessage({
            type: 'yanyi.translation.preferences.update',
            tabId,
            patch: {
              sourceLanguage: 'auto',
              targetLanguage: 'ja',
              mode: 'below',
              primaryDomain: '人工智能与机器学习',
              tags: [siteTag, runTag],
              modelProfileId: 'precise',
            },
          });
        },
        { tabId: targetTabId, siteTag: liveSite.tag, runTag: uniqueTag },
      );
      expect(preferenceResponse).toMatchObject({
        accepted: true,
        snapshot: {
          sourceLanguage: 'auto',
          targetLanguage: 'ja',
          primaryDomain: '人工智能与机器学习',
          tags: [liveSite.tag, uniqueTag],
          modelProfileId: 'precise',
        },
      });

      await popup
        .getByRole('button', { name: '翻译此页面' })
        .evaluate((button: HTMLButtonElement) => button.click());
      await expect
        .poll(
          () =>
            contentPage.evaluate(
              () => document.documentElement.dataset.yanyiContentReady === 'true',
            ),
          { timeout: 15_000 },
        )
        .toBe(true);
      const inspection = await popup.evaluate((tabId) => {
        const extensionChrome = (
          globalThis as unknown as {
            chrome: { tabs: { sendMessage: (id: number, message: object) => Promise<unknown> } };
          }
        ).chrome;
        return extensionChrome.tabs.sendMessage(tabId, { type: 'yanyi.page.inspect' });
      }, targetTabId);
      expect(inspection).toMatchObject({ url: expect.stringContaining(liveSite.hostname) });
      await expect(contentPage.locator('[data-yanyi-owned="toolbar"]')).toHaveCount(1, {
        timeout: 15_000,
      });
      await expect(contentPage.locator('[data-yanyi-owned="translation"]').first()).toContainText(
        'フィードバック制御器',
        { timeout: 30_000 },
      );
      expect(fixture.providerRequests.length).toBeGreaterThan(0);

      const restoreResponse = await popup.evaluate((tabId) => {
        const extensionChrome = (
          globalThis as unknown as {
            chrome: { runtime: { sendMessage: (message: object) => Promise<unknown> } };
          }
        ).chrome;
        return extensionChrome.runtime.sendMessage({
          type: 'yanyi.translation.restore',
          tabId,
        });
      }, targetTabId);
      expect(restoreResponse).toMatchObject({ accepted: true });
      await expect(contentPage.locator('[data-yanyi-owned="translation"]')).toHaveCount(0);
    } finally {
      await context.close();
      await new Promise<void>((resolveClose) => fixture.server.close(() => resolveClose()));
    }
  });
}

test('Chrome fixture build renders core states and pages', () => {
  test.skip(
    true,
    'Chrome 137+ removed --load-extension from branded Chrome; use Chrome for Testing or manual developer-mode loading.',
  );
  void chromeExtensionId;
  void chromeExecutable;
});
