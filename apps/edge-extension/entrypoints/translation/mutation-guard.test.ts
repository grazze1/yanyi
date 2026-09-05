import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MutationGuard } from './mutation-guard';

afterEach(() => {
  vi.useRealTimers();
});

interface TestDom {
  window: Window & typeof globalThis & { close(): void };
}

function installDom(dom: TestDom) {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver,
  });
}

describe('MutationGuard iframe lifecycle', () => {
  it('rescans after an existing iframe loads a new document', () => {
    vi.useFakeTimers();
    const dom = new JSDOM('<!doctype html><body><iframe title="guide"></iframe></body>') as TestDom;
    installDom(dom);
    const frame = dom.window.document.querySelector('iframe');
    if (frame === null) throw new Error('fixture iframe missing');
    const onRescan = vi.fn();
    const guard = new MutationGuard(dom.window.document, [], vi.fn(), onRescan, 500);

    frame.dispatchEvent(new dom.window.Event('load'));
    vi.advanceTimersByTime(499);
    expect(onRescan).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRescan).toHaveBeenCalledTimes(1);

    guard.disconnect();
    frame.dispatchEvent(new dom.window.Event('load'));
    vi.advanceTimersByTime(500);
    expect(onRescan).toHaveBeenCalledTimes(1);
    dom.window.close();
  });

  it('watches an iframe inserted before its document finishes loading', async () => {
    vi.useFakeTimers();
    const dom = new JSDOM('<!doctype html><body><main></main></body>') as TestDom;
    installDom(dom);
    const onRescan = vi.fn();
    const guard = new MutationGuard(dom.window.document, [], vi.fn(), onRescan, 500);
    const frame = dom.window.document.createElement('iframe');
    frame.title = 'late guide';
    dom.window.document.querySelector('main')?.append(frame);

    // MutationObserver callbacks run before the later iframe load task.
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(500);
    onRescan.mockClear();

    frame.dispatchEvent(new dom.window.Event('load'));
    vi.advanceTimersByTime(500);
    expect(onRescan).toHaveBeenCalledTimes(1);

    guard.disconnect();
    dom.window.close();
  });
});
