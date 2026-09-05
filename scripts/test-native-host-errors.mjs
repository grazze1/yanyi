import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const hostPath = process.env.YANYI_NATIVE_HOST_PATH
  ? resolve(process.env.YANYI_NATIVE_HOST_PATH)
  : resolve('target/debug/yanyi-native-host.exe');
const expectedCodes = new Map([
  [401, 'api_auth_failed'],
  [402, 'api_balance_insufficient'],
  [429, 'api_rate_limited'],
  [500, 'api_request_failed'],
  [503, 'api_request_failed'],
]);

function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(body.length);
  return Buffer.concat([prefix, body]);
}

const mock = createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    const source = JSON.parse(body).messages.at(-1).content;
    const status = Number(/MOCK_STATUS_(\d+)/u.exec(source)?.[1] ?? 500);
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'mock provider error' } }));
  });
});

await new Promise((resolveServer) => mock.listen(0, '127.0.0.1', resolveServer));
const address = mock.address();
assert(address && typeof address === 'object');
const child = spawn(hostPath, [], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    YANYI_MOCK_SSE_URL: `http://127.0.0.1:${address.port}/`,
    YANYI_DATA_DIR: resolve('test-results/native-host-errors', randomUUID()),
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

function send(type, payload) {
  child.stdin.write(
    frame({ protocolVersion: 1, requestId: randomUUID(), type, sequence: 0, done: false, payload }),
  );
}
async function waitFor(predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    await delay(20);
  }
  throw new Error(`Timed out. Events: ${JSON.stringify(events)}`);
}

try {
  send('system.handshake.request', { extensionVersion: '0.1.0', supportedProtocolVersions: [1] });
  await waitFor((event) => event.type === 'system.handshake.ready');
  for (const [status, expectedCode] of expectedCodes) {
    const taskId = randomUUID();
    send('translation.start', {
      taskId,
      tabId: 1,
      frameId: 0,
      pageSessionId: randomUUID(),
      targetLanguage: 'zh-CN',
      promptVersion: 'error-matrix-v1',
      glossaryVersion: 0,
      translationMode: 'below',
      websiteRuleVersion: 0,
      profile: { model: 'deepseek-v4-flash', thinking: 'disabled' },
      segments: [
        {
          segmentId: `status-${status}`,
          sourceText: `MOCK_STATUS_${status}`,
          sourceHash: `status-${status}`,
          placeholders: [],
          priority: 0,
        },
      ],
    });
    const failure = await waitFor(
      (event) => event.type === 'translation.segment.failed' && event.payload.taskId === taskId,
    );
    assert.equal(failure.payload.error.code, expectedCode);
    assert.equal(typeof failure.payload.error.message, 'string');
    assert.equal(failure.payload.error.message.includes('mock provider error'), false);
  }
  process.stdout.write('Native Host Mock 401/402/429/500/503 matrix passed.\n');
} finally {
  child.kill();
  await new Promise((resolveClose) => mock.close(resolveClose));
}
