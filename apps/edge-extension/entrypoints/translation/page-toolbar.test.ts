import { describe, expect, it, vi } from 'vitest';
import { PageTranslationToolbar } from './page-toolbar';

describe('PageTranslationToolbar', () => {
  it('uses Shadow DOM and exposes mode, pause and restore actions', () => {
    const actions = {
      setMode: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      restore: vi.fn(),
    };
    const toolbar = new PageTranslationToolbar(document, actions);
    toolbar.mount(3);
    const host = document.querySelector('[data-yanyi-owned="toolbar"]');
    expect(host?.shadowRoot?.textContent).toContain('0 / 3 块');
    const buttons = [...(host?.shadowRoot?.querySelectorAll('button') ?? [])];
    buttons.find((button) => button.textContent === '双语')!.click();
    expect(actions.setMode).toHaveBeenCalledWith('bilingual');
    buttons.find((button) => button.textContent === '暂停')!.click();
    expect(actions.pause).toHaveBeenCalledOnce();
    toolbar.markCompleted();
    expect(host?.shadowRoot?.textContent).toContain('1 / 3 块');
    toolbar.destroy();
    expect(document.querySelector('[data-yanyi-owned="toolbar"]')).toBeNull();
  });
});
