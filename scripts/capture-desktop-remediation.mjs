import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopDirectory = path.join(workspace, 'apps', 'desktop');
const screenshotDirectory = path.join(workspace, 'docs', 'screenshots');
const serverUrl = 'http://127.0.0.1:4178';
const viteEntry = fileURLToPath(import.meta.resolve('vite'));
const viteModule = path.resolve(path.dirname(viteEntry), '..', '..', 'bin', 'vite.js');

const conversations = [
  {
    id: '4af036a7-3095-48e2-bf5d-e0d4ec4b8142',
    title: 'Transformer 架构与注意力机制',
    status: 'active',
    lastMessageAt: '2026-08-04T11:08:00.000Z',
    knowledgeMode: 'hybrid',
    currentModelId: 'deepseek-v4-pro',
    createdAt: '2026-08-04T10:52:00.000Z',
    updatedAt: '2026-08-04T11:08:00.000Z',
    lastMessage: '多头注意力让模型在不同表示子空间中并行关注互补关系。',
  },
  {
    id: '8ae05f38-6156-4a9f-951d-9ec8a433d8e8',
    title: 'PyTorch CUDA 内存分析',
    status: 'active',
    lastMessageAt: '2026-08-03T14:30:00.000Z',
    knowledgeMode: 'page_only',
    currentModelId: 'deepseek-v4-pro',
    createdAt: '2026-08-03T14:15:00.000Z',
    updatedAt: '2026-08-03T14:30:00.000Z',
    lastMessage: '页面证据只说明了 reserved memory，并未给出完整进程显存。',
  },
];

const messages = [
  {
    id: 'message-1',
    conversationId: conversations[0].id,
    role: 'user',
    content: '为什么需要多头注意力，而不是只使用一个注意力头？',
    contentTruncated: false,
    contentFormat: 'plain_text',
    generationStatus: 'completed',
    thinkingEnabled: false,
    sequence: 0,
    createdAt: '2026-08-04T11:02:00.000Z',
    updatedAt: '2026-08-04T11:02:00.000Z',
  },
  {
    id: 'message-2',
    conversationId: conversations[0].id,
    parentMessageId: 'message-1',
    role: 'assistant',
    content:
      '单个注意力头只能在一套投影空间中计算关系。多头注意力将查询、键和值投影到多个子空间，使不同头可以分别捕捉局部依赖、长距离关系与语义对齐，最后再合并这些互补表示。\n\n页面上下文支持这一结构性解释；“不同子空间带来互补归纳偏置”属于通用知识补充。',
    contentTruncated: false,
    intent: 'explain',
    contentFormat: 'markdown',
    generationStatus: 'completed',
    modelId: 'deepseek-v4-pro',
    thinkingEnabled: true,
    reasoningEffort: 'high',
    sequence: 1,
    createdAt: '2026-08-04T11:08:00.000Z',
    updatedAt: '2026-08-04T11:08:00.000Z',
  },
];

const presets = [
  ['whole_page_translation', '整页翻译', 'deepseek-v4-flash', false, undefined],
  ['selected_precise_translation', '选中精确翻译', 'deepseek-v4-pro', false, undefined],
  ['explanation', '解释', 'deepseek-v4-pro', true, 'high'],
  ['deep_follow_up', '深度追问', 'deepseek-v4-pro', true, 'max'],
].map(([task, label, modelId, thinkingEnabled, reasoningEffort], index) => ({
  id: `preset-${String(index)}`,
  task,
  label,
  modelId,
  thinkingEnabled,
  reasoningEffort,
  maxOutputTokens: 8192,
  timeoutMs: 90000,
  streaming: true,
  isBuiltin: true,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
}));

const models = [
  {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    owner: 'deepseek',
    availability: 'available',
    capabilityStatus: 'verified',
    supportsThinking: true,
    reasoningEffortsJson: '["high","max"]',
    supportsStreaming: true,
    supportsJsonOutput: true,
    supportsTools: true,
    metadataJson: '{"source":"models_endpoint"}',
    lastSeenAt: '2026-08-04T11:10:00.000Z',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T11:10:00.000Z',
  },
  {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-pro',
    owner: 'deepseek',
    availability: 'available',
    capabilityStatus: 'verified',
    supportsThinking: true,
    reasoningEffortsJson: '["high","max"]',
    supportsStreaming: true,
    supportsJsonOutput: true,
    supportsTools: true,
    metadataJson: '{"source":"models_endpoint"}',
    lastSeenAt: '2026-08-04T11:10:00.000Z',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T11:10:00.000Z',
  },
];

// Global memory fixtures. Mirrors the shape of `global_memories` so the capture
// exercises the real editor, list and import review markup.
const globalMemories = [
  {
    id: 'memory-profile',
    type: 'profile',
    title: '研究方向',
    content: '我是飞行器设计与工程专业本科生，研究方向是机器人控制与强化学习。',
    enabled: true,
    pinned: true,
    priority: 20,
    sourceType: 'manual',
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-05T09:00:00.000Z',
    lastUsedAt: '2026-08-08T10:12:00.000Z',
    usageCount: 24,
  },
  {
    id: 'memory-style',
    type: 'response_style',
    title: '回答风格',
    content: '技术回答优先解释原理，再给实施步骤；先给结论。',
    enabled: true,
    pinned: true,
    priority: 15,
    sourceType: 'manual',
    createdAt: '2026-08-01T09:05:00.000Z',
    updatedAt: '2026-08-05T09:05:00.000Z',
    lastUsedAt: '2026-08-08T10:12:00.000Z',
    usageCount: 31,
  },
  {
    id: 'memory-background',
    type: 'domain_background',
    title: '',
    content: '熟悉 Python、ROS 2、PX4 和 Isaac Lab。',
    enabled: true,
    pinned: false,
    priority: 5,
    sourceType: 'import',
    sourceId: 'job-1',
    createdAt: '2026-08-02T09:00:00.000Z',
    updatedAt: '2026-08-02T09:00:00.000Z',
    lastUsedAt: '2026-08-07T16:40:00.000Z',
    usageCount: 9,
  },
  {
    id: 'memory-translation',
    type: 'translation_preference',
    title: '',
    content: '专业软件与框架名称默认保留英文。',
    enabled: true,
    pinned: false,
    priority: 0,
    sourceType: 'manual',
    createdAt: '2026-08-02T09:10:00.000Z',
    updatedAt: '2026-08-02T09:10:00.000Z',
    usageCount: 4,
  },
  {
    id: 'memory-disabled',
    type: 'personal_context',
    title: '',
    content: '我也在研究细胞培养与显微成像流程。',
    enabled: false,
    pinned: false,
    priority: 0,
    sourceType: 'manual',
    createdAt: '2026-08-03T09:00:00.000Z',
    updatedAt: '2026-08-06T09:00:00.000Z',
    usageCount: 0,
  },
];

const globalMemorySnapshot = {
  version: 12,
  fingerprint: '9f41ab2c7d5e0813',
  stableProfile: '- 我是飞行器设计与工程专业本科生，研究方向是机器人控制与强化学习。',
  stablePreferences: '',
  stableResponseStyle: '- 技术回答优先解释原理，再给实施步骤；先给结论。',
  memoryCount: 2,
};

const importCandidates = [
  {
    id: 'candidate-1',
    jobId: 'job-preview',
    type: 'response_style',
    title: '回答风格',
    content: '先给结论，再解释原理。',
    state: 'pending',
    glossaryHint: false,
    ordinal: 0,
  },
  {
    id: 'candidate-2',
    jobId: 'job-preview',
    type: 'translation_preference',
    title: '翻译偏好',
    content: 'reinforcement learning 固定翻译为强化学习。',
    state: 'pending',
    glossaryHint: true,
    ordinal: 1,
  },
  {
    id: 'candidate-3',
    jobId: 'job-preview',
    type: 'domain_background',
    title: '领域背景',
    content: '熟悉 Python、ROS 2、PX4 和 Isaac Lab。',
    state: 'duplicate',
    glossaryHint: false,
    ordinal: 2,
  },
];

const fixtures = {
  conversations,
  messages,
  models,
  presets,
  globalMemories,
  globalMemorySnapshot,
  importCandidates,
};

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await globalThis.fetch(serverUrl);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await delay(250);
  }
  throw new Error(`Vite did not become ready at ${serverUrl}`);
}

await mkdir(screenshotDirectory, { recursive: true });
const server = spawn(
  process.execPath,
  [viteModule, '--host', '127.0.0.1', '--port', '4178', '--strictPort'],
  {
    cwd: desktopDirectory,
    windowsHide: true,
    stdio: 'ignore',
  },
);

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 1.25,
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  await page.addInitScript((data) => {
    const selections = new Map(
      data.presets.map((preset) => [
        preset.task,
        {
          scope: 'task',
          scopeId: preset.task,
          task: preset.task,
          modelId: preset.modelId,
          thinkingEnabled: preset.thinkingEnabled,
          ...(preset.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: preset.reasoningEffort }),
          updatedAt: '2026-08-04T11:10:00.000Z',
        },
      ]),
    );
    globalThis.__TAURI_INTERNALS__ = {
      invoke: async (command, args = {}) => {
        if (command === 'dashboard_summary') {
          return {
            workspaces: 3,
            glossaryEntries: 128,
            candidateTerms: 7,
            conversations: data.conversations.length,
            confirmedMemories: 12,
            translatedPages: 42,
            cacheEntries: 318,
          };
        }
        if (command === 'conversation_list') {
          return data.conversations.filter(
            (item) => item.status === args.status && item.title.includes(args.search),
          );
        }
        if (command === 'conversation_get') {
          const conversation = data.conversations.find((item) => item.id === args.conversationId);
          return {
            conversation,
            messages: data.messages,
            messageOffset: args.messageOffset,
            messageLimit: args.messageLimit,
            totalMessages: data.messages.length,
            hasMore: false,
          };
        }
        if (command === 'api_config_status') {
          return {
            configured: true,
            baseUrl: 'https://api.deepseek.com',
            maskedKey: 'sk-••••••demo',
            firstTokenTimeoutMs: 30000,
            totalTimeoutMs: 120000,
            maxConcurrency: 3,
            maxRetries: 2,
          };
        }
        if (command === 'task_preset_list') return data.presets;
        if (command === 'global_memory_list') {
          const needle = String(args.search ?? '').toLowerCase();
          return data.globalMemories.filter(
            (item) =>
              (needle === '' || item.content.toLowerCase().includes(needle)) &&
              (args.memoryType === null || item.type === args.memoryType),
          );
        }
        if (command === 'global_memory_snapshot') return data.globalMemorySnapshot;
        if (command === 'global_memory_import_preview') {
          return {
            jobId: 'job-preview',
            sourceName: 'profile.md',
            sourceFormat: 'md',
            candidates: data.importCandidates,
          };
        }
        if (command === 'global_memory_import_jobs') return [];
        if (command === 'memory_list') return [];
        if (command === 'memory_candidate_list') return [];
        if (command === 'model_catalog_list') return data.models;
        if (command === 'model_selection_get') return selections.get(args.task) ?? null;
        if (command === 'model_selection_set') {
          const selection = { ...args.input, updatedAt: new Date().toISOString() };
          selections.set(args.input.task, selection);
          return selection;
        }
        return null;
      },
    };
  }, fixtures);
  await page.goto(serverUrl, { waitUntil: 'networkidle' });

  await page.getByRole('button', { name: '历史对话' }).click();
  await page.locator('.history-index-row').first().click();
  await page.getByText('CONVERSATION ID', { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(screenshotDirectory, 'desktop-history-ledger-125.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: '模型与 API' }).click();
  await page.getByRole('table', { name: '模型能力目录' }).waitFor();
  await page.screenshot({
    path: path.join(screenshotDirectory, 'desktop-model-catalog-125.png'),
    fullPage: true,
  });

  // Global memory: real CRUD surface plus the stable-prefix snapshot.
  await page.getByRole('button', { name: '记忆管理' }).click();
  await page.getByRole('heading', { name: '全局记忆' }).waitFor();
  await page.getByText('稳定前缀版本').waitFor();
  await page.screenshot({
    path: path.join(screenshotDirectory, 'desktop-global-memory-crud-125.png'),
    fullPage: true,
  });

  // Editing an existing memory loads it into the editor.
  await page
    .locator('.record-list article', { hasText: '熟悉 Python、ROS 2、PX4 和 Isaac Lab。' })
    .getByRole('button', { name: '编辑' })
    .click();
  await page.getByRole('heading', { name: '编辑记忆' }).waitFor();
  await page.screenshot({
    path: path.join(screenshotDirectory, 'desktop-global-memory-edit-125.png'),
    fullPage: true,
  });

  // Import review: candidates require explicit confirmation before any write.
  await page.getByLabel('文件路径').fill('C:\\Users\\reader\\Documents\\profile.md');
  await page.getByRole('button', { name: '解析文件' }).click();
  await page.getByRole('heading', { name: /候选记忆/ }).waitFor();
  await page.locator('.memory-import__review').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(screenshotDirectory, 'desktop-global-memory-import-125.png'),
    fullPage: true,
  });

  await context.close();
} finally {
  if (browser !== undefined) await browser.close();
  server.kill();
}
