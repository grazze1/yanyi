import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';

const hostPath = process.env.YANYI_NATIVE_HOST_PATH
  ? resolve(process.env.YANYI_NATIVE_HOST_PATH)
  : resolve('target/debug/yanyi-native-host.exe');

function frame(envelope) {
  const body = Buffer.from(JSON.stringify(envelope), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

function runHost(envelope) {
  return new Promise((resolveRun, reject) => {
    const host = spawn(hostPath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [];
    const stderr = [];
    const timeout = setTimeout(() => {
      host.kill();
      reject(new Error('Native Host handshake timed out after 5 seconds'));
    }, 5_000);
    host.stdout.on('data', (chunk) => stdout.push(chunk));
    host.stderr.on('data', (chunk) => stderr.push(chunk));
    host.on('error', reject);
    host.on('close', (code) => {
      clearTimeout(timeout);
      try {
        assert.equal(code, 0, Buffer.concat(stderr).toString('utf8'));
        const output = Buffer.concat(stdout);
        assert.ok(output.length >= 4, 'Native Host returned no framed response');
        const length = output.readUInt32LE(0);
        assert.equal(output.length, length + 4, 'Native Host returned a malformed frame');
        resolveRun(JSON.parse(output.subarray(4).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    host.stdin.end(frame(envelope));
  });
}

const requestId = randomUUID();
const response = await runHost({
  protocolVersion: 1,
  requestId,
  type: 'system.handshake.request',
  sequence: 0,
  done: true,
  payload: { extensionVersion: '0.1.0', supportedProtocolVersions: [1] },
});

assert.equal(response.protocolVersion, 1);
assert.equal(response.requestId, requestId);
assert.equal(response.type, 'system.handshake.ready');
assert.equal(response.payload.negotiatedProtocolVersion, 1);
assert.ok(response.payload.capabilities.includes('sqlite'));
process.stdout.write(`Native Host handshake OK (${response.payload.hostVersion}, protocol 1)\n`);
