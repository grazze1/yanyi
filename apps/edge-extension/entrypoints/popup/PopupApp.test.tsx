import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PopupSnapshot, TranslationPreferencePatch } from '@yanyi/shared-types';
import { PopupApp } from './PopupApp';
import type { PopupAdapter } from './popupAdapter';
import { createFixturePopupAdapter } from './popupFixtureAdapter';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function applyPreferencePatch(
  snapshot: PopupSnapshot,
  patch: TranslationPreferencePatch,
): PopupSnapshot {
  return {
    ...snapshot,
    ...patch,
    tags: patch.tags === undefined ? snapshot.tags : [...patch.tags],
  };
}

describe('PopupApp', () => {
  it('shows one clear primary translation action', async () => {
    render(<PopupApp adapter={createFixturePopupAdapter('connected')} />);
    expect(await screen.findByRole('button', { name: '翻译此页面' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: '翻译此页面' })).toHaveLength(1);
  });

  it('changes translation mode with a semantic radio group', async () => {
    const user = userEvent.setup();
    render(<PopupApp adapter={createFixturePopupAdapter('connected')} />);
    const bilingual = await screen.findByRole('radio', { name: '双语对照' });
    await user.click(bilingual);
    expect(bilingual).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps the primary action disabled while offline', async () => {
    render(<PopupApp adapter={createFixturePopupAdapter('offline')} />);
    await waitFor(() => {
      expect(screen.getByText('本地服务离线')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '翻译此页面' })).toBeDisabled();
  });

  it('selects a domain and adds a typed tag from the picker', async () => {
    const user = userEvent.setup();
    render(<PopupApp adapter={createFixturePopupAdapter('connected')} />);
    const aiDomain = await screen.findByRole('button', { name: '人工智能' });
    await user.click(aiDomain);
    expect(aiDomain).toHaveClass('is-selected');

    await user.click(screen.getByRole('button', { name: '添加技术标签' }));
    await user.click(screen.getByRole('button', { name: 'Transformer' }));
    expect(screen.getByRole('button', { name: '移除 Transformer' })).toBeInTheDocument();
  });

  it('persists languages, domain, and tags across status refreshes', async () => {
    const user = userEvent.setup();
    render(<PopupApp adapter={createFixturePopupAdapter('connected')} />);

    await user.click(await screen.findByRole('button', { name: '选择翻译语言' }));
    await user.selectOptions(screen.getByLabelText('源语言'), 'auto');
    await user.selectOptions(screen.getByLabelText('目标语言'), 'ja');
    await user.click(screen.getByRole('button', { name: '人工智能' }));
    await user.click(screen.getByRole('button', { name: '添加技术标签' }));
    await user.click(screen.getByRole('button', { name: 'Transformer' }));

    expect(screen.getByLabelText('源语言')).toHaveValue('auto');
    expect(screen.getByLabelText('目标语言')).toHaveValue('ja');
    expect(screen.getByRole('button', { name: '人工智能' })).toHaveClass('is-selected');
    expect(screen.getByRole('button', { name: '移除 Transformer' })).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 850));

    expect(screen.getByLabelText('源语言')).toHaveValue('auto');
    expect(screen.getByLabelText('目标语言')).toHaveValue('ja');
    expect(screen.getByRole('button', { name: '人工智能' })).toHaveClass('is-selected');
    expect(screen.getByRole('button', { name: '移除 Transformer' })).toBeInTheDocument();
  });

  it('keeps the latest rapid preferences while polling and older saves are still pending', async () => {
    const user = userEvent.setup();
    const fixtureAdapter = createFixturePopupAdapter('connected');
    const initial = await fixtureAdapter.load();
    const stalePoll = createDeferred<PopupSnapshot>();
    const pendingSaves: {
      patch: TranslationPreferencePatch;
      response: ReturnType<typeof createDeferred<PopupSnapshot | undefined>>;
    }[] = [];
    let savedSnapshot = structuredClone(initial);
    let loadCount = 0;
    const adapter: PopupAdapter = {
      ...fixtureAdapter,
      load() {
        loadCount += 1;
        if (loadCount === 1) return Promise.resolve(structuredClone(initial));
        if (loadCount === 2) return stalePoll.promise;
        return Promise.resolve(structuredClone(savedSnapshot));
      },
      updatePreferences(patch) {
        const response = createDeferred<PopupSnapshot | undefined>();
        pendingSaves.push({ patch, response });
        return response.promise;
      },
    };

    render(<PopupApp adapter={adapter} />);
    await screen.findByRole('button', { name: '选择翻译语言' });
    await waitFor(() => expect(loadCount).toBe(2), { timeout: 2_000 });

    await user.click(screen.getByRole('button', { name: '选择翻译语言' }));
    await user.selectOptions(screen.getByLabelText('源语言'), 'auto');
    await user.selectOptions(screen.getByLabelText('目标语言'), 'ja');
    await user.click(screen.getByRole('button', { name: '人工智能' }));
    await user.click(screen.getByRole('button', { name: '添加技术标签' }));
    await user.click(screen.getByRole('button', { name: 'Transformer' }));

    const expectLatestSelection = () => {
      expect(screen.getByLabelText('源语言')).toHaveValue('auto');
      expect(screen.getByLabelText('目标语言')).toHaveValue('ja');
      expect(screen.getByRole('button', { name: '人工智能' })).toHaveClass('is-selected');
      expect(screen.getByRole('button', { name: '移除 Transformer' })).toBeInTheDocument();
    };
    expectLatestSelection();

    stalePoll.resolve(structuredClone(initial));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expectLatestSelection();

    for (let index = 0; index < 4; index += 1) {
      await waitFor(() => expect(pendingSaves).toHaveLength(index + 1));
      const pending = pendingSaves[index];
      if (pending === undefined) throw new Error(`Missing preference save ${index}`);
      savedSnapshot = applyPreferencePatch(savedSnapshot, pending.patch);
      pending.response.resolve(structuredClone(savedSnapshot));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expectLatestSelection();
    }

    await new Promise((resolve) => setTimeout(resolve, 800));
    expectLatestSelection();
  });

  it('renders complete scan diagnostics and discloses pending long-page batches', async () => {
    const fixtureAdapter = createFixturePopupAdapter('connected');
    const snapshot = await fixtureAdapter.load();
    const openSidePanel = vi.fn(() => Promise.resolve({ opened: true as const }));
    const adapter: PopupAdapter = {
      ...fixtureAdapter,
      openSidePanel,
      load: () =>
        Promise.resolve({
          ...snapshot,
          translationBatch: 3,
          hasMoreBatches: true,
          scanDiagnostics: {
            discoveredVisible: 212,
            eligible: 190,
            protected: 8,
            ignored: 10,
            queued: 160,
            completed: 141,
            failed: 2,
            stale: 3,
            overBudget: 24,
            unsupported: 4,
            cancelled: 0,
            notScanned: 6,
          },
        }),
    };

    const { container } = render(<PopupApp adapter={adapter} />);
    const report = await waitFor(() => {
      const element = container.querySelector<HTMLDetailsElement>('details.scan-report');
      expect(element).not.toBeNull();
      return element!;
    });

    const diagnosticValue = (label: string) =>
      [...report.querySelectorAll('dt')].find((term) => term.textContent === label)
        ?.nextElementSibling?.textContent;

    expect(report.querySelector('summary')).toHaveTextContent('160/190 已入队');
    expect(diagnosticValue('可见文本')).toBe('212');
    expect(diagnosticValue('合格节点')).toBe('190');
    expect(diagnosticValue('已入队')).toBe('160');
    expect(diagnosticValue('已完成')).toBe('141');
    expect(diagnosticValue('已保护')).toBe('8');
    expect(diagnosticValue('已忽略')).toBe('10');
    expect(diagnosticValue('翻译失败')).toBe('2');
    expect(diagnosticValue('动态过期')).toBe('3');
    expect(diagnosticValue('已取消')).toBe('0');
    expect(diagnosticValue('超出预算')).toBe('24');
    expect(diagnosticValue('未扫描')).toBe('6');
    expect(diagnosticValue('不支持')).toBe('4');
    expect(report).toHaveTextContent('全文续批中');
    expect(report).toHaveTextContent('正在处理第 3 批，完成后自动继续。');
    fireEvent.click(screen.getByRole('button', { name: '查看任务' }));
    expect(openSidePanel).toHaveBeenCalledTimes(1);
  });
});
