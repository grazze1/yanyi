import { browser } from 'wxt/browser';
import {
  defaultTranslationPreferences,
  type PopupSnapshot,
  type TranslationPreferencePatch,
} from '@yanyi/shared-types';
import { openSidePanelWithGesture, type SidePanelOpenOutcome } from '../sidepanel/openSidePanel';

export interface PopupAdapter {
  load: () => Promise<PopupSnapshot>;
  startTranslation: () => Promise<boolean>;
  pauseTranslation: () => Promise<boolean>;
  resumeTranslation: () => Promise<boolean>;
  cancelTranslation: () => Promise<boolean>;
  restoreTranslation: () => Promise<boolean>;
  updatePreferences: (patch: TranslationPreferencePatch) => Promise<PopupSnapshot | undefined>;
  openSidePanel: () => Promise<SidePanelOpenOutcome>;
  openOptions: (section: string) => Promise<void>;
}

interface StatusResponse {
  snapshot: PopupSnapshot;
}

function isStatusResponse(value: unknown): value is StatusResponse {
  return typeof value === 'object' && value !== null && 'snapshot' in value;
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

export function createBrowserPopupAdapter(): PopupAdapter {
  return {
    async load() {
      try {
        const tabId = await activeTabId();
        const response: unknown = await browser.runtime.sendMessage({
          type: 'yanyi.status.get',
          tabId,
        });
        if (!isStatusResponse(response)) throw new Error('Invalid background status response');
        return response.snapshot;
      } catch {
        return {
          ...defaultTranslationPreferences,
          connection: 'offline',
          page: 'ready',
          completedSegments: 0,
          totalSegments: 0,
          message: '无法连接本地服务，请启动研译本地端后重试。',
        };
      }
    },
    async startTranslation() {
      const tabId = await activeTabId();
      const response: { accepted: boolean } = await browser.runtime.sendMessage({
        type: 'yanyi.translation.start',
        tabId,
      });
      return response.accepted;
    },
    async pauseTranslation() {
      const tabId = await activeTabId();
      const response: { accepted: boolean } = await browser.runtime.sendMessage({
        type: 'yanyi.translation.pause',
        tabId,
      });
      return response.accepted;
    },
    async cancelTranslation() {
      const tabId = await activeTabId();
      const response: { accepted: boolean } = await browser.runtime.sendMessage({
        type: 'yanyi.translation.cancel',
        tabId,
      });
      return response.accepted;
    },
    async resumeTranslation() {
      const tabId = await activeTabId();
      const response: { accepted: boolean } = await browser.runtime.sendMessage({
        type: 'yanyi.translation.resume',
        tabId,
      });
      return response.accepted;
    },
    async restoreTranslation() {
      const tabId = await activeTabId();
      const response: { accepted: boolean } = await browser.runtime.sendMessage({
        type: 'yanyi.translation.restore',
        tabId,
      });
      return response.accepted;
    },
    async updatePreferences(patch) {
      const tabId = await activeTabId();
      const response: unknown = await browser.runtime.sendMessage({
        type: 'yanyi.translation.preferences.update',
        tabId,
        patch,
      });
      return isStatusResponse(response) ? response.snapshot : undefined;
    },
    async openSidePanel() {
      // Must run inside the popup's own click handler: sidePanel.open() requires a
      // user gesture, and a round trip through the service worker discards it.
      return openSidePanelWithGesture({
        open: (options) => browser.sidePanel.open(options),
        currentWindowId: async () => {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (tab?.windowId !== undefined) return tab.windowId;
          const current = await browser.windows.getCurrent().catch(() => undefined);
          return current?.id;
        },
      });
    },
    async openOptions(section) {
      // Store the target section before opening so the options page reads it on load.
      await browser.storage.session.set({ yanyiOptionsSection: section });
      await browser.runtime.openOptionsPage();
    },
  };
}
