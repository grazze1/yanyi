import type { AssistantIntent } from '@yanyi/protocol';
import type { ConversationContext, SelectionContext } from '../assistant/types';

export interface SidePanelSelectionLaunch {
  selection: SelectionContext;
  context: ConversationContext;
  view: 'assistant' | 'notes';
  autoPrompt?: {
    key: string;
    prompt: string;
    intent: AssistantIntent;
  };
}

function selectionConversationContext(selection: SelectionContext): ConversationContext {
  return {
    selection: selection.text,
    title: selection.title,
    url: selection.url,
    tabId: selection.tabId,
    ...(selection.frameId === undefined ? {} : { frameId: selection.frameId }),
    capturedAt: selection.capturedAt,
    ...(selection.sentence === undefined ? {} : { sentence: selection.sentence }),
    ...(selection.adjacentText === undefined ? {} : { adjacentText: selection.adjacentText }),
    ...(selection.paragraph === undefined ? {} : { paragraph: selection.paragraph }),
    ...(selection.heading === undefined ? {} : { heading: selection.heading }),
    ...(selection.headingPath === undefined ? {} : { headingPath: selection.headingPath }),
    ...(selection.componentTitle === undefined ? {} : { componentTitle: selection.componentTitle }),
    ...(selection.componentText === undefined ? {} : { componentText: selection.componentText }),
    ...(selection.labels === undefined ? {} : { labels: selection.labels }),
    ...(selection.buttonText === undefined ? {} : { buttonText: selection.buttonText }),
    ...(selection.domRole === undefined ? {} : { domRole: selection.domRole }),
    ...(selection.domainId === undefined ? {} : { domainId: selection.domainId }),
    ...(selection.technicalTags === undefined ? {} : { technicalTags: selection.technicalTags }),
    ...(selection.glossaryRules === undefined ? {} : { glossaryRules: selection.glossaryRules }),
    ...(selection.contextHash === undefined ? {} : { contextHash: selection.contextHash }),
    ...(selection.pageSessionId === undefined ? {} : { pageSessionId: selection.pageSessionId }),
  };
}

function intentFromSelection(intent: string): AssistantIntent | undefined {
  if (intent === 'translate' || intent === 'explain') return intent;
  if (intent === 'follow-up' || intent === 'follow_up') return 'follow_up';
  return undefined;
}

/**
 * Converts only a freshly consumed background launch into Side Panel state.
 * Undefined means a normal/manual Side Panel open and must not mutate restored state.
 */
export function createSidePanelSelectionLaunch(
  selection: SelectionContext | undefined,
): SidePanelSelectionLaunch | undefined {
  if (selection === undefined) return undefined;

  const context = selectionConversationContext(selection);
  if (selection.intent === 'note') return { selection, context, view: 'notes' };

  const intent = intentFromSelection(selection.intent);
  const base: SidePanelSelectionLaunch = { selection, context, view: 'assistant' };
  if (intent !== 'translate' && intent !== 'explain') return base;

  return {
    ...base,
    autoPrompt: {
      key: `${selection.launchToken ?? String(selection.capturedAt)}:${intent}`,
      prompt:
        intent === 'translate'
          ? '请精确翻译当前选区。'
          : '请解释当前选区，并区分页面依据与背景补充。',
      intent,
    },
  };
}
