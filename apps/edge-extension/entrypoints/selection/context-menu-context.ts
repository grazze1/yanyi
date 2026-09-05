import type { SelectionContext } from '../assistant/types';

interface ContextMenuTab {
  id: number;
  title?: string;
  url?: string;
}

export interface BuildContextMenuSelectionInput {
  locatedContext: unknown;
  canLocateSelection: boolean;
  fallbackText?: string;
  intent: string;
  tab: ContextMenuTab;
  frameId: number;
  capturedAt: number;
}

export interface ContextMenuSelectionResult {
  context: SelectionContext;
  /** True only when the content frame returned a real selection Range anchor. */
  canLocateSelection: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function boundedString(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim().slice(0, maximum);
  return result.length === 0 ? undefined : result;
}

function boundedStrings(value: unknown, count: number, maximum: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.slice(0, count).flatMap((item) => {
    const parsed = boundedString(item, maximum);
    return parsed === undefined ? [] : [parsed];
  });
  return result.length === 0 ? undefined : result;
}

/**
 * Normalizes the content-frame selection response and the browser-provided
 * `selectionText` fallback into the single persisted selection contract.
 */
export function buildContextMenuSelection(
  input: BuildContextMenuSelectionInput,
): ContextMenuSelectionResult | undefined {
  const located = isRecord(input.locatedContext) ? input.locatedContext : {};
  const locatedText = boundedString(located.text, 8_000);
  const fallbackText = boundedString(input.fallbackText, 8_000);
  const text = locatedText ?? fallbackText;
  if (text === undefined) return undefined;

  const title =
    boundedString(located.title, 500) ?? boundedString(input.tab.title, 500) ?? '浏览器选区';
  const url = boundedString(located.url, 4_000) ?? boundedString(input.tab.url, 4_000) ?? '';
  const sentence = boundedString(located.sentence, 2_000) ?? text.slice(0, 2_000);
  const paragraph = boundedString(located.paragraph, 8_000) ?? text;
  const adjacentText = boundedString(located.adjacentText, 4_000);
  const heading = boundedString(located.heading, 500) ?? title;
  const headingPath = boundedStrings(located.headingPath, 12, 240) ?? [];
  const labels = boundedStrings(located.labels, 32, 160) ?? [];
  const technicalTags = boundedStrings(located.technicalTags, 32, 160);
  const glossaryRules = boundedStrings(located.glossaryRules, 64, 500);
  const componentTitle = boundedString(located.componentTitle, 500);
  const componentText = boundedString(located.componentText, 8_000);
  const buttonText = boundedString(located.buttonText, 500);
  const domRole = boundedString(located.domRole, 80) ?? 'text';
  const domainId = boundedString(located.domainId, 160);
  const contextHash = boundedString(located.contextHash, 160);
  const pageSessionId = boundedString(located.pageSessionId, 160);
  const isPdf =
    typeof located.isPdf === 'boolean'
      ? located.isPdf
      : /\.pdf(?:$|[?#])/iu.test(input.tab.url ?? '');

  return {
    canLocateSelection: input.canLocateSelection && locatedText !== undefined,
    context: {
      text,
      sentence,
      ...(adjacentText === undefined ? {} : { adjacentText }),
      paragraph,
      heading,
      headingPath,
      ...(componentTitle === undefined ? {} : { componentTitle }),
      ...(componentText === undefined ? {} : { componentText }),
      labels,
      ...(buttonText === undefined ? {} : { buttonText }),
      domRole,
      ...(domainId === undefined ? {} : { domainId }),
      ...(technicalTags === undefined ? {} : { technicalTags }),
      ...(glossaryRules === undefined ? {} : { glossaryRules }),
      ...(contextHash === undefined ? {} : { contextHash }),
      title,
      url,
      isPdf,
      intent: input.intent,
      tabId: input.tab.id,
      frameId: input.frameId,
      capturedAt: input.capturedAt,
      ...(pageSessionId === undefined ? {} : { pageSessionId }),
    },
  };
}
