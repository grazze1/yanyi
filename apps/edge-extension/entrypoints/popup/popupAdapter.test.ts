import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { popupFixtures } from '@yanyi/test-fixtures';
import { createBrowserPopupAdapter } from './popupAdapter';

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn(),
      openOptionsPage: vi.fn(),
    },
    storage: { session: { set: vi.fn() } },
    tabs: { query: vi.fn() },
  },
}));

describe('createBrowserPopupAdapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the active page tab id to the background translation request', async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 73 }] as never);
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ accepted: true } as never);

    await expect(createBrowserPopupAdapter().startTranslation()).resolves.toBe(true);
    expect(browser.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'yanyi.translation.start',
      tabId: 73,
    });
  });

  it('loads and updates the authoritative preferences for the active tab', async () => {
    const snapshot = popupFixtures.connected;
    if (snapshot === undefined) throw new Error('Missing fixture');
    vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 73 }] as never);
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ snapshot } as never)
      .mockResolvedValueOnce({
        accepted: true,
        snapshot: { ...snapshot, targetLanguage: 'ja' },
      } as never);
    const adapter = createBrowserPopupAdapter();

    await expect(adapter.load()).resolves.toEqual(snapshot);
    await expect(adapter.updatePreferences({ targetLanguage: 'ja' })).resolves.toMatchObject({
      targetLanguage: 'ja',
    });
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      type: 'yanyi.status.get',
      tabId: 73,
    });
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'yanyi.translation.preferences.update',
      tabId: 73,
      patch: { targetLanguage: 'ja' },
    });
  });

  it('scopes pause, resume, cancel, and restore controls to the active tab', async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 73 }] as never);
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ accepted: true } as never);
    const adapter = createBrowserPopupAdapter();

    await expect(adapter.pauseTranslation()).resolves.toBe(true);
    await expect(adapter.resumeTranslation()).resolves.toBe(true);
    await expect(adapter.cancelTranslation()).resolves.toBe(true);
    await expect(adapter.restoreTranslation()).resolves.toBe(true);

    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      type: 'yanyi.translation.pause',
      tabId: 73,
    });
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'yanyi.translation.resume',
      tabId: 73,
    });
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(3, {
      type: 'yanyi.translation.cancel',
      tabId: 73,
    });
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(4, {
      type: 'yanyi.translation.restore',
      tabId: 73,
    });
  });
});
