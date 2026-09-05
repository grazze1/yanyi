import { browser } from 'wxt/browser';
import { isProtocolEnvelope, type AssistantIntent, type TranslationProfile } from '@yanyi/protocol';
import { defaultModelProfiles, type KnowledgeMode } from '@yanyi/shared-types';
import type {
  ActiveConversationReference,
  AssistantAdapter,
  AssistantModelOption,
  AssistantModelSelection,
  AssistantStartRequest,
  AssistantStartResult,
  AssistantStreamEvent,
  ConversationCitation,
  ConversationContext,
  ConversationHandoff,
  ConversationMessage,
  RestoredConversation,
  SelectionContext,
} from './types';

const HANDOFF_STORAGE_KEY = 'yanyi.assistant.handoff.v1';
/**
 * Active conversations are stored per site origin. The pre-remediation build used
 * a single global key, which is why every site shared one thread and why a new
 * conversation was created whenever that key went stale.
 */
const ACTIVE_CONVERSATION_STORAGE_KEY = 'yanyi.assistant.active-conversation-by-site.v1';
const LEGACY_ACTIVE_CONVERSATION_KEY = 'yanyi.assistant.active-conversation.v1';
const MAX_HANDOFF_AGE_MS = 10 * 60 * 1_000;
/** Bounds the stored map so long browsing sessions cannot grow it without limit. */
const MAX_TRACKED_SITES = 100;

/**
 * Normalises a page URL to its origin (scheme + host + port).
 *
 * Distinct origins never share a conversation, and no fuzzy matching is used.
 * Returns undefined for URLs without a usable http(s) origin.
 */
export function siteOriginOf(pageUrl: string | undefined): string | undefined {
  if (pageUrl === undefined || pageUrl.trim() === '') return undefined;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.hostname === '') return undefined;
    return url.port === '' ? `${url.protocol}//${url.hostname}` : url.origin;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function knowledgeMode(value: unknown): KnowledgeMode | undefined {
  return value === 'hybrid' || value === 'page_only' || value === 'general' ? value : undefined;
}

function sanitizePageUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function parseActiveConversationReference(value: unknown): ActiveConversationReference | undefined {
  if (!isRecord(value)) return undefined;
  const conversationId = optionalString(value.conversationId);
  const mode = knowledgeMode(value.knowledgeMode);
  if (
    conversationId === undefined ||
    conversationId.length > 160 ||
    mode === undefined ||
    typeof value.savedAt !== 'number' ||
    !Number.isFinite(value.savedAt)
  )
    return undefined;
  return { conversationId, knowledgeMode: mode, savedAt: value.savedAt };
}

function parsePersistedConversationContext(value: unknown): ConversationContext | undefined {
  if (typeof value !== 'string' || value.length > 256_000) return undefined;
  try {
    const decoded: unknown = JSON.parse(value);
    if (!isRecord(decoded)) return undefined;
    const raw = isRecord(decoded.context) ? decoded.context : decoded;
    const selection = optionalString(raw.selection);
    if (selection === undefined) return undefined;
    const context: ConversationContext = { selection: selection.slice(0, 8_000) };
    const copyString = (
      sourceKey: string,
      targetKey: keyof ConversationContext,
      maximum: number,
    ) => {
      const parsed = optionalString(raw[sourceKey]);
      if (parsed !== undefined) Object.assign(context, { [targetKey]: parsed.slice(0, maximum) });
    };
    copyString('sentence', 'sentence', 2_000);
    copyString('paragraph', 'paragraph', 8_000);
    copyString('heading', 'heading', 500);
    copyString('componentTitle', 'componentTitle', 500);
    copyString('componentBody', 'componentText', 8_000);
    copyString('domRole', 'domRole', 80);
    copyString('domainId', 'domainId', 160);
    copyString('contextHash', 'contextHash', 160);
    copyString('title', 'title', 500);
    copyString('pageSessionId', 'pageSessionId', 160);
    const url = sanitizePageUrl(optionalString(raw.url));
    if (url !== undefined) context.url = url;
    const copyStrings = (
      sourceKey: string,
      targetKey: keyof ConversationContext,
      maximumItems: number,
      maximumCharacters: number,
    ) => {
      if (!Array.isArray(raw[sourceKey])) return;
      const values = raw[sourceKey]
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
        .slice(0, maximumItems)
        .map((item) => item.slice(0, maximumCharacters));
      if (values.length > 0) Object.assign(context, { [targetKey]: values });
    };
    copyStrings('sectionPath', 'headingPath', 12, 200);
    copyStrings('labels', 'labels', 32, 160);
    copyStrings('technicalTags', 'technicalTags', 32, 160);
    copyStrings('glossaryRules', 'glossaryRules', 64, 500);
    if (Array.isArray(raw.adjacentSentences)) {
      const adjacentText = raw.adjacentSentences
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 8)
        .join('\n')
        .slice(0, 8_000);
      if (adjacentText !== '') context.adjacentText = adjacentText;
    }
    if (Array.isArray(raw.buttons)) {
      const buttonText = raw.buttons.find(
        (item): item is string => typeof item === 'string' && item.trim() !== '',
      );
      if (buttonText !== undefined) context.buttonText = buttonText.slice(0, 500);
    }
    if (typeof raw.tabId === 'number' && Number.isSafeInteger(raw.tabId) && raw.tabId >= 0)
      context.tabId = raw.tabId;
    if (typeof raw.frameId === 'number' && Number.isSafeInteger(raw.frameId) && raw.frameId >= 0)
      context.frameId = raw.frameId;
    if (typeof raw.capturedAt === 'number' && Number.isFinite(raw.capturedAt))
      context.capturedAt = raw.capturedAt;
    return context;
  } catch {
    return undefined;
  }
}

function isSelectionContext(value: unknown): value is SelectionContext {
  if (!isRecord(value)) return false;
  return (
    typeof value.launchToken === 'string' &&
    value.launchToken.length > 0 &&
    typeof value.text === 'string' &&
    typeof value.title === 'string' &&
    typeof value.url === 'string' &&
    typeof value.isPdf === 'boolean' &&
    typeof value.intent === 'string' &&
    typeof value.tabId === 'number' &&
    typeof value.capturedAt === 'number'
  );
}

function isConversationHandoff(value: unknown): value is ConversationHandoff {
  if (!isRecord(value) || !isRecord(value.context) || !Array.isArray(value.messages)) return false;
  return (
    (value.knowledgeMode === 'hybrid' ||
      value.knowledgeMode === 'page_only' ||
      value.knowledgeMode === 'general') &&
    typeof value.context.selection === 'string' &&
    typeof value.capturedAt === 'number'
  );
}

function parseCitations(value: unknown): ConversationCitation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const citations = value.slice(0, 32).flatMap((citation, index): ConversationCitation[] => {
    if (!isRecord(citation)) return [];
    const title = optionalString(citation.title);
    const excerpt = optionalString(citation.excerpt);
    const source = citation.source;
    if (
      title === undefined ||
      excerpt === undefined ||
      (source !== 'page' && source !== 'workspace' && source !== 'general')
    )
      return [];
    const result: ConversationCitation = {
      id: optionalString(citation.id) ?? `citation-${String(index)}`,
      title: title.slice(0, 200),
      excerpt: excerpt.slice(0, 1_000),
      source,
    };
    const locator = optionalString(citation.locator);
    return locator === undefined ? [result] : [{ ...result, locator: locator.slice(0, 500) }];
  });
  return citations.length === 0 ? undefined : citations;
}

function parsePersistedCitations(value: unknown): ConversationCitation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const citations = value.slice(0, 32).flatMap((citation, index): ConversationCitation[] => {
    if (!isRecord(citation)) return [];
    const title = optionalString(citation.sourceTitle);
    const excerpt = optionalString(citation.sourceExcerpt);
    if (title === undefined || excerpt === undefined) return [];
    const sourceKind = optionalString(citation.sourceKind);
    const source =
      sourceKind === 'workspace'
        ? ('workspace' as const)
        : sourceKind === 'general_knowledge'
          ? ('general' as const)
          : ('page' as const);
    const locator = optionalString(citation.sourceId);
    const parsed: ConversationCitation = {
      id: optionalString(citation.id) ?? `restored-citation-${String(index)}`,
      title: title.slice(0, 200),
      excerpt: excerpt.slice(0, 1_000),
      source,
    };
    return locator === undefined ? [parsed] : [{ ...parsed, locator: locator.slice(0, 500) }];
  });
  return citations.length === 0 ? undefined : citations;
}

function parseRestoredMessage(value: unknown): ConversationMessage | undefined {
  if (!isRecord(value)) return undefined;
  const id = optionalString(value.id);
  const content = typeof value.content === 'string' ? value.content.slice(0, 256_000) : undefined;
  if (
    id === undefined ||
    content === undefined ||
    (value.role !== 'user' && value.role !== 'assistant')
  )
    return undefined;
  const intent: AssistantIntent =
    value.intent === 'translate' || value.intent === 'explain' || value.intent === 'follow_up'
      ? value.intent
      : 'follow_up';
  const persistedStatus = optionalString(value.generationStatus);
  const interrupted = persistedStatus === 'pending' || persistedStatus === 'streaming';
  const status =
    persistedStatus === 'completed'
      ? ('complete' as const)
      : persistedStatus === 'cancelled'
        ? ('cancelled' as const)
        : ('failed' as const);
  const parsedTime = typeof value.createdAt === 'string' ? Date.parse(value.createdAt) : Number.NaN;
  const citations = parsePersistedCitations(value.citations);
  return {
    id,
    role: value.role,
    content,
    status,
    intent,
    createdAt: Number.isFinite(parsedTime) ? parsedTime : 0,
    ...(citations === undefined ? {} : { citations }),
    ...(interrupted
      ? { error: '上次生成在浏览器关闭时中断，请重试。' }
      : status === 'failed'
        ? { error: '此前回答生成失败，可重试。' }
        : status === 'cancelled'
          ? { error: '此前生成已停止。' }
          : {}),
  };
}

function parseReasoningEfforts(value: unknown): ('high' | 'max')[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (effort): effort is 'high' | 'max' => effort === 'high' || effort === 'max',
    );
  } catch {
    return [];
  }
}

function parseModelOption(value: unknown): AssistantModelOption | undefined {
  if (!isRecord(value)) return undefined;
  const providerId = optionalString(value.providerId);
  const modelId = optionalString(value.modelId);
  const owner = optionalString(value.owner);
  if (
    providerId === undefined ||
    modelId === undefined ||
    owner === undefined ||
    (value.availability !== 'available' &&
      value.availability !== 'unavailable' &&
      value.availability !== 'unknown') ||
    (value.capabilityStatus !== 'verified' &&
      value.capabilityStatus !== 'unverified' &&
      value.capabilityStatus !== 'manual')
  )
    return undefined;
  return {
    providerId,
    modelId,
    owner,
    availability: value.availability,
    capabilityStatus: value.capabilityStatus,
    reasoningEfforts: parseReasoningEfforts(value.reasoningEffortsJson),
    ...(typeof value.supportsThinking === 'boolean'
      ? { supportsThinking: value.supportsThinking }
      : {}),
    ...(typeof value.supportsStreaming === 'boolean'
      ? { supportsStreaming: value.supportsStreaming }
      : {}),
    ...(typeof value.supportsJsonOutput === 'boolean'
      ? { supportsJsonOutput: value.supportsJsonOutput }
      : {}),
    ...(typeof value.supportsTools === 'boolean' ? { supportsTools: value.supportsTools } : {}),
    ...(typeof value.contextWindow === 'number' ? { contextWindow: value.contextWindow } : {}),
  };
}

function parseModelSelection(value: unknown): AssistantModelSelection | undefined {
  if (!isRecord(value)) return undefined;
  const scope = value.scope;
  const scopeId = optionalString(value.scopeId);
  const task = optionalString(value.task);
  const providerId = optionalString(value.providerId);
  const modelId = optionalString(value.modelId);
  if (
    (scope !== 'global' && scope !== 'task' && scope !== 'conversation') ||
    scopeId === undefined ||
    task === undefined ||
    providerId === undefined ||
    modelId === undefined ||
    typeof value.thinkingEnabled !== 'boolean'
  )
    return undefined;
  const reasoningEffort =
    value.reasoningEffort === 'high' || value.reasoningEffort === 'max'
      ? value.reasoningEffort
      : undefined;
  const apiProfileId = optionalString(value.apiProfileId);
  return {
    scope,
    scopeId,
    task,
    providerId,
    modelId,
    thinkingEnabled: value.thinkingEnabled,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(apiProfileId === undefined ? {} : { apiProfileId }),
  };
}

type ActiveConversationMap = Record<string, ActiveConversationReference>;

/**
 * Reads the origin-keyed map, discarding malformed entries and migrating away
 * from the single-key legacy layout (whose value cannot be attributed to a site).
 */
async function readActiveConversationMap(): Promise<ActiveConversationMap> {
  const stored = await browser.storage.local.get([
    ACTIVE_CONVERSATION_STORAGE_KEY,
    LEGACY_ACTIVE_CONVERSATION_KEY,
  ]);
  if (stored[LEGACY_ACTIVE_CONVERSATION_KEY] !== undefined) {
    await browser.storage.local.remove(LEGACY_ACTIVE_CONVERSATION_KEY);
  }
  const raw = stored[ACTIVE_CONVERSATION_STORAGE_KEY];
  if (!isRecord(raw)) return {};
  const map: ActiveConversationMap = {};
  for (const [origin, value] of Object.entries(raw)) {
    if (siteOriginOf(origin) !== origin) continue;
    const reference = parseActiveConversationReference(value);
    if (reference !== undefined) map[origin] = reference;
  }
  return map;
}

/** Returns the map without one origin, leaving every other site untouched. */
function withoutOrigin(map: ActiveConversationMap, origin: string): ActiveConversationMap {
  return Object.fromEntries(Object.entries(map).filter(([key]) => key !== origin));
}

async function writeActiveConversationMap(map: ActiveConversationMap): Promise<void> {
  const entries = Object.entries(map)
    .sort(([, left], [, right]) => right.savedAt - left.savedAt)
    .slice(0, MAX_TRACKED_SITES);
  if (entries.length === 0) {
    await browser.storage.local.remove(ACTIVE_CONVERSATION_STORAGE_KEY);
    return;
  }
  await browser.storage.local.set({
    [ACTIVE_CONVERSATION_STORAGE_KEY]: Object.fromEntries(entries),
  });
}

function fallbackModelCatalog(): AssistantModelOption[] {
  return [...new Set(defaultModelProfiles.map(({ model }) => model))].map((modelId) => ({
    providerId: 'deepseek',
    modelId,
    owner: 'deepseek',
    availability: 'unknown',
    capabilityStatus: 'unverified',
    reasoningEfforts: [],
  }));
}

function streamEventFromMessage(message: unknown): AssistantStreamEvent | undefined {
  if (!isRecord(message) || message.type !== 'yanyi.assistant.event') return undefined;
  const envelope = message.event;
  if (!isProtocolEnvelope(envelope)) return undefined;
  const payload = envelope.payload;
  const taskId = optionalString(payload.taskId);
  if (taskId === undefined) return undefined;
  const conversationId = optionalString(payload.conversationId);
  const knowledgeMode =
    payload.knowledgeMode === 'hybrid' ||
    payload.knowledgeMode === 'page_only' ||
    payload.knowledgeMode === 'general'
      ? payload.knowledgeMode
      : undefined;
  if (envelope.type === 'assistant.accepted') {
    const event: AssistantStreamEvent = { type: 'accepted', taskId };
    return {
      ...event,
      ...(conversationId === undefined ? {} : { conversationId }),
      ...(knowledgeMode === undefined ? {} : { knowledgeMode }),
    };
  }
  if (envelope.type === 'assistant.delta') {
    return {
      type: 'delta',
      taskId,
      delta: typeof payload.delta === 'string' ? payload.delta : '',
      ...(conversationId === undefined ? {} : { conversationId }),
    };
  }
  if (envelope.type === 'assistant.completed') {
    const citations = parseCitations(payload.citations);
    return {
      type: 'completed',
      taskId,
      answer: typeof payload.answer === 'string' ? payload.answer : '',
      ...(conversationId === undefined ? {} : { conversationId }),
      ...(knowledgeMode === undefined ? {} : { knowledgeMode }),
      ...(citations === undefined ? {} : { citations }),
    };
  }
  if (envelope.type === 'assistant.failed') {
    const error = isRecord(payload.error) ? payload.error : undefined;
    return {
      type: 'failed',
      taskId,
      message: optionalString(error?.message) ?? '回答生成失败，请检查本地服务后重试。',
      ...(conversationId === undefined ? {} : { conversationId }),
    };
  }
  if (envelope.type === 'assistant.cancelled') {
    return {
      type: 'cancelled',
      taskId,
      ...(conversationId === undefined ? {} : { conversationId }),
    };
  }
  return undefined;
}

export function assistantProfileForIntent(intent: AssistantIntent): TranslationProfile {
  const profileId =
    intent === 'translate' ? 'precise' : intent === 'explain' ? 'explain' : 'deep-follow-up';
  const profile = defaultModelProfiles.find((candidate) => candidate.id === profileId);
  if (profile === undefined) throw new Error(`缺少助手模型预设：${profileId}`);
  return {
    model: profile.model,
    thinking: profile.thinking,
    ...(profile.reasoningEffort === undefined ? {} : { reasoningEffort: profile.reasoningEffort }),
    maxOutputTokens: intent === 'translate' ? 4_096 : 8_192,
    streaming: true,
  };
}

function requestContext(context: ConversationContext) {
  const url = sanitizePageUrl(context.url);
  return {
    selection: context.selection.slice(0, 8_000),
    ...(context.sentence === undefined ? {} : { sentence: context.sentence.slice(0, 2_000) }),
    ...(context.adjacentText === undefined
      ? {}
      : { adjacentSentences: [context.adjacentText.slice(0, 4_000)] }),
    ...(context.paragraph === undefined ? {} : { paragraph: context.paragraph.slice(0, 8_000) }),
    ...(context.heading === undefined ? {} : { heading: context.heading.slice(0, 500) }),
    ...(context.headingPath === undefined
      ? {}
      : { sectionPath: context.headingPath.slice(0, 12).map((item) => item.slice(0, 200)) }),
    ...(context.componentTitle === undefined
      ? {}
      : { componentTitle: context.componentTitle.slice(0, 500) }),
    ...(context.componentText === undefined
      ? {}
      : { componentBody: context.componentText.slice(0, 8_000) }),
    ...(context.labels === undefined
      ? {}
      : { labels: context.labels.slice(0, 32).map((item) => item.slice(0, 160)) }),
    ...(context.buttonText === undefined ? {} : { buttons: [context.buttonText.slice(0, 500)] }),
    ...(context.domRole === undefined ? {} : { domRole: context.domRole.slice(0, 80) }),
    ...(context.domainId === undefined ? {} : { domainId: context.domainId.slice(0, 160) }),
    ...(context.technicalTags === undefined
      ? {}
      : { technicalTags: context.technicalTags.slice(0, 32).map((item) => item.slice(0, 160)) }),
    ...(context.glossaryRules === undefined
      ? {}
      : { glossaryRules: context.glossaryRules.slice(0, 64).map((item) => item.slice(0, 500)) }),
    ...(context.contextHash === undefined
      ? {}
      : { contextHash: context.contextHash.slice(0, 160) }),
    ...(context.title === undefined ? {} : { title: context.title.slice(0, 500) }),
    ...(context.pageSessionId === undefined
      ? {}
      : { pageSessionId: context.pageSessionId.slice(0, 160) }),
    ...(context.tabId === undefined ? {} : { tabId: context.tabId }),
    ...(context.frameId === undefined ? {} : { frameId: context.frameId }),
    ...(context.capturedAt === undefined ? {} : { capturedAt: context.capturedAt }),
    ...(url === undefined ? {} : { url }),
  };
}

export function createBrowserAssistantAdapter(): AssistantAdapter {
  return {
    async start(request: AssistantStartRequest): Promise<AssistantStartResult> {
      const siteOrigin = request.siteOrigin ?? siteOriginOf(request.context.url);
      const payload = {
        intent: request.intent,
        prompt: request.prompt.slice(0, 8_000),
        context: requestContext(request.context),
        profile: request.profile,
        knowledgeMode: request.knowledgeMode,
        ...(request.conversationId === undefined ? {} : { conversationId: request.conversationId }),
        ...(request.transientMessages === undefined
          ? {}
          : { transientMessages: request.transientMessages }),
        // The host re-derives and validates this against the page URL; it is a hint,
        // not a trusted value.
        ...(siteOrigin === undefined ? {} : { siteOrigin }),
      };
      const response: unknown = await browser.runtime
        .sendMessage({ type: 'yanyi.assistant.start', payload })
        .catch(() => undefined);
      if (!isRecord(response) || response.accepted !== true) {
        return {
          accepted: false,
          error:
            optionalString(isRecord(response) ? response.error : undefined) ??
            '本地服务未连接，问题尚未发送。',
        };
      }
      const taskId = optionalString(response.taskId);
      if (taskId === undefined) return { accepted: false, error: '本地服务未返回任务标识。' };
      const result: AssistantStartResult = { accepted: true, taskId };
      const conversationId = optionalString(response.conversationId);
      return conversationId === undefined ? result : { ...result, conversationId };
    },
    async cancel(taskId) {
      const response: unknown = await browser.runtime
        .sendMessage({ type: 'yanyi.assistant.cancel', taskId })
        .catch(() => undefined);
      return isRecord(response) && response.accepted === true;
    },
    subscribe(listener) {
      const onMessage = (message: unknown) => {
        const event = streamEventFromMessage(message);
        if (event !== undefined) listener(event);
      };
      browser.runtime.onMessage.addListener(onMessage);
      return () => browser.runtime.onMessage.removeListener(onMessage);
    },
    async consumeSelection() {
      const response: unknown = await browser.runtime
        .sendMessage({ type: 'yanyi.selection.consume' })
        .catch(() => undefined);
      if (!isRecord(response) || !isSelectionContext(response.context)) return undefined;
      return response.context;
    },
    async loadHandoff() {
      const stored = await browser.storage.session.get(HANDOFF_STORAGE_KEY);
      const handoff = stored[HANDOFF_STORAGE_KEY];
      if (!isConversationHandoff(handoff)) return undefined;
      await browser.storage.session.remove(HANDOFF_STORAGE_KEY);
      if (Date.now() - handoff.capturedAt > MAX_HANDOFF_AGE_MS) return undefined;
      return handoff;
    },
    async saveHandoff(handoff) {
      const bounded: ConversationHandoff = {
        ...handoff,
        messages: handoff.messages.slice(-50).map((message) => ({
          ...message,
          content: message.content.slice(0, 64_000),
        })),
      };
      await browser.storage.session.set({ [HANDOFF_STORAGE_KEY]: bounded });
    },
    async loadActiveConversation(pageUrl) {
      const origin = siteOriginOf(pageUrl);
      if (origin === undefined) return undefined;
      const map = await readActiveConversationMap();
      return map[origin];
    },
    async saveActiveConversation(reference, pageUrl) {
      const origin = siteOriginOf(pageUrl);
      if (origin === undefined) return;
      const map = await readActiveConversationMap();
      await writeActiveConversationMap(
        reference === undefined
          ? withoutOrigin(map, origin)
          : {
              ...map,
              [origin]: {
                conversationId: reference.conversationId.slice(0, 160),
                knowledgeMode: reference.knowledgeMode,
                savedAt: reference.savedAt,
              },
            },
      );
    },
    async clearActiveConversation(pageUrl) {
      const origin = siteOriginOf(pageUrl);
      if (origin === undefined) return;
      const map = await readActiveConversationMap();
      await writeActiveConversationMap(withoutOrigin(map, origin));
      // Also clear the durable binding so the host starts a new thread.
      await browser.runtime
        .sendMessage({ type: 'yanyi.conversation.site.new', siteOrigin: origin })
        .catch(() => undefined);
    },
    async loadConversation(conversationId): Promise<RestoredConversation | undefined> {
      if (conversationId.trim() === '' || conversationId.length > 160) return undefined;
      const messages: ConversationMessage[] = [];
      const messageIds = new Set<string>();
      let mode: KnowledgeMode = 'hybrid';
      let context: ConversationContext | undefined;
      let found = false;
      let messageOffset = 0;
      for (let page = 0; page < 50 && messages.length < 10_000; page += 1) {
        const response: unknown = await browser.runtime
          .sendMessage({
            type: 'yanyi.conversation.get',
            conversationId,
            messageOffset,
            messageLimit: 200,
          })
          .catch(() => undefined);
        if (!isRecord(response) || !isProtocolEnvelope(response.event)) return undefined;
        const event = response.event;
        if (event.type !== 'conversation.get.ready' || !isRecord(event.payload)) return undefined;
        const detail = event.payload.conversation;
        if (!isRecord(detail) || !isRecord(detail.conversation)) return undefined;
        if (optionalString(detail.conversation.id) !== conversationId) return undefined;
        found = true;
        mode = knowledgeMode(detail.conversation.knowledgeMode) ?? mode;
        context ??= parsePersistedConversationContext(detail.resumeContextJson);
        const rawMessages = Array.isArray(detail.messages) ? detail.messages : [];
        for (const rawMessage of rawMessages) {
          const message = parseRestoredMessage(rawMessage);
          if (message !== undefined && !messageIds.has(message.id)) {
            messageIds.add(message.id);
            messages.push(message);
          }
        }
        messageOffset += rawMessages.length;
        if (detail.hasMore !== true || rawMessages.length === 0) break;
      }
      return found && context !== undefined
        ? { conversationId, knowledgeMode: mode, context, messages }
        : undefined;
    },
    async openSidePanel() {
      const response: unknown = await browser.runtime
        .sendMessage({ type: 'yanyi.sidepanel.open' })
        .catch(() => undefined);
      return isRecord(response) && response.accepted === true;
    },
    async highlightSource(context, excerpt) {
      if (context.tabId === undefined) return false;
      const response: unknown = await browser.tabs
        .sendMessage(context.tabId, {
          type: 'yanyi.source.highlight',
          excerpt: excerpt.slice(0, 200),
        })
        .catch(() => undefined);
      return isRecord(response) && response.highlighted === true;
    },
    async saveNote(content, sourceExcerpt) {
      const response: unknown = await browser.runtime
        .sendMessage({
          type: 'yanyi.note.create',
          payload: {
            content: content.slice(0, 16_000),
            ...(sourceExcerpt === undefined
              ? {}
              : { sourceExcerpt: sourceExcerpt.slice(0, 2_000) }),
          },
        })
        .catch(() => undefined);
      return isRecord(response) && response.accepted === true;
    },
    async saveGlossary(sourceTerm, targetTerm) {
      const response: unknown = await browser.runtime
        .sendMessage({
          type: 'yanyi.glossary.quick-add',
          payload: {
            sourceTerm: sourceTerm.slice(0, 160),
            targetTerm: targetTerm.slice(0, 500),
            strategy: 'fixed',
            scope: 'current_site',
          },
        })
        .catch(() => undefined);
      return isRecord(response) && response.accepted === true;
    },
    async protectTerm(sourceTerm) {
      const response: unknown = await browser.runtime
        .sendMessage({
          type: 'yanyi.glossary.quick-add',
          payload: {
            sourceTerm: sourceTerm.slice(0, 160),
            strategy: 'never_translate',
            scope: 'current_site',
          },
        })
        .catch(() => undefined);
      return isRecord(response) && response.accepted === true;
    },
    async loadModelCatalog(providerId = 'deepseek', refresh = false) {
      const response: unknown = await browser.runtime
        .sendMessage({ type: 'yanyi.model.catalog.get', providerId, refresh })
        .catch(() => undefined);
      if (!isRecord(response) || response.accepted !== true || !Array.isArray(response.models))
        return fallbackModelCatalog();
      const models = response.models.flatMap((model): AssistantModelOption[] => {
        const parsed = parseModelOption(model);
        return parsed === undefined ? [] : [parsed];
      });
      return models.length === 0 ? fallbackModelCatalog() : models;
    },
    async loadModelSelection(conversationId, task) {
      const response: unknown = await browser.runtime
        .sendMessage({
          type: 'yanyi.model.selection.get',
          task,
          ...(conversationId === undefined ? {} : { conversationId }),
        })
        .catch(() => undefined);
      if (!isRecord(response) || response.accepted !== true) return undefined;
      return parseModelSelection(response.selection);
    },
    async saveModelSelection(selection) {
      const response: unknown = await browser.runtime
        .sendMessage({ type: 'yanyi.model.selection.set', payload: selection })
        .catch(() => undefined);
      return isRecord(response) && response.accepted === true;
    },
    async verifyModelCapability(
      providerId,
      modelId,
      probeThinking,
    ): Promise<{ status?: string; message?: string; models?: AssistantModelOption[] }> {
      const response: unknown = await browser.runtime
        .sendMessage({
          type: 'yanyi.model.capability.verify',
          providerId,
          modelId,
          probeThinking,
        })
        .catch(() => undefined);
      if (!isRecord(response) || response.accepted !== true) {
        return { message: '验证请求未送达本地服务，模型状态未改变。' };
      }
      const models = Array.isArray(response.models)
        ? response.models.flatMap((model): AssistantModelOption[] => {
            const parsed = parseModelOption(model);
            return parsed === undefined ? [] : [parsed];
          })
        : [];
      const status = optionalString(response.status);
      const message = optionalString(response.message);
      return {
        ...(status === undefined ? {} : { status }),
        ...(message === undefined ? {} : { message }),
        models,
      };
    },
    async loadTerminalEvent(taskId) {
      const response: unknown = await browser.runtime
        .sendMessage({ type: 'yanyi.assistant.terminal.get', taskId })
        .catch(() => undefined);
      if (!isRecord(response) || response.event === undefined) return undefined;
      return streamEventFromMessage({ type: 'yanyi.assistant.event', event: response.event });
    },
  };
}
