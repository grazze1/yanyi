import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { safeTarget } from '../../../scripts/clean-workspace.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('clean workspace path guard', () => {
  it('accepts an ordinary explicit target inside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yanyi-clean-root-'));
    temporaryRoots.push(root);
    await mkdir(join(root, 'target', 'debug'), { recursive: true });

    await expect(safeTarget(root, 'target/debug')).resolves.toBe(join(root, 'target', 'debug'));
  });

  it('rejects an intermediate Windows junction or symbolic link to outside data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yanyi-clean-root-'));
    const external = await mkdtemp(join(tmpdir(), 'yanyi-clean-external-'));
    temporaryRoots.push(root, external);
    await symlink(external, join(root, 'target'), 'junction');

    await expect(safeTarget(root, 'target/debug')).rejects.toThrow(/symbolic|联接/u);
  });
});

describe('release content audit', () => {
  it('rejects a hidden reasoning field in a production bundle', async () => {
    const root = await mkdtemp(join(process.cwd(), '.release-audit-test-'));
    temporaryRoots.push(root);
    await writeFile(
      join(root, 'bundle.js'),
      'globalThis.__providerPayload = { reasoning_content: "private" };',
      'utf8',
    );

    const script = join(process.cwd(), 'scripts', 'Test-ReleaseContents.ps1');
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Roots', root],
      { encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('hidden reasoning field');
  });
});
