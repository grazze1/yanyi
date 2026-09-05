export const RUNTIME_CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

export function describeContentScriptInjectionFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const normalized = detail.toLowerCase();

  if (normalized.includes('could not load file') || normalized.includes('failed to load')) {
    return '扩展内容脚本加载失败。请在扩展管理页重新加载“研译”后重试。';
  }
  if (
    normalized.includes('cannot access contents') ||
    normalized.includes('cannot access a chrome') ||
    normalized.includes('cannot access edge') ||
    normalized.includes('missing host permission')
  ) {
    return 'Edge 未授予研译访问当前网页的权限。请在目标标签页中从工具栏打开研译，再点击翻译。';
  }
  if (
    normalized.includes('receiving end does not exist') ||
    normalized.includes('message port closed')
  ) {
    return '翻译脚本已加载，但页面通信尚未就绪。请刷新当前网页后重试。';
  }
  return '无法注入翻译脚本。请重新加载研译扩展和当前网页后重试。';
}
