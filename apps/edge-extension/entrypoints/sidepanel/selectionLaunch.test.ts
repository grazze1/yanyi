import { describe, expect, it } from 'vitest';
import type { ConversationContext, SelectionContext } from '../assistant/types';
import { createSidePanelSelectionLaunch } from './selectionLaunch';

const selection: SelectionContext = {
  launchToken: '10000000-0000-4000-8000-000000000001',
  text: 'The controller remains stable.',
  title: 'Technical report',
  url: 'https://example.com/report',
  isPdf: false,
  intent: 'explain',
  tabId: 73,
  capturedAt: 1_700_000_000_000,
};

describe('createSidePanelSelectionLaunch', () => {
  it('does not overwrite restored context or replay a prompt on a manual reopen', () => {
    const restored: ConversationContext = {
      selection: 'Previously restored selection',
      title: 'Existing conversation',
    };
    const launch = createSidePanelSelectionLaunch(undefined);

    expect(launch).toBeUndefined();
    expect(launch?.context ?? restored).toBe(restored);
    expect(launch?.autoPrompt).toBeUndefined();
  });

  it('uses the one-shot launch token as the automatic prompt identity', () => {
    expect(createSidePanelSelectionLaunch(selection)).toEqual(
      expect.objectContaining({
        view: 'assistant',
        context: expect.objectContaining({ selection: selection.text }),
        autoPrompt: {
          key: `${selection.launchToken}:explain`,
          prompt: '请解释当前选区，并区分页面依据与背景补充。',
          intent: 'explain',
        },
      }),
    );
  });
});
