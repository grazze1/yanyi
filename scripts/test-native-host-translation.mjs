import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers';

const hostPath = process.env.YANYI_NATIVE_HOST_PATH
  ? resolve(process.env.YANYI_NATIVE_HOST_PATH)
  : resolve('target/debug/yanyi-native-host.exe');

function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(body.length);
  return Buffer.concat([prefix, body]);
}

function envelope(type, payload, { requestId = randomUUID(), sequence = 0, done = false } = {}) {
  return { protocolVersion: 1, requestId, type, sequence, done, payload };
}

const mock = createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    const source = JSON.parse(body).messages.at(-1).content;
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    response.write(': keepalive\n\n');
    response.write('data: {"choices":[{"delta":{"content":"模拟译文："}}]}\n\n');
    delay(() => {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: source } }] })}\n\n`);
      response.write(
        'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}\n\n',
      );
      response.end('data: [DONE]\n\n');
    }, 90);
  });
});

await new Promise((resolveServer) => mock.listen(0, '127.0.0.1', resolveServer));
const address = mock.address();
assert(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}/`;
const child = spawn(hostPath, [], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    YANYI_MOCK_SSE_URL: baseUrl,
    YANYI_DATA_DIR: resolve('test-results/native-host-data'),
  },
});

const events = [];
let buffer = Buffer.alloc(0);
child.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < length + 4) return;
    events.push(JSON.parse(buffer.subarray(4, length + 4).toString('utf8')));
    buffer = buffer.subarray(length + 4);
  }
});

function send(type, payload, options) {
  child.stdin.write(frame(envelope(type, payload, options)));
}

async function waitFor(predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolveTimer) => delay(resolveTimer, 20));
  }
  throw new Error(`Timed out. Events: ${JSON.stringify(events)}`);
}

try {
  send(
    'system.handshake.request',
    { extensionVersion: '0.1.0', supportedProtocolVersions: [1] },
    { done: true },
  );
  await waitFor((event) => event.type === 'system.handshake.ready');
  const taskId = '00000000-0000-4000-8000-000000000101';
  send('translation.start', {
    taskId,
    tabId: 1,
    frameId: 0,
    pageSessionId: '00000000-0000-4000-8000-000000000102',
    targetLanguage: 'zh-CN',
    promptVersion: 'page-v2',
    glossaryVersion: 0,
    translationMode: 'below',
    websiteRuleVersion: 0,
    profile: { model: 'deepseek-v4-flash', thinking: 'disabled' },
    segments: [
      {
        segmentId: 'one',
        sourceText: 'First useful source __YANYI_CODE_0__',
        sourceHash: 'onehash',
        placeholders: ['__YANYI_CODE_0__'],
        priority: 0,
      },
      {
        segmentId: 'two',
        sourceText: 'Second useful source for pause behavior',
        sourceHash: 'twohash',
        placeholders: [],
        priority: 0,
      },
      {
        segmentId: 'three',
        sourceText: 'Third useful source waits for resume',
        sourceHash: 'threehash',
        placeholders: [],
        priority: 1,
      },
    ],
  });
  await waitFor(
    (event) => event.type === 'translation.accepted' && event.payload.taskId === taskId,
  );
  send('translation.pause', { taskId }, { done: true });
  await waitFor(
    (event) =>
      event.type === 'translation.progress' &&
      event.payload.taskId === taskId &&
      event.payload.completed === 2,
  );
  await new Promise((resolveTimer) => delay(resolveTimer, 160));
  assert.equal(
    events.some(
      (event) =>
        event.type === 'translation.segment.started' && event.payload.segmentId === 'three',
    ),
    false,
    'pause must block queued segment',
  );
  send('translation.resume', { taskId }, { done: true });
  const completed = await waitFor(
    (event) => event.type === 'translation.completed' && event.payload.taskId === taskId,
  );
  assert.equal(completed.payload.completed, 3);
  assert.equal(completed.payload.failed, 0);
  assert(
    events.some((event) => event.type === 'translation.segment.delta'),
    'stream deltas must cross Native Messaging',
  );

  const cancelledTask = '00000000-0000-4000-8000-000000000103';
  send('translation.start', {
    taskId: cancelledTask,
    tabId: 1,
    frameId: 0,
    pageSessionId: '00000000-0000-4000-8000-000000000104',
    targetLanguage: 'zh-CN',
    promptVersion: 'page-v2',
    glossaryVersion: 0,
    translationMode: 'below',
    websiteRuleVersion: 0,
    profile: { model: 'deepseek-v4-flash', thinking: 'disabled' },
    segments: [
      {
        segmentId: 'cancel-me',
        sourceText: 'Cancellation must stop this request safely',
        sourceHash: 'cancelhash',
        placeholders: [],
        priority: 0,
      },
    ],
  });
  await waitFor(
    (event) => event.type === 'translation.accepted' && event.payload.taskId === cancelledTask,
  );
  send('translation.cancel', { taskId: cancelledTask }, { done: true });
  await waitFor(
    (event) => event.type === 'translation.cancelled' && event.payload.taskId === cancelledTask,
  );

  const assistantTask = '00000000-0000-4000-8000-000000000105';
  send('assistant.start', {
    taskId: assistantTask,
    intent: 'explain',
    prompt: '解释当前选区',
    context: {
      selection: 'policy gradient',
      paragraph: 'A policy gradient optimizes expected return.',
      heading: 'Methods',
      title: 'Paper',
      url: 'https://example.com/paper',
    },
    profile: {
      model: 'deepseek-v4-pro',
      thinking: 'enabled',
      reasoningEffort: 'high',
      maxOutputTokens: 4096,
    },
  });
  await waitFor(
    (event) => event.type === 'assistant.accepted' && event.payload.taskId === assistantTask,
  );
  const assistantCompleted = await waitFor(
    (event) => event.type === 'assistant.completed' && event.payload.taskId === assistantTask,
  );
  assert.match(assistantCompleted.payload.answer, /模拟译文/);
  assert.equal(assistantCompleted.payload.usage.totalTokens, 7);
  assert(
    events.some(
      (event) => event.type === 'assistant.delta' && event.payload.taskId === assistantTask,
    ),
    'assistant deltas must cross Native Messaging',
  );
  assert.equal(buffer.length, 0, 'stdout must contain only complete protocol frames');
  process.stdout.write('Native Host translation and assistant Mock SSE integration passed.\n');
} finally {
  child.kill();
  await new Promise((resolveClose) => mock.close(resolveClose));
}
