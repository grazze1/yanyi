import type { TranslationMode } from '@yanyi/shared-types';

export interface ToolbarActions {
  setMode(mode: TranslationMode): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  restore(): void;
}

export class PageTranslationToolbar {
  private readonly host: HTMLElement;
  private readonly progressText: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private completed = 0;
  private total = 0;
  private paused = false;

  constructor(
    document: Document,
    private readonly actions: ToolbarActions,
  ) {
    this.host = document.createElement('div');
    this.host.dataset.yanyiOwned = 'toolbar';
    this.host.setAttribute('role', 'region');
    this.host.setAttribute('aria-label', '研译页面翻译工具条');
    const root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; position: fixed; z-index: 2147483646; inset: 12px 12px auto auto; font-family: system-ui,'Segoe UI','Microsoft YaHei UI',sans-serif; color: #0f172a; }
      .bar { display:flex; align-items:center; gap:6px; min-height:40px; padding:5px 7px; border:1px solid #cbd5e1; border-radius:10px; background:#fff; box-shadow:0 8px 24px rgb(15 23 42 / 16%); }
      .brand { display:grid; width:28px; height:28px; place-items:center; border-radius:7px; background:#2563eb; color:#fff; font-weight:700; }
      .progress { min-width:82px; padding:0 5px; color:#475569; font:11px ui-monospace,'Cascadia Code',monospace; }
      button { min-height:28px; border:1px solid transparent; border-radius:7px; background:transparent; color:#334155; padding:0 8px; font:11px inherit; cursor:pointer; }
      button:hover { background:#f1f5f9; }
      button[aria-pressed='true'] { border-color:#bfdbfe; background:#eff6ff; color:#1d4ed8; }
      button:focus-visible { outline:2px solid #2563eb; outline-offset:2px; }
      .danger { color:#b91c1c; }
      @media (max-width: 700px) { .mode-label { display:none; } .progress { min-width:auto; } }
      @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
    `;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.textContent = '研';
    brand.setAttribute('aria-hidden', 'true');
    this.progressText = document.createElement('span');
    this.progressText.className = 'progress';
    this.progressText.setAttribute('aria-live', 'polite');
    const modes: readonly [TranslationMode, string][] = [
      ['replace', '替换'],
      ['below', '原文下方'],
      ['bilingual', '双语'],
    ];
    const modeButtons = modes.map(([mode, label], index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.className = 'mode-label';
      button.setAttribute('aria-pressed', String(index === 1));
      button.addEventListener('click', () => {
        for (const candidate of modeButtons)
          candidate.setAttribute('aria-pressed', String(candidate === button));
        this.actions.setMode(mode);
      });
      return button;
    });
    this.pauseButton = document.createElement('button');
    this.pauseButton.type = 'button';
    this.pauseButton.textContent = '暂停';
    this.pauseButton.addEventListener('click', () => {
      this.paused = !this.paused;
      this.pauseButton.textContent = this.paused ? '继续' : '暂停';
      this.pauseButton.setAttribute('aria-pressed', String(this.paused));
      if (this.paused) this.actions.pause();
      else this.actions.resume();
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => this.actions.cancel());
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.textContent = '还原';
    restore.className = 'danger';
    restore.addEventListener('click', () => this.actions.restore());
    bar.append(brand, this.progressText, ...modeButtons, this.pauseButton, cancel, restore);
    root.append(style, bar);
    this.updateProgress();
  }

  mount(total: number) {
    this.total = total;
    this.completed = 0;
    this.updateProgress();
    this.host.ownerDocument.documentElement.append(this.host);
  }
  addTotal(count: number) {
    this.total += Math.max(0, count);
    this.updateProgress();
  }

  markCompleted(count = 1) {
    this.completed = Math.min(this.total, this.completed + Math.max(0, count));
    this.updateProgress();
  }
  destroy() {
    this.host.remove();
  }
  private updateProgress() {
    this.progressText.textContent = `${String(this.completed)} / ${String(this.total)} 块`;
  }
}
