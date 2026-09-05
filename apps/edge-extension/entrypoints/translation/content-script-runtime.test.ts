import { describe, expect, it } from 'vitest';
import {
  describeContentScriptInjectionFailure,
  RUNTIME_CONTENT_SCRIPT_FILE,
} from './content-script-runtime';

describe('runtime content script', () => {
  it('uses the relative path required by chrome.scripting.executeScript', () => {
    expect(RUNTIME_CONTENT_SCRIPT_FILE).toBe('content-scripts/content.js');
    expect(RUNTIME_CONTENT_SCRIPT_FILE.startsWith('/')).toBe(false);
  });

  it('turns browser injection failures into actionable messages', () => {
    expect(
      describeContentScriptInjectionFailure(new Error('Could not load file: foo.js')),
    ).toContain('重新加载');
    expect(
      describeContentScriptInjectionFailure(
        new Error('Cannot access contents of url "https://github.com"'),
      ),
    ).toContain('权限');
  });
});
