import { popupFixtures } from '@yanyi/test-fixtures';
import type { PopupAdapter } from './popupAdapter';

export function createFixturePopupAdapter(fixtureName: string): PopupAdapter {
  const snapshot = popupFixtures[fixtureName] ?? popupFixtures.connected;
  if (snapshot === undefined) throw new Error('Missing connected popup fixture');
  let current = structuredClone(snapshot);
  return {
    load: () => Promise.resolve(structuredClone(current)),
    startTranslation: () => Promise.resolve(true),
    pauseTranslation: () => Promise.resolve(true),
    resumeTranslation: () => Promise.resolve(true),
    cancelTranslation: () => Promise.resolve(true),
    restoreTranslation: () => Promise.resolve(true),
    updatePreferences: (patch) => {
      current = {
        ...current,
        ...patch,
        tags: patch.tags === undefined ? current.tags : [...patch.tags],
      };
      return Promise.resolve(structuredClone(current));
    },
    openSidePanel: () => Promise.resolve({ opened: true }),
    openOptions: () => Promise.resolve(),
  };
}
