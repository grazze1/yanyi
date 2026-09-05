import { lstat, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const artifactTargets = [
  'apps/desktop/dist',
  'apps/edge-extension/.output',
  'apps/edge-extension/.wxt',
  'coverage',
  'target/debug',
  'target/release',
];
const testTargets = ['.playwright-profile', 'playwright-report', 'test-results', '.test-data'];

function remainsWithin(root, target) {
  const fromRoot = relative(root, target);
  return fromRoot !== '' && !fromRoot.startsWith('..') && !isAbsolute(fromRoot);
}

export async function safeTarget(root, relativePath) {
  if (isAbsolute(relativePath)) throw new Error(`拒绝绝对清理路径：${relativePath}`);
  const lexicalRoot = resolve(root);
  const target = resolve(lexicalRoot, relativePath);
  if (!remainsWithin(lexicalRoot, target)) {
    throw new Error(`拒绝工作区外清理路径：${relativePath}`);
  }
  const canonicalRoot = await realpath(lexicalRoot);
  let cursor = lexicalRoot;
  for (const part of relative(lexicalRoot, target).split(sep)) {
    cursor = resolve(cursor, part);
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink()) {
        throw new Error(`拒绝经过符号链接或目录联接清理：${relativePath}`);
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') break;
      throw error;
    }
  }
  try {
    const canonicalTarget = await realpath(target);
    if (!remainsWithin(canonicalRoot, canonicalTarget)) {
      throw new Error(`拒绝真实路径位于工作区外的清理目标：${relativePath}`);
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return target;
}

async function main() {
  const mode = process.argv[2] ?? 'all';
  if (!['all', 'artifacts', 'test-data'].includes(mode)) {
    throw new Error('用法：node scripts/clean-workspace.mjs [all|artifacts|test-data]');
  }
  const selected = [
    ...(mode === 'all' || mode === 'artifacts' ? artifactTargets : []),
    ...(mode === 'all' || mode === 'test-data' ? testTargets : []),
  ];

  for (const relativePath of selected) {
    await rm(await safeTarget(workspaceRoot, relativePath), { recursive: true, force: true });
    process.stdout.write(`已清理 ${relativePath}\n`);
  }
}

if (resolve(process.argv[1] ?? '').toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  await main();
}
