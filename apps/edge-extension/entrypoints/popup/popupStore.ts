import { create } from 'zustand';
import type { PopupSnapshot, TranslationPreferencePatch } from '@yanyi/shared-types';

interface PopupStore {
  snapshot?: PopupSnapshot;
  busy: boolean;
  setSnapshot: (snapshot: PopupSnapshot) => void;
  setBusy: (busy: boolean) => void;
  updatePreferences: (patch: TranslationPreferencePatch) => void;
}

export const usePopupStore = create<PopupStore>((set) => ({
  busy: true,
  setSnapshot: (snapshot) => set({ snapshot, busy: false }),
  setBusy: (busy) => set({ busy }),
  updatePreferences: (patch) =>
    set((state) =>
      state.snapshot === undefined
        ? state
        : {
            snapshot: {
              ...state.snapshot,
              ...patch,
              tags: patch.tags === undefined ? state.snapshot.tags : [...patch.tags],
            },
          },
    ),
}));
