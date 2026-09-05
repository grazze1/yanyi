import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

if (process.env.YANYI_CONFIRM_BILLING !== '1') {
  throw new Error('Set YANYI_CONFIRM_BILLING=1 to allow one small real translation request.');
}

const hostPath = process.env.YANYI_NATIVE_HOST_PATH
  ? resolve(process.env.YANYI_NATIVE_HOST_PATH)
  : resolve('target/release/yanyi-native-host.exe');

function frame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(body.length);
  return Buffer.concat([prefix, body]);
}

function envelope(type, payload, taskId) {
  return {
    protocolVersion: 1,
    requestId: randomUUID(),
    type,
    sequence: 0,
    done: type !== 'translation.start',
    ...(taskId === undefined ? {} : { idempotencyKey: taskId }),
    payload,
  };
}

const child = spawn(hostPath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const events = [];
const stderr = [];
let output = Buffer.alloc(0);
child.stderr.on('data', (chunk) => stderr.push(chunk));
child.stdout.on('data', (chunk) => {
  output = Buffer.concat([output, chunk]);
  while (output.length >= 4) {
    const length = output.readUInt32LE(0);
    if (output.length < length + 4) return;
    events.push(JSON.parse(output.subarray(4, length + 4).toString('utf8')));
    output = output.subarray(length + 4);
  }
});

async function waitFor(predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    if (child.exitCode !== null) {
      throw new Error(`Native Host exited unexpectedly (${String(child.exitCode)}).`);
    }
    await delay(25);
  }
  const eventTypes = events.map((event) => event.type).join(', ');
  throw new Error(`Real translation timed out. Event types: ${eventTypes}`);
}

try {
  child.stdin.write(
    frame(
      envelope('system.handshake.request', {
        extensionVersion: '0.1.0',
        supportedProtocolVersions: [1],
      }),
    ),
  );
  await waitFor((event) => event.type === 'system.handshake.ready', 5_000);

  const taskId = randomUUID();
  const sourceText =
    'A feedback controller reduces tracking error while preserving __YANYI_CODE_0__.';
  child.stdin.write(
    frame(
      envelope(
        'translation.start',
        {
          taskId,
          tabId: 1,
          frameId: 0,
          pageSessionId: randomUUID(),
          targetLanguage: 'zh-CN',
          promptVersion: 'diagnostic-real-v1',
          glossaryVersion: 0,
          translationMode: 'below',
          websiteRuleVersion: 0,
          profile: { model: 'deepseek-v4-flash', thinking: 'disabled' },
          segments: [
            {
              segmentId: 'diagnostic-segment',
              sourceText,
              sourceHash: 'diagnostic-source-hash',
              placeholders: ['__YANYI_CODE_0__'],
              priority: 0,
            },
          ],
        },
        taskId,
      ),
    ),
  );

  const terminalSegmentEvent = await waitFor(
    (event) =>
      event.payload?.taskId === taskId &&
      [
        'translation.segment.completed',
        'translation.segment.failed',
        'translation.failed',
      ].includes(event.type),
  );
  assert.equal(
    terminalSegmentEvent.type,
    'translation.segment.completed',
    String(terminalSegmentEvent.payload?.error?.code ?? terminalSegmentEvent.payload?.code),
  );
  assert.equal(terminalSegmentEvent.payload.sourceHash, 'diagnostic-source-hash');
  assert.equal(typeof terminalSegmentEvent.payload.translation, 'string');
  assert.ok(terminalSegmentEvent.payload.translation.length > 0);
  assert.ok(terminalSegmentEvent.payload.translation.includes('__YANYI_CODE_0__'));
  await waitFor(
    (event) => event.type === 'translation.completed' && event.payload?.taskId === taskId,
  );
  process.stdout.write(
    `${JSON.stringify({ status: 'passed', outputCharacters: terminalSegmentEvent.payload.translation.length, plaintextOutput: false })}\n`,
  );
} finally {
  child.kill();
  if (stderr.length > 0 && child.exitCode !== null && child.exitCode !== 0) {
    process.stderr.write('Native Host emitted diagnostics; content suppressed.\n');
  }
}
