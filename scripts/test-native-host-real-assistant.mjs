import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

if (process.env.YANYI_CONFIRM_BILLING !== '1') {
  throw new Error('Set YANYI_CONFIRM_BILLING=1 to allow one small real assistant request.');
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
    done: type !== 'assistant.start',
    ...(taskId === undefined ? {} : { idempotencyKey: taskId }),
    payload,
  };
}

const child = spawn(hostPath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const events = [];
let output = Buffer.alloc(0);
child.stderr.resume();
child.stdout.on('data', (chunk) => {
  output = Buffer.concat([output, chunk]);
  while (output.length >= 4) {
    const length = output.readUInt32LE(0);
    if (output.length < length + 4) return;
    events.push(JSON.parse(output.subarray(4, length + 4).toString('utf8')));
    output = output.subarray(length + 4);
  }
});

async function waitFor(predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    if (child.exitCode !== null) {
      throw new Error(`Native Host exited unexpectedly (${String(child.exitCode)}).`);
    }
    await delay(25);
  }
  throw new Error(
    `Real assistant request timed out. Events: ${events.map(({ type }) => type).join(', ')}`,
  );
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
  child.stdin.write(
    frame(
      envelope(
        'assistant.start',
        {
          taskId,
          intent: 'explain',
          prompt: '请先调用 get_selection_context 获取可靠页面依据，再用一句简洁中文解释选区。',
          knowledgeMode: 'page_only',
          context: {
            selection: 'A tensor is a multidimensional array used by PyTorch.',
            paragraph: 'A tensor is a multidimensional array used by PyTorch.',
            heading: 'Tensors',
            title: 'PyTorch documentation',
            url: 'https://pytorch.org/docs/stable/tensors.html',
            pageSessionId: randomUUID(),
          },
          profile: {
            providerId: 'deepseek',
            model: 'deepseek-v4-pro',
            thinking: 'enabled',
            reasoningEffort: 'high',
            maxOutputTokens: 512,
            streaming: true,
          },
        },
        taskId,
      ),
    ),
  );

  const terminal = await waitFor(
    (event) =>
      event.payload?.taskId === taskId &&
      ['assistant.completed', 'assistant.failed', 'assistant.cancelled'].includes(event.type),
  );
  assert.equal(
    terminal.type,
    'assistant.completed',
    String(terminal.payload?.error?.code ?? terminal.payload?.error?.message ?? terminal.type),
  );
  assert.equal(typeof terminal.payload.answer, 'string');
  assert.ok(terminal.payload.answer.length > 0);
  assert.equal(terminal.payload.historySaved, true);
  assert.equal(typeof terminal.payload.conversationId, 'string');
  assert.ok(Array.isArray(terminal.payload.citations));
  assert.ok(terminal.payload.citations.length > 0, 'Expected a page citation from the tool call.');
  child.stdin.write(
    frame(
      envelope('conversation.get.request', {
        conversationId: terminal.payload.conversationId,
        messageOffset: 0,
        messageLimit: 20,
      }),
    ),
  );
  const restored = await waitFor(
    (event) =>
      event.type === 'conversation.get.ready' &&
      event.payload?.conversation?.conversation?.id === terminal.payload.conversationId,
    10_000,
  );
  const restoredMessages = restored.payload.conversation.messages;
  assert.ok(Array.isArray(restoredMessages));
  const restoredAssistant = restoredMessages.findLast((message) => message.role === 'assistant');
  assert.ok(Array.isArray(restoredAssistant?.citations));
  assert.ok(
    restoredAssistant.citations.length > 0,
    'Expected citations to survive SQLite recovery.',
  );
  assert.equal(restoredAssistant.citations[0].sourceKind, 'page');
  assert.equal(
    JSON.stringify(events).includes('reasoning_content') ||
      JSON.stringify(events).includes('reasoningContent'),
    false,
  );
  process.stdout.write(
    `${JSON.stringify({
      status: 'passed',
      answerCharacters: terminal.payload.answer.length,
      citations: terminal.payload.citations.length,
      restoredCitations: restoredAssistant.citations.length,
      historySaved: terminal.payload.historySaved,
      reasoningExposed: false,
    })}\n`,
  );
} finally {
  child.kill();
}
