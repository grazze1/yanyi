import { browser } from 'wxt/browser';
import {
  createEnvelope,
  isProtocolEnvelope,
  PROTOCOL_VERSION,
  type HandshakeReady,
  type AssistantStartPayload,
  type MessageType,
  type PageTranslationProfile,
  type ProtocolEnvelope,
  type ScanDiagnostics,
  type TranslationScanReportPayload,
  type TranslationSegmentEventPayload,
  type TranslationSegmentInput,
  type TranslationProfile,
  type TranslationStartPayload,
} from '@yanyi/protocol';
import {
  defaultModelProfiles,
  defaultTranslationPreferences,
  domainIdForName,
  type PopupSnapshot,
  type TranslationPreferencePatch,
  type TranslationPreferences,
} from '@yanyi/shared-types';
import {
  applySegmentCommitToCache,
  createQueuedTask,
  idleTaskState,
  reduceSegmentCommitAck,
  reduceTaskEvent,
  type ExtensionTaskState,
  type SegmentCommitAck,
} from './translation/taskReducer';
import { loadEphemeralRoute, persistEphemeralRoute } from './translation/route-storage';
import { ContentScriptInjector } from './translation/content-script-injector';
import {
  describeContentScriptInjectionFailure,
  RUNTIME_CONTENT_SCRIPT_FILE,
} from './translation/content-script-runtime';
import {
  applyPreferencePatch,
  parseStoredPreferences,
  translationSettingsKey,
} from './translation/preferences';
import { buildContextMenuSelection } from './selection/context-menu-context';
import {
  assistantEventTargets,
  assistantTaskOrigin,
  type AssistantTaskOrigin,
} from './assistant/assistantEventRouting';
import { nextPageBatchCursor, pageBatchMessageType } from './translation/page-job-lifecycle';

const NATIVE_HOST_NAME = 'cn.yanyi.native_host';

function installMainWorldShadowHook(eventType: string) {
  const hookWindow = window as typeof window & {
    __yanyiOpenShadowHook?: { eventTypes: Set<string> };
  };
  const existing = hookWindow.__yanyiOpenShadowHook;
  if (existing !== undefined) {
    existing.eventTypes.add(eventType);
    return;
  }
  const original = Reflect.get(Element.prototype, 'attachShadow');
  const eventTypes = new Set([eventType]);
  function attachShadow(this: Element, init: ShadowRootInit): ShadowRoot {
    const root = Reflect.apply(original, this, [init]);
    if (init.mode === 'open') {
      for (const type of eventTypes) {
        this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }));
      }
    }
    return root;
  }
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'attachShadow');
  Object.defineProperty(Element.prototype, 'attachShadow', {
    ...descriptor,
    configurable: true,
    value: attachShadow,
  });
  hookWindow.__yanyiOpenShadowHook = { eventTypes };
}

type ExtensionRequest =
  | { type: 'yanyi.status.get'; tabId?: number }
  | { type: 'yanyi.selection.consume' }
  | { type: 'yanyi.assistant.start'; payload: Omit<AssistantStartPayload, 'taskId'> }
  | { type: 'yanyi.assistant.cancel'; taskId: string }
  | { type: 'yanyi.assistant.terminal.get'; taskId: string }
  | {
      type: 'yanyi.conversation.list';
      payload?: {
        search?: string;
        status?: 'active' | 'archived' | 'legacy';
        offset?: number;
        limit?: number;
      };
    }
  | {
      type: 'yanyi.conversation.get';
      conversationId: string;
      messageOffset?: number;
      messageLimit?: number;
    }
  | { type: 'yanyi.conversation.rename'; conversationId: string; title: string }
  | { type: 'yanyi.conversation.archive'; conversationId: string; archived: boolean }
  | {
      type: 'yanyi.conversation.delete';
      conversationId: string;
      confirmed: boolean;
    }
  | { type: 'yanyi.model.catalog.get'; providerId?: string; refresh?: boolean }
  | { type: 'yanyi.model.selection.get'; conversationId?: string; task: string }
  | {
      type: 'yanyi.model.selection.set';
      payload: {
        scope: 'global' | 'task' | 'conversation';
        scopeId: string;
        task: string;
        providerId: string;
        apiProfileId?: string;
        modelId: string;
        thinkingEnabled: boolean;
        reasoningEffort?: 'high' | 'max';
      };
    }
  | {
      type: 'yanyi.glossary.quick-add';
      payload: {
        sourceTerm: string;
        targetTerm?: string;
        strategy: 'fixed' | 'never_translate';
        scope: string;
      };
    }
  | { type: 'yanyi.note.create'; payload: { content: string; sourceExcerpt?: string } }
  | { type: 'yanyi.page.ready' }
  | { type: 'yanyi.shadow-hook.install'; eventType: string }
  | { type: 'yanyi.translation.start'; tabId?: number }
  | {
      type: 'yanyi.translation.scan.updated';
      payload: ContentScanResult & { reason: 'mutation' | 'navigation' };
    }
  | { type: 'yanyi.translation.pause'; tabId?: number }
  | { type: 'yanyi.translation.resume'; tabId?: number }
  | { type: 'yanyi.translation.cancel'; tabId?: number }
  | { type: 'yanyi.translation.restore'; tabId?: number }
  | { type: 'yanyi.translation.mode.set'; mode: PopupSnapshot['mode'] }
  | {
      type: 'yanyi.translation.preferences.update';
      tabId?: number;
      patch: TranslationPreferencePatch;
    }
  | { type: 'yanyi.sidepanel.open'; windowId?: number }
  | { type: 'yanyi.conversation.site.get'; siteOrigin: string }
  | {
      type: 'yanyi.conversation.site.set';
      siteOrigin: string;
      conversationId: string;
      knowledgeMode?: string;
    }
  | { type: 'yanyi.conversation.site.new'; siteOrigin: string }
  | {
      type: 'yanyi.model.capability.verify';
      providerId?: string;
      modelId: string;
      probeThinking?: boolean;
    };

interface ContentScanResult {
  pageSessionId: string;
  segments: TranslationStartPayload['segments'];
  capped: boolean;
  continuationCursor?: number;
  diagnostics: ScanDiagnostics;
  pageProfile: PageTranslationProfile;
}

interface SitePolicy {
  defaultMode?: PopupSnapshot['mode'] | null;
  primaryDomainId?: string | null;
  tags?: string[];
  ignoredSelectors: string[];
  forceContentSelector?: string | null;
  translateTables: boolean;
  version: number;
}

interface TaskRoute {
  tabId: number;
  frameId: number;
  pageSessionId: string;
  pageUrl: string;
  mode: PopupSnapshot['mode'];
  settingsKey: string;
  task: ExtensionTaskState;
  completedByHash: Record<string, string>;
  recoveredCount: number;
  failedBase: number;
  totalBase: number;
  pageJobId: string;
  batchIndex: number;
  finalBatchSent?: boolean;
  continuationCursor?: number;
  diagnostics?: ScanDiagnostics;
  config: {
    sourceLanguage: string;
    targetLanguage: string;
    promptVersion: string;
    siteDomain?: string;
    domainId?: string;
    technicalTags: string[];
    glossaryVersion: number;
    translationMode: 'replace' | 'below' | 'bilingual';
    websiteRuleVersion: number;
    profile: TranslationProfile;
    pageProfile: PageTranslationProfile;
  };
}

let nativePort: ReturnType<typeof browser.runtime.connectNative> | undefined;
let handshake: ProtocolEnvelope<HandshakeReady> | undefined;
let connection: PopupSnapshot['connection'] = 'connecting';
let nativeError: string | undefined;
let lastNativeConnectAttemptAt = 0;
let nativeReconnectDelayMs = 1_000;
let pageError: string | undefined;
let lastContentTabId: number | undefined;
let activeRoute: TaskRoute | undefined;
const ROUTE_STORAGE_KEY = 'yanyi.translation.active-route.v1';
const CONTENT_TAB_STORAGE_KEY = 'yanyi.translation.last-content-tab.v1';
const SELECTION_STORAGE_KEY = 'yanyi.selection.context.v1';
const PREFERENCES_STORAGE_KEY = 'yanyi.translation.preferences-by-tab.v1';
// The pre-remediation implementation placed page URLs, profile terms and
// completed translations in durable local storage. Discard that legacy copy
// as soon as the service worker starts; current routes live in session storage.
void browser.storage.local.remove(ROUTE_STORAGE_KEY);
const injectionFailureByTab = new Map<number, string>();
const preferencesByTab = new Map<number, TranslationPreferences>();
let preferencesLoadPromise: Promise<void> | undefined;
let nativeEventQueue: Promise<void> = Promise.resolve();
let selectionConsumeQueue: Promise<unknown> = Promise.resolve(undefined);
const pendingDynamicSegments = new Map<number, Map<string, TranslationSegmentInput>>();
const pendingSegmentTranslations = new Map<string, TranslationSegmentEventPayload>();
const assistantTaskIds = new Map<string, AssistantTaskOrigin>();
const assistantTerminalEvents = new Map<string, ProtocolEnvelope>();

/**
 * Broadcasts one assistant lifecycle event to every surface that can render it:
 * extension pages via runtime messaging, plus the originating tab so the
 * in-page popover observes the same request lifecycle.
 */
async function broadcastAssistantEvent(taskId: string, event: ProtocolEnvelope) {
  const targets = assistantEventTargets(assistantTaskIds.get(taskId));
  const message = { type: 'yanyi.assistant.event', event };
  if (targets.runtime) await browser.runtime.sendMessage(message).catch(() => undefined);
  if (targets.tab === undefined) return;
  await browser.tabs
    .sendMessage(
      targets.tab.tabId,
      message,
      targets.tab.frameId === undefined ? {} : { frameId: targets.tab.frameId },
    )
    .catch(() => undefined);
}

function clearPendingSegmentTranslationsForTask(taskId: string) {
  for (const [segmentId, payload] of pendingSegmentTranslations) {
    if (payload.taskId === taskId) pendingSegmentTranslations.delete(segmentId);
  }
}

function rememberAssistantTerminal(taskId: string, event: ProtocolEnvelope) {
  assistantTerminalEvents.delete(taskId);
  assistantTerminalEvents.set(taskId, event);
  while (assistantTerminalEvents.size > 64) {
    const oldest = assistantTerminalEvents.keys().next().value;
    if (oldest === undefined) break;
    assistantTerminalEvents.delete(oldest);
  }
}

async function failActiveAssistantTasks(message: string) {
  const taskIds = [...assistantTaskIds.keys()];
  for (const taskId of taskIds) {
    const event: ProtocolEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      type: 'assistant.failed',
      sequence: 0,
      done: true,
      idempotencyKey: taskId,
      payload: {
        taskId,
        error: { code: 'native_host_disconnected', message, recoverable: true },
      },
    };
    rememberAssistantTerminal(taskId, event);
    await broadcastAssistantEvent(taskId, event);
    assistantTaskIds.delete(taskId);
  }
}
const pendingNativeRequests = new Map<
  string,
  {
    expected: MessageType;
    resolve: (value: ProtocolEnvelope | undefined) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

function consumeSelectionContext(): Promise<unknown> {
  const consume = selectionConsumeQueue.then(async () => {
    const stored = await browser.storage.session.get(SELECTION_STORAGE_KEY);
    const context = stored[SELECTION_STORAGE_KEY];
    await browser.storage.session.remove(SELECTION_STORAGE_KEY);
    return context;
  });
  selectionConsumeQueue = consume.then(
    () => undefined,
    () => undefined,
  );
  return consume;
}

async function commitSegmentToPage(
  tabId: number,
  frameId: number,
  payload: TranslationSegmentEventPayload,
  mode: PopupSnapshot['mode'],
): Promise<SegmentCommitAck> {
  try {
    const response: unknown = await browser.tabs.sendMessage(
      tabId,
      { type: 'yanyi.translation.segment.completed', payload, mode },
      { frameId },
    );
    if (
      typeof response === 'object' &&
      response !== null &&
      'rendered' in response &&
      response.rendered === true
    ) {
      const committedSegmentIds =
        'committedSegmentIds' in response && Array.isArray(response.committedSegmentIds)
          ? response.committedSegmentIds.filter(
              (segmentId): segmentId is string => typeof segmentId === 'string',
            )
          : undefined;
      return {
        rendered: true,
        ...(committedSegmentIds === undefined ? {} : { committedSegmentIds }),
      };
    }
    if (
      typeof response === 'object' &&
      response !== null &&
      'accepted' in response &&
      response.accepted === true &&
      'pending' in response &&
      response.pending === true
    ) {
      return { rendered: false, accepted: true, pending: true };
    }
    if (
      typeof response === 'object' &&
      response !== null &&
      'rendered' in response &&
      response.rendered === false
    ) {
      const reason =
        'reason' in response && (response.reason === 'stale' || response.reason === 'failed')
          ? response.reason
          : 'failed';
      return {
        rendered: false,
        reason,
        message: '页面拒绝提交片段译文（正文可能已变化），已保留原文。',
      };
    }
    return {
      rendered: false,
      message: '页面未确认片段译文已经写入，已保留原文。',
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message.trim().slice(0, 200) : '';
    return {
      rendered: false,
      message: `页面通信失败，片段译文未提交，已保留原文。${detail === '' ? '' : ` ${detail}`}`,
    };
  }
}

async function persistRoute() {
  await persistEphemeralRoute(
    browser.storage.session,
    browser.storage.local,
    ROUTE_STORAGE_KEY,
    activeRoute,
  );
}

async function ensureRoute(): Promise<TaskRoute | undefined> {
  if (activeRoute !== undefined) return activeRoute;
  const candidate = await loadEphemeralRoute(
    browser.storage.session,
    browser.storage.local,
    ROUTE_STORAGE_KEY,
  );
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    'task' in candidate &&
    'pageJobId' in candidate &&
    'config' in candidate
  ) {
    activeRoute = candidate as TaskRoute;
  } else if (candidate !== undefined) {
    await browser.storage.session.remove(ROUTE_STORAGE_KEY);
  }
  return activeRoute;
}

async function routeForControl(tabId: number): Promise<TaskRoute | undefined> {
  const route = await ensureRoute();
  if (route?.tabId !== tabId) return undefined;
  return route;
}

async function ensurePreferencesLoaded(): Promise<void> {
  preferencesLoadPromise ??= (async () => {
    const stored = await browser.storage.session.get(PREFERENCES_STORAGE_KEY);
    const raw = stored[PREFERENCES_STORAGE_KEY];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return;
    for (const [tabId, preferences] of Object.entries(raw)) {
      const numericTabId = Number(tabId);
      if (Number.isInteger(numericTabId) && numericTabId >= 0) {
        preferencesByTab.set(numericTabId, parseStoredPreferences(preferences));
      }
    }
  })();
  await preferencesLoadPromise;
}

async function persistPreferences(): Promise<void> {
  await browser.storage.session.set({
    [PREFERENCES_STORAGE_KEY]: Object.fromEntries(preferencesByTab),
  });
}

async function preferencesForTab(tabId?: number): Promise<TranslationPreferences> {
  await ensurePreferencesLoaded();
  const stored = tabId === undefined ? undefined : preferencesByTab.get(tabId);
  return stored === undefined
    ? { ...defaultTranslationPreferences, tags: [...defaultTranslationPreferences.tags] }
    : { ...stored, tags: [...stored.tags] };
}

async function updatePreferencesForTab(
  tabId: number,
  patch: unknown,
): Promise<TranslationPreferences | undefined> {
  const current = await preferencesForTab(tabId);
  const updated = applyPreferencePatch(current, patch);
  if (updated === undefined) return undefined;
  preferencesByTab.set(tabId, updated);
  await persistPreferences();
  return updated;
}

async function forgetPreferencesForTab(tabId: number): Promise<void> {
  await ensurePreferencesLoaded();
  if (!preferencesByTab.delete(tabId)) return;
  await persistPreferences();
}

function sendNative<T extends object>(type: MessageType, payload: T, taskId?: string) {
  if (nativePort === undefined || connection !== 'connected') return false;
  const options: { requestId: string; sequence: number; done: boolean; idempotencyKey?: string } = {
    requestId: crypto.randomUUID(),
    sequence: 0,
    done: !['translation.start', 'translation.batch.continue'].includes(type),
  };
  if (taskId !== undefined) options.idempotencyKey = taskId;
  try {
    nativePort.postMessage(createEnvelope(type, payload, options));
    return true;
  } catch (error) {
    nativeError = error instanceof Error ? error.message : 'Native Host 通信失败。';
    connection = 'disconnected';
    nativePort.disconnect();
    return false;
  }
}

function sendNativeRequest<T extends object>(
  type: MessageType,
  payload: T,
  expected: MessageType,
  timeoutMs = 5_000,
): Promise<ProtocolEnvelope | undefined> {
  if (nativePort === undefined || connection !== 'connected') return Promise.resolve(undefined);
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingNativeRequests.delete(requestId);
      resolve(undefined);
    }, timeoutMs);
    pendingNativeRequests.set(requestId, { expected, resolve, timeout });
    nativePort?.postMessage(createEnvelope(type, payload, { requestId }));
  });
}

function connectNativeHost() {
  if (nativePort !== undefined) return;
  const now = Date.now();
  if (now - lastNativeConnectAttemptAt < nativeReconnectDelayMs) return;
  lastNativeConnectAttemptAt = now;
  connection = 'connecting';
  nativeError = undefined;
  try {
    nativePort = browser.runtime.connectNative(NATIVE_HOST_NAME);
    const request = createEnvelope('system.handshake.request', {
      extensionVersion: browser.runtime.getManifest().version,
      supportedProtocolVersions: [1],
    });
    const handshakeTimeout = setTimeout(() => {
      if (connection === 'connecting') {
        nativeError = 'Native Host 握手在 5 秒内未响应。';
        connection = 'disconnected';
        nativePort?.disconnect();
      }
    }, 5_000);
    nativePort.onMessage.addListener((message: unknown) => {
      if (!isProtocolEnvelope(message)) return;
      const pending = pendingNativeRequests.get(message.requestId);
      if (message.type === pending?.expected) {
        clearTimeout(pending.timeout);
        pendingNativeRequests.delete(message.requestId);
        pending.resolve(message);
        return;
      }
      if (pending !== undefined && message.type === 'system.error') {
        clearTimeout(pending.timeout);
        pendingNativeRequests.delete(message.requestId);
        pending.resolve(undefined);
        return;
      }
      if (message.type === 'system.handshake.ready') {
        clearTimeout(handshakeTimeout);
        handshake = message as unknown as ProtocolEnvelope<HandshakeReady>;
        connection = 'connected';
        lastNativeConnectAttemptAt = 0;
        nativeReconnectDelayMs = 1_000;
        return;
      }
      const operation = nativeEventQueue.then(() => routeNativeEvent(message));
      nativeEventQueue = operation.catch(async () => {
        await ensureRoute().catch(() => undefined);
        if (activeRoute === undefined) return;
        activeRoute.task = {
          ...activeRoute.task,
          state: 'error',
          message: '扩展处理本地翻译事件失败，未确认的片段已保留原文。',
        };
        await persistRoute().catch(() => undefined);
      });
    });
    nativePort.onDisconnect.addListener(() => {
      clearTimeout(handshakeTimeout);
      nativeError ??= browser.runtime.lastError?.message ?? 'Native Host 已断开连接。';
      nativePort = undefined;
      handshake = undefined;
      connection = 'disconnected';
      nativeReconnectDelayMs = Math.min(nativeReconnectDelayMs * 2, 30_000);
      for (const [requestId, pending] of pendingNativeRequests) {
        clearTimeout(pending.timeout);
        pending.resolve(undefined);
        pendingNativeRequests.delete(requestId);
      }
      void failActiveAssistantTasks(nativeError);
      void (async () => {
        const route = await ensureRoute();
        if (route === undefined || !['queued', 'translating', 'paused'].includes(route.task.state))
          return;
        route.task = { ...route.task, state: 'offline', message: nativeError };
        await persistRoute();
      })();
    });
    nativePort.postMessage(request);
  } catch (error) {
    nativePort = undefined;
    handshake = undefined;
    nativeError = error instanceof Error ? error.message : '无法启动 Native Host。';
    connection = 'disconnected';
    nativeReconnectDelayMs = Math.min(nativeReconnectDelayMs * 2, 30_000);
  }
}

async function reportTranslationDiagnostics(
  route: TaskRoute,
  terminalType: 'translation.completed' | 'translation.failed' | 'translation.cancelled',
) {
  const response = (await browser.tabs
    .sendMessage(
      route.tabId,
      { type: 'yanyi.translation.scan.diagnostics' },
      { frameId: route.frameId },
    )
    .catch(() => undefined)) as
    { accepted?: boolean; pageSessionId?: string; diagnostics?: ScanDiagnostics } | undefined;
  const reported =
    response?.accepted === true && response.pageSessionId === route.pageSessionId
      ? response.diagnostics
      : undefined;
  const stale = Object.values(route.task.segments).filter((state) => state === 'stale').length;
  const diagnostics: ScanDiagnostics = {
    discoveredVisible: 0,
    eligible: route.task.total,
    protected: 0,
    ignored: 0,
    queued: route.task.total,
    completed: route.task.completed,
    failed: route.task.failed,
    stale,
    overBudget: 0,
    unsupported: 0,
    cancelled: 0,
    notScanned: 0,
    ...(route.diagnostics ?? {}),
    ...(reported ?? {}),
  };
  diagnostics.completed = Math.max(diagnostics.completed, route.task.completed);
  diagnostics.failed = Math.max(diagnostics.failed, route.task.failed);
  diagnostics.stale = Math.max(diagnostics.stale, stale);
  if (terminalType === 'translation.cancelled') {
    const accounted =
      diagnostics.completed +
      diagnostics.failed +
      diagnostics.stale +
      diagnostics.overBudget +
      diagnostics.unsupported +
      diagnostics.notScanned;
    diagnostics.cancelled = Math.max(
      diagnostics.cancelled,
      Math.max(0, diagnostics.eligible - accounted),
    );
  }
  route.diagnostics = diagnostics;
  const segmentStates: TranslationScanReportPayload['segmentStates'] = {};
  for (const [segmentId, state] of Object.entries(route.task.segments)) {
    if (state === 'failed' || state === 'stale') segmentStates[segmentId] = state;
    else if (
      terminalType === 'translation.cancelled' &&
      (state === 'queued' || state === 'translating')
    )
      segmentStates[segmentId] = 'cancelled';
  }
  sendNative(
    'translation.scan.report',
    {
      taskId: route.task.taskId ?? '',
      pageJobId: route.pageJobId,
      pageSessionId: route.pageSessionId,
      diagnostics,
      segmentStates,
    } satisfies TranslationScanReportPayload,
    route.task.taskId,
  );
}

async function routeNativeEvent(event: ProtocolEnvelope) {
  if (event.type === 'system.error') {
    nativeError = String((event.payload as { message?: string }).message ?? '本地服务返回错误。');
    const assistantTaskId = event.idempotencyKey;
    if (assistantTaskId !== undefined && assistantTaskIds.has(assistantTaskId)) {
      const assistantFailure: ProtocolEnvelope = {
        ...event,
        type: 'assistant.failed',
        payload: {
          taskId: assistantTaskId,
          error: event.payload,
        },
      };
      rememberAssistantTerminal(assistantTaskId, assistantFailure);
      await broadcastAssistantEvent(assistantTaskId, assistantFailure);
      assistantTaskIds.delete(assistantTaskId);
      return;
    }
    await browser.runtime.sendMessage({ type: 'yanyi.system.error', event }).catch(() => undefined);
    await ensureRoute();
    if (activeRoute !== undefined && event.idempotencyKey === activeRoute.task.taskId) {
      activeRoute.task = { ...activeRoute.task, state: 'error', message: nativeError };
      await persistRoute();
    }
    return;
  }
  if (event.type.startsWith('assistant.')) {
    const assistantTaskId = String(
      (event.payload as { taskId?: string }).taskId ?? event.idempotencyKey ?? '',
    );
    const terminal =
      event.type === 'assistant.completed' ||
      event.type === 'assistant.failed' ||
      event.type === 'assistant.cancelled';
    if (assistantTaskId.length > 0 && terminal) {
      rememberAssistantTerminal(assistantTaskId, event);
    }
    await broadcastAssistantEvent(assistantTaskId, event);
    if (assistantTaskId.length > 0 && terminal) assistantTaskIds.delete(assistantTaskId);
    return;
  }
  if (event.type === 'glossary.saved' || event.type === 'note.created') {
    await browser.runtime.sendMessage({ type: 'yanyi.data.event', event }).catch(() => undefined);
    return;
  }
  const payload = event.payload as Partial<TranslationSegmentEventPayload>;
  await ensureRoute();
  if (
    activeRoute === undefined ||
    typeof payload.taskId !== 'string' ||
    payload.taskId !== activeRoute.task.taskId
  )
    return;
  const route = activeRoute;
  if (event.type === 'translation.segment.completed') {
    if (
      typeof payload.segmentId !== 'string' ||
      typeof payload.sourceHash !== 'string' ||
      typeof payload.translation !== 'string'
    ) {
      route.task = {
        ...route.task,
        state: 'error',
        message: '本地服务返回了不完整的片段译文，页面已保留原文。',
      };
      await persistRoute();
      return;
    }
    if (event.sequence <= route.task.sequence) return;
    const completedEvent: ProtocolEnvelope<TranslationSegmentEventPayload> = {
      ...event,
      payload: {
        taskId: payload.taskId,
        segmentId: payload.segmentId,
        sourceHash: payload.sourceHash,
        translation: payload.translation,
      },
    };
    const acknowledgement = await commitSegmentToPage(
      route.tabId,
      route.frameId,
      completedEvent.payload,
      route.mode,
    );
    if (activeRoute !== route || activeRoute.task.taskId !== payload.taskId) return;
    route.task = reduceSegmentCommitAck(route.task, completedEvent, acknowledgement);
    if (acknowledgement.accepted === true && acknowledgement.pending === true) {
      pendingSegmentTranslations.set(completedEvent.payload.segmentId, completedEvent.payload);
    } else if (acknowledgement.rendered) {
      pendingSegmentTranslations.set(completedEvent.payload.segmentId, completedEvent.payload);
      const committedIds = acknowledgement.committedSegmentIds ?? [
        completedEvent.payload.segmentId,
      ];
      for (const segmentId of committedIds) {
        const committed = pendingSegmentTranslations.get(segmentId);
        if (committed === undefined) continue;
        route.completedByHash = applySegmentCommitToCache(route.completedByHash ?? {}, committed, {
          rendered: true,
        });
        pendingSegmentTranslations.delete(segmentId);
      }
    } else {
      pendingSegmentTranslations.delete(completedEvent.payload.segmentId);
      route.completedByHash = applySegmentCommitToCache(
        route.completedByHash ?? {},
        completedEvent.payload,
        acknowledgement,
      );
    }
    await persistRoute();
    return;
  }
  if (event.type === 'translation.segment.failed' && typeof payload.segmentId === 'string') {
    const failureAck = (await browser.tabs
      .sendMessage(
        route.tabId,
        { type: 'yanyi.translation.segment.failed', segmentId: payload.segmentId },
        { frameId: route.frameId },
      )
      .catch(() => undefined)) as { discardedSegmentIds?: string[] } | undefined;
    const discarded = new Set([payload.segmentId, ...(failureAck?.discardedSegmentIds ?? [])]);
    for (const segmentId of discarded) pendingSegmentTranslations.delete(segmentId);
  }
  const recoveredCount = route.recoveredCount ?? 0;
  const staleCount = Object.values(route.task.segments).filter(
    (segment) => segment === 'stale',
  ).length;
  const routedEvent =
    event.type === 'translation.progress' ||
    event.type === 'translation.completed' ||
    event.type === 'translation.cancelled' ||
    event.type === 'translation.failed'
      ? {
          ...event,
          payload: {
            ...event.payload,
            completed:
              Math.max(
                0,
                Number((event.payload as { completed?: number }).completed ?? 0) - staleCount,
              ) + recoveredCount,
            failed: Number((event.payload as { failed?: number }).failed ?? 0) + route.failedBase,
            total:
              Math.max(0, Number((event.payload as { total?: number }).total ?? 0) - staleCount) +
              route.totalBase,
          },
        }
      : event;
  route.task = reduceTaskEvent(route.task, routedEvent as never);
  if (
    event.type === 'translation.completed' ||
    event.type === 'translation.failed' ||
    event.type === 'translation.cancelled'
  ) {
    clearPendingSegmentTranslationsForTask(payload.taskId);
    await reportTranslationDiagnostics(route, event.type);
  }
  await persistRoute();
  if (event.type === 'translation.completed') await advanceTranslationJob(route);
}

function pageState(task: ExtensionTaskState): PopupSnapshot['page'] {
  switch (task.state) {
    case 'scanning':
    case 'queued':
    case 'translating':
    case 'cancelling':
      return 'translating';
    case 'paused':
      return 'paused';
    case 'completed':
    case 'partial':
      return 'translated';
    case 'error':
    case 'offline':
      return 'error';
    default:
      return 'ready';
  }
}

async function getSnapshot(tabId?: number): Promise<PopupSnapshot> {
  if (nativePort === undefined && connection !== 'connected') connectNativeHost();
  await ensureRoute();
  const preferences = await preferencesForTab(tabId ?? activeRoute?.tabId);
  const base: PopupSnapshot = {
    ...preferences,
    tags: [...preferences.tags],
    connection,
    page: 'ready',
    completedSegments: 0,
    totalSegments: 0,
  };
  if (activeRoute !== undefined && (tabId === undefined || activeRoute.tabId === tabId)) {
    base.page = pageState(activeRoute.task);
    base.mode = activeRoute.mode;
    base.completedSegments = activeRoute.task.completed;
    base.totalSegments = activeRoute.task.total;
    base.translationBatch = activeRoute.batchIndex + 1;
    base.hasMoreBatches =
      activeRoute.continuationCursor !== undefined ||
      (pendingDynamicSegments.get(activeRoute.tabId)?.size ?? 0) > 0;
    if (activeRoute.diagnostics !== undefined) {
      base.scanDiagnostics = { ...activeRoute.diagnostics };
    }
    if (activeRoute.task.message !== undefined) base.message = activeRoute.task.message;
  }
  if (connection !== 'connected' && base.page !== 'translated') {
    base.message = nativeError ?? '本地服务未连接，请先启动研译本地端。';
  } else if (pageError !== undefined && activeRoute === undefined) {
    base.page = 'error';
    base.message = pageError;
  }
  return base;
}

async function inspectContentTab(tabId: number): Promise<boolean> {
  try {
    const inspection = await browser.tabs.sendMessage(tabId, { type: 'yanyi.page.inspect' });
    const ready = typeof inspection === 'object' && inspection !== null && 'url' in inspection;
    if (ready) injectionFailureByTab.delete(tabId);
    return ready;
  } catch (error) {
    injectionFailureByTab.set(tabId, describeContentScriptInjectionFailure(error));
    return false;
  }
}

const contentScriptInjector = new ContentScriptInjector({
  inspect: inspectContentTab,
  inject: async (tabId) => {
    try {
      await browser.scripting.executeScript({
        target: { tabId },
        // Chromium requires a path relative to the extension root. WXT's generated
        // ScriptPublicPath type currently models the same file with a leading slash.
        files: [RUNTIME_CONTENT_SCRIPT_FILE as '/content-scripts/content.js'],
      });
      injectionFailureByTab.delete(tabId);
    } catch (error) {
      injectionFailureByTab.set(tabId, describeContentScriptInjectionFailure(error));
      throw error;
    }
  },
});

async function ensureContentTab(tabId: number): Promise<boolean> {
  const ready = await contentScriptInjector.ensure(tabId);
  if (ready) {
    lastContentTabId = tabId;
    await browser.storage.session.set({ [CONTENT_TAB_STORAGE_KEY]: tabId });
  }
  return ready;
}

async function resolveContentTab(requestedTabId?: number): Promise<number | undefined> {
  if (requestedTabId !== undefined) {
    return (await ensureContentTab(requestedTabId)) ? requestedTabId : undefined;
  }
  if (lastContentTabId === undefined) {
    const stored = await browser.storage.session.get(CONTENT_TAB_STORAGE_KEY);
    const candidate = stored[CONTENT_TAB_STORAGE_KEY];
    if (typeof candidate === 'number') lastContentTabId = candidate;
  }
  if (lastContentTabId !== undefined) {
    if (await ensureContentTab(lastContentTabId)) return lastContentTabId;
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined && (await ensureContentTab(tab.id))) return tab.id;
  const tabs = await browser.tabs.query({});
  for (const candidate of [...tabs].reverse()) {
    if (candidate.id === undefined) continue;
    if (await ensureContentTab(candidate.id)) return candidate.id;
  }
  return undefined;
}

function taskIsActive(task: ExtensionTaskState): boolean {
  return ['scanning', 'queued', 'translating', 'paused', 'cancelling'].includes(task.state);
}

function segmentQueueKey(segment: TranslationSegmentInput): string {
  return `${segment.nodeId ?? segment.segmentId}:${String(segment.partIndex ?? 0)}`;
}

function enqueueDynamicSegments(tabId: number, segments: readonly TranslationSegmentInput[]) {
  const pending = pendingDynamicSegments.get(tabId) ?? new Map<string, TranslationSegmentInput>();
  for (const segment of segments) pending.set(segmentQueueKey(segment), segment);
  pendingDynamicSegments.set(tabId, pending);
}

async function beginNextTranslationBatch(
  route: TaskRoute,
  segments: readonly TranslationSegmentInput[],
): Promise<boolean> {
  if (activeRoute !== route || segments.length === 0 || connection !== 'connected') return false;
  route.totalBase = route.task.total;
  route.recoveredCount = route.task.completed;
  route.failedBase = route.task.failed;
  const finalBatch = route.continuationCursor === undefined;
  const cursor = nextPageBatchCursor(route, finalBatch);
  route.pageJobId = cursor.pageJobId;
  route.batchIndex = cursor.batchIndex;
  route.finalBatchSent = cursor.finalBatchSent;
  const taskId = crypto.randomUUID();
  route.task = createQueuedTask(
    taskId,
    route.pageSessionId,
    segments.map(({ segmentId }) => segmentId),
  );
  route.task.total = route.totalBase + segments.length;
  route.task.completed = route.recoveredCount;
  route.task.failed = route.failedBase;
  route.task.message = `正在翻译第 ${String(route.batchIndex + 1)} 批页面内容。`;
  await persistRoute();
  const accepted = sendNative(
    pageBatchMessageType(cursor),
    {
      taskId,
      tabId: route.tabId,
      frameId: route.frameId,
      pageSessionId: route.pageSessionId,
      pageJobId: route.pageJobId,
      batchIndex: route.batchIndex,
      finalBatch,
      ...(route.diagnostics === undefined ? {} : { scanDiagnostics: route.diagnostics }),
      ...route.config,
      segments: [...segments],
    },
    taskId,
  );
  if (!accepted) {
    route.task = {
      ...route.task,
      state: 'offline',
      message: '本地服务不可用，后续批次未发送，页面现有译文保持不变。',
    };
    await persistRoute();
  }
  return accepted;
}

async function advanceTranslationJob(route: TaskRoute): Promise<void> {
  if (activeRoute !== route || taskIsActive(route.task)) return;
  if (route.continuationCursor !== undefined) {
    const response = (await browser.tabs
      .sendMessage(route.tabId, {
        type: 'yanyi.translation.scan.continue',
        cursor: route.continuationCursor,
      })
      .catch(() => undefined)) as (ContentScanResult & { accepted?: boolean }) | undefined;
    if (response?.accepted === true && response.segments.length > 0) {
      if (response.continuationCursor === undefined) delete route.continuationCursor;
      else route.continuationCursor = response.continuationCursor;
      route.diagnostics = response.diagnostics;
      route.config.pageProfile = response.pageProfile;
      const pending = pendingDynamicSegments.get(route.tabId);
      for (const segment of response.segments) pending?.delete(segmentQueueKey(segment));
      if (pending?.size === 0) pendingDynamicSegments.delete(route.tabId);
      await beginNextTranslationBatch(route, response.segments);
      return;
    }
    delete route.continuationCursor;
  }
  const pending = pendingDynamicSegments.get(route.tabId);
  if (pending !== undefined && pending.size > 0) {
    pendingDynamicSegments.delete(route.tabId);
    await beginNextTranslationBatch(route, [...pending.values()]);
  }
}

async function handleDynamicScanUpdate(
  tabId: number,
  scan: ContentScanResult & { reason: 'mutation' | 'navigation' },
  pageUrl: string,
): Promise<boolean> {
  await ensureRoute();
  const route = activeRoute;
  if (route?.tabId !== tabId) return false;
  if (scan.reason === 'navigation' || scan.pageSessionId !== route.pageSessionId) {
    if (taskIsActive(route.task) && route.task.taskId !== undefined) {
      sendNative('translation.cancel', { taskId: route.task.taskId }, route.task.taskId);
    }
    pendingDynamicSegments.delete(tabId);
    const replacement: TaskRoute = {
      tabId,
      frameId: route.frameId,
      pageSessionId: scan.pageSessionId,
      pageUrl,
      mode: route.mode,
      settingsKey: route.settingsKey,
      task: { ...idleTaskState },
      completedByHash: {},
      recoveredCount: 0,
      failedBase: 0,
      totalBase: 0,
      pageJobId: crypto.randomUUID(),
      batchIndex: -1,
      finalBatchSent: false,
      ...(scan.continuationCursor === undefined
        ? {}
        : { continuationCursor: scan.continuationCursor }),
      diagnostics: scan.diagnostics,
      config: { ...route.config, pageProfile: scan.pageProfile },
    };
    activeRoute = replacement;
    await persistRoute();
    return beginNextTranslationBatch(replacement, scan.segments);
  }
  route.diagnostics = scan.diagnostics;
  route.config.pageProfile = scan.pageProfile;
  if (scan.continuationCursor !== undefined) route.continuationCursor = scan.continuationCursor;
  if (scan.segments.length === 0) {
    await persistRoute();
    return true;
  }
  enqueueDynamicSegments(tabId, scan.segments);
  await persistRoute();
  if (!taskIsActive(route.task)) await advanceTranslationJob(route);
  return true;
}

async function startTranslation(requestedTabId?: number): Promise<boolean> {
  if (connection !== 'connected') return false;
  const tabId = await resolveContentTab(requestedTabId);
  if (tabId === undefined) {
    activeRoute = undefined;
    pageError =
      requestedTabId === undefined
        ? '当前页面不允许注入翻译脚本。请切换到普通 HTTP/HTTPS 网页后重试。'
        : (injectionFailureByTab.get(requestedTabId) ??
          '无法注入翻译脚本。请重新加载研译扩展和当前网页后重试。');
    await persistRoute();
    return false;
  }
  pageError = undefined;
  const preferences = await preferencesForTab(tabId);
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  const pageUrl = tab?.url ?? '';
  const siteDomain = pageUrl === '' ? undefined : new URL(pageUrl).hostname;
  const policyEvent =
    siteDomain === undefined
      ? undefined
      : await sendNativeRequest('site.policy.request', { siteDomain }, 'site.policy.ready');
  const rawPolicy = (policyEvent?.payload as { policy?: SitePolicy | null } | undefined)?.policy;
  const policy = rawPolicy ?? undefined;
  const effectiveDomainId =
    domainIdForName(preferences.primaryDomain) ?? policy?.primaryDomainId ?? undefined;
  const effectiveTags = [
    ...new Set([...(policy?.tags ?? []), ...preferences.tags].map((tag) => tag.trim())),
  ].filter(Boolean);
  const settingsKey = translationSettingsKey(preferences, effectiveDomainId, effectiveTags);
  const selectedProfile =
    defaultModelProfiles.find(({ id }) => id === preferences.modelProfileId) ??
    defaultModelProfiles.find(({ id }) => id === 'whole-page');
  if (selectedProfile === undefined) {
    pageError = '没有可用的翻译模型预设。请在设置中恢复默认预设。';
    return false;
  }
  const taskSelectionEvent =
    preferences.modelProfileId === defaultTranslationPreferences.modelProfileId
      ? await sendNativeRequest(
          'model.selection.get',
          { task: 'whole_page_translation' },
          'model.selection.ready',
        )
      : undefined;
  const scanPolicy =
    policy === undefined
      ? undefined
      : {
          ignoredSelectors: policy.ignoredSelectors,
          translateTables: policy.translateTables,
          ...(typeof policy.forceContentSelector === 'string'
            ? { forceContentSelector: policy.forceContentSelector }
            : {}),
        };
  const scan = (await browser.tabs
    .sendMessage(tabId, { type: 'yanyi.translation.scan.start', policy: scanPolicy })
    .catch(() => undefined)) as ContentScanResult | undefined;
  if (scan === undefined || scan.segments.length === 0) {
    activeRoute = undefined;
    await persistRoute();
    pageError =
      scan === undefined
        ? '翻译脚本未返回扫描结果，页面保持不变。'
        : '当前页面没有可安全翻译的可见文本；代码、公式和可编辑内容已按规则保护。';
    return false;
  }
  await ensureRoute();
  if (
    activeRoute !== undefined &&
    ['queued', 'translating', 'paused', 'cancelling'].includes(activeRoute.task.state)
  ) {
    sendNative('translation.cancel', { taskId: activeRoute.task.taskId }, activeRoute.task.taskId);
    if (activeRoute.task.taskId !== undefined) {
      clearPendingSegmentTranslationsForTask(activeRoute.task.taskId);
    }
  }
  const previous =
    activeRoute?.pageUrl === pageUrl &&
    activeRoute.settingsKey === settingsKey &&
    activeRoute.task.state !== 'cancelled'
      ? activeRoute
      : undefined;
  let completedByHash = { ...(previous?.completedByHash ?? {}) };
  const cachedCandidates = scan.segments.filter(
    (segment) => completedByHash[segment.sourceHash] !== undefined,
  );
  const cachedSegments: TranslationStartPayload['segments'] = [];
  let cacheRecoveryFailure: string | undefined;
  for (const segment of cachedCandidates) {
    const translation = completedByHash[segment.sourceHash];
    if (translation === undefined) continue;
    const acknowledgement = await commitSegmentToPage(
      tabId,
      0,
      {
        taskId: previous?.task.taskId ?? 'cached-recovery',
        segmentId: segment.segmentId,
        sourceHash: segment.sourceHash,
        translation,
      },
      preferences.mode,
    );
    if (acknowledgement.rendered || (acknowledgement.accepted && acknowledgement.pending))
      cachedSegments.push(segment);
    else {
      completedByHash = applySegmentCommitToCache(
        completedByHash,
        {
          taskId: previous?.task.taskId ?? 'cached-recovery',
          segmentId: segment.segmentId,
          sourceHash: segment.sourceHash,
          translation,
        },
        acknowledgement,
      );
      cacheRecoveryFailure = acknowledgement.message;
    }
  }
  const remainingSegments = scan.segments.filter(
    (segment) => completedByHash[segment.sourceHash] === undefined,
  );
  const taskId = crypto.randomUUID();
  const translationMode =
    preferences.mode === 'replace'
      ? 'replace'
      : preferences.mode === 'bilingual'
        ? 'bilingual'
        : 'below';
  const taskSelection = (taskSelectionEvent?.payload as { selection?: unknown } | undefined)
    ?.selection as
    | {
        providerId?: unknown;
        apiProfileId?: unknown;
        modelId?: unknown;
        thinkingEnabled?: unknown;
        reasoningEffort?: unknown;
      }
    | undefined;
  const hasTaskSelection =
    typeof taskSelection?.providerId === 'string' &&
    typeof taskSelection.modelId === 'string' &&
    typeof taskSelection.thinkingEnabled === 'boolean';
  const profile: TranslationProfile = hasTaskSelection
    ? {
        providerId: taskSelection.providerId as string,
        model: taskSelection.modelId as string,
        thinking: taskSelection.thinkingEnabled === true ? 'enabled' : 'disabled',
        ...(typeof taskSelection.apiProfileId === 'string'
          ? { apiProfileId: taskSelection.apiProfileId }
          : {}),
        ...(taskSelection.thinkingEnabled === true &&
        (taskSelection.reasoningEffort === 'high' || taskSelection.reasoningEffort === 'max')
          ? { reasoningEffort: taskSelection.reasoningEffort }
          : {}),
      }
    : {
        providerId: 'deepseek',
        model: selectedProfile.model,
        thinking: selectedProfile.thinking,
        ...(selectedProfile.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: selectedProfile.reasoningEffort }),
      };
  const route: TaskRoute = {
    tabId,
    frameId: 0,
    pageSessionId: scan.pageSessionId,
    pageUrl,
    mode: preferences.mode,
    settingsKey,
    task: createQueuedTask(
      taskId,
      scan.pageSessionId,
      remainingSegments.map((segment) => segment.segmentId),
    ),
    completedByHash,
    recoveredCount: cachedSegments.length,
    failedBase: 0,
    totalBase: cachedSegments.length,
    pageJobId: crypto.randomUUID(),
    batchIndex: 0,
    finalBatchSent: scan.continuationCursor === undefined,
    ...(scan.continuationCursor === undefined
      ? {}
      : { continuationCursor: scan.continuationCursor }),
    diagnostics: scan.diagnostics,
    config: {
      sourceLanguage: preferences.sourceLanguage,
      targetLanguage: preferences.targetLanguage,
      promptVersion: 'page-v3',
      ...(siteDomain === undefined ? {} : { siteDomain }),
      ...(effectiveDomainId === undefined ? {} : { domainId: effectiveDomainId }),
      technicalTags: effectiveTags,
      glossaryVersion: 0,
      translationMode,
      websiteRuleVersion: policy?.version ?? 0,
      profile,
      pageProfile: scan.pageProfile,
    },
  };
  route.task.completed = cachedSegments.length;
  route.task.total = scan.segments.length;
  if (remainingSegments.length === 0) route.task.state = 'completed';
  else if (cachedSegments.length > 0)
    route.task.message = `已从持久缓存恢复 ${String(cachedSegments.length)} 段，继续翻译剩余内容。`;
  if (cacheRecoveryFailure !== undefined) route.task.message = cacheRecoveryFailure;
  if (scan.capped) route.task.message = '页面较长：正在沿同一页面任务分批继续翻译全文。';
  activeRoute = route;
  pageError = undefined;
  await persistRoute();
  if (remainingSegments.length === 0) {
    await advanceTranslationJob(route);
    return true;
  }
  const accepted = sendNative(
    'translation.start',
    {
      taskId,
      tabId,
      frameId: 0,
      pageSessionId: scan.pageSessionId,
      pageJobId: route.pageJobId,
      batchIndex: route.batchIndex,
      finalBatch: route.finalBatchSent === true,
      ...(route.diagnostics === undefined ? {} : { scanDiagnostics: route.diagnostics }),
      ...route.config,
      segments: remainingSegments,
    },
    taskId,
  );
  if (!accepted) {
    route.task = {
      ...route.task,
      state: 'offline',
      message: nativeError ?? '本地服务连接已中断，请等待自动重连后重试。',
    };
    await persistRoute();
  }
  return accepted;
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: 'yanyi-selection',
        title: '研译',
        contexts: ['selection'],
      });
      // "解释" is no longer its own entry: it is a shortcut intent inside
      // 询问研译, which uses the same chat pipeline.
      for (const [id, title] of [
        ['translate', '研译：翻译'],
        ['follow-up', '研译：询问研译'],
        ['glossary', '添加到术语库'],
      ] as const)
        browser.contextMenus.create({
          id: `yanyi-${id}`,
          parentId: 'yanyi-selection',
          title,
          contexts: ['selection'],
        });
    });
  });
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (
      !String(info.menuItemId).startsWith('yanyi-') ||
      info.menuItemId === 'yanyi-selection' ||
      tab?.id === undefined
    )
      return;
    const tabId = tab.id;
    void (async () => {
      const frameId = info.frameId ?? 0;
      let context: unknown;
      let canLocateSelection = false;
      if (frameId === 0) {
        if (await ensureContentTab(tabId)) {
          context = await browser.tabs
            .sendMessage(tabId, { type: 'yanyi.selection.context' })
            .catch(() => undefined);
          canLocateSelection = typeof context === 'object' && context !== null;
        }
      } else {
        context = await browser.tabs
          .sendMessage(tabId, { type: 'yanyi.selection.context' }, { frameId })
          .catch(() => undefined);
        if (typeof context !== 'object' || context === null) {
          await browser.scripting
            .executeScript({
              target: { tabId, frameIds: [frameId] },
              files: [RUNTIME_CONTENT_SCRIPT_FILE as '/content-scripts/content.js'],
            })
            .catch(() => undefined);
          context = await browser.tabs
            .sendMessage(tabId, { type: 'yanyi.selection.context' }, { frameId })
            .catch(() => undefined);
        }
        canLocateSelection = typeof context === 'object' && context !== null;
      }
      const intent = String(info.menuItemId).replace('yanyi-', '');
      const selection = buildContextMenuSelection({
        locatedContext: context,
        canLocateSelection,
        ...(info.selectionText === undefined ? {} : { fallbackText: info.selectionText }),
        intent,
        tab: {
          id: tabId,
          ...(tab.title === undefined ? {} : { title: tab.title }),
          ...(tab.url === undefined ? {} : { url: tab.url }),
        },
        frameId,
        capturedAt: Date.now(),
      });
      if (selection === undefined) return;
      canLocateSelection = selection.canLocateSelection;
      const fallbackText = selection.context.text;
      const locatedContext = selection.context;
      const selectionContext = {
        ...locatedContext,
        ...(!canLocateSelection
          ? {
              text: fallbackText.slice(0, 8_000),
              sentence: fallbackText.slice(0, 2_000),
              paragraph: fallbackText.slice(0, 8_000),
              heading: tab.title ?? '浏览器选区',
              headingPath: [],
              labels: [],
              domRole: 'text',
              title: tab.title ?? '浏览器选区',
              url: tab.url ?? '',
              isPdf: /\.pdf(?:$|[?#])/iu.test(tab.url ?? ''),
            }
          : {}),
        intent,
        tabId,
        frameId,
        capturedAt: selection.context.capturedAt,
      };
      if (
        canLocateSelection &&
        (intent === 'translate' || intent === 'explain' || intent === 'follow-up')
      ) {
        const response: unknown = await browser.tabs
          .sendMessage(
            tabId,
            {
              type: 'yanyi.selection.popover.open',
              context: selectionContext,
            },
            { frameId },
          )
          .catch(() => undefined);
        if (
          typeof response === 'object' &&
          response !== null &&
          'accepted' in response &&
          response.accepted === true
        ) {
          await browser.storage.session.remove(SELECTION_STORAGE_KEY);
          return;
        }
      }
      if (tab.windowId !== undefined) {
        await browser.storage.session.set({
          [SELECTION_STORAGE_KEY]: {
            ...selectionContext,
            launchToken: crypto.randomUUID(),
          },
        });
        await browser.sidePanel.open({ windowId: tab.windowId });
      }
    })();
  });
  browser.runtime.onStartup.addListener(connectNativeHost);
  browser.commands.onCommand.addListener((command) => {
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (command === 'translate-page') {
        await startTranslation(tab?.id);
      } else if (command === 'open-sidepanel' && tab?.windowId !== undefined) {
        await browser.sidePanel.open({ windowId: tab.windowId });
      }
    })();
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    contentScriptInjector.forget(tabId);
    injectionFailureByTab.delete(tabId);
    pendingDynamicSegments.delete(tabId);
    pendingSegmentTranslations.clear();
    void (async () => {
      await forgetPreferencesForTab(tabId);
      if (lastContentTabId === tabId) {
        lastContentTabId = undefined;
        await browser.storage.session.remove(CONTENT_TAB_STORAGE_KEY);
      }
      const route = await ensureRoute();
      if (route?.tabId !== tabId) return;
      sendNative('translation.cancel', { taskId: route.task.taskId }, route.task.taskId);
      activeRoute = undefined;
      await persistRoute();
    })();
  });
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'loading' && changeInfo.url === undefined) return;
    if (changeInfo.status !== 'loading') return;
    contentScriptInjector.forget(tabId);
    injectionFailureByTab.delete(tabId);
    pendingDynamicSegments.delete(tabId);
    pendingSegmentTranslations.clear();
    void (async () => {
      const route = await ensureRoute();
      if (route?.tabId !== tabId) return;
      sendNative('translation.cancel', { taskId: route.task.taskId }, route.task.taskId);
      activeRoute = undefined;
      await persistRoute();
    })();
  });
  connectNativeHost();

  browser.runtime.onMessage.addListener((request: ExtensionRequest, sender) => {
    return (async () => {
      switch (request.type) {
        case 'yanyi.status.get':
          return { snapshot: await getSnapshot(request.tabId), handshake };
        case 'yanyi.selection.consume': {
          return { context: await consumeSelectionContext() };
        }
        case 'yanyi.assistant.start': {
          const taskId = crypto.randomUUID();
          // A request from the in-page popover carries sender.tab; one from the
          // Side Panel or popup does not. Remember the origin so streaming events
          // reach the content script that started them.
          assistantTaskIds.set(
            taskId,
            assistantTaskOrigin({
              ...(sender.tab?.id === undefined ? {} : { senderTabId: sender.tab.id }),
              ...(sender.frameId === undefined ? {} : { senderFrameId: sender.frameId }),
              ...(request.payload.context.tabId === undefined
                ? {}
                : { contextTabId: request.payload.context.tabId }),
            }),
          );
          assistantTerminalEvents.delete(taskId);
          const tabId = sender.tab?.id;
          const preferences = await preferencesForTab(tabId);
          const context = {
            ...request.payload.context,
            ...(tabId === undefined ? {} : { tabId }),
            ...(request.payload.context.domainId !== undefined || preferences.primaryDomain === null
              ? {}
              : { domainId: preferences.primaryDomain }),
            ...(request.payload.context.technicalTags !== undefined
              ? {}
              : { technicalTags: preferences.tags }),
          };
          const accepted = sendNative(
            'assistant.start',
            { ...request.payload, context, taskId },
            taskId,
          );
          if (!accepted) assistantTaskIds.delete(taskId);
          return {
            taskId,
            accepted,
          };
        }
        case 'yanyi.assistant.cancel':
          // Keep the origin entry until the host confirms cancellation so the
          // terminal assistant.cancelled event still reaches the popover.
          return {
            accepted: sendNative('assistant.cancel', { taskId: request.taskId }, request.taskId),
          };
        case 'yanyi.assistant.terminal.get':
          return { event: assistantTerminalEvents.get(request.taskId) };
        case 'yanyi.conversation.list':
          return {
            event: await sendNativeRequest(
              'conversation.list.request',
              request.payload ?? {},
              'conversation.list.ready',
            ),
          };
        case 'yanyi.conversation.get':
          return {
            event: await sendNativeRequest(
              'conversation.get.request',
              {
                conversationId: request.conversationId,
                messageOffset: request.messageOffset ?? 0,
                messageLimit: request.messageLimit ?? 50,
              },
              'conversation.get.ready',
            ),
          };
        case 'yanyi.conversation.rename':
          return {
            event: await sendNativeRequest(
              'conversation.rename.request',
              { conversationId: request.conversationId, title: request.title },
              'conversation.renamed',
            ),
          };
        case 'yanyi.conversation.archive':
          return {
            event: await sendNativeRequest(
              'conversation.archive.request',
              { conversationId: request.conversationId, archived: request.archived },
              'conversation.archived',
            ),
          };
        case 'yanyi.conversation.delete':
          if (!request.confirmed) {
            return {
              accepted: false,
              error: '删除会话需要用户明确确认。',
            };
          }
          return {
            event: await sendNativeRequest(
              'conversation.delete.request',
              { conversationId: request.conversationId, confirmed: true },
              'conversation.deleted',
            ),
          };
        case 'yanyi.model.catalog.get': {
          const event = await sendNativeRequest(
            'model.catalog.request',
            { providerId: request.providerId ?? 'deepseek', refresh: request.refresh ?? false },
            'model.catalog.ready',
            request.refresh === true ? 30_000 : 5_000,
          );
          const payload = event?.payload as { models?: unknown[] } | undefined;
          return {
            accepted: event !== undefined,
            models: payload?.models ?? [],
          };
        }
        case 'yanyi.model.selection.get': {
          const event = await sendNativeRequest(
            'model.selection.get',
            {
              task: request.task,
              ...(request.conversationId === undefined
                ? {}
                : { conversationId: request.conversationId }),
            },
            'model.selection.ready',
          );
          const payload = event?.payload as { selection?: unknown } | undefined;
          return {
            accepted: event !== undefined,
            selection: payload?.selection,
          };
        }
        case 'yanyi.model.selection.set': {
          const event = await sendNativeRequest(
            'model.selection.set',
            request.payload,
            'model.selection.saved',
          );
          return {
            accepted: event !== undefined,
            selection: event?.payload,
          };
        }
        case 'yanyi.glossary.quick-add':
          return { accepted: sendNative('glossary.quick-add', request.payload) };
        case 'yanyi.note.create':
          return { accepted: sendNative('note.create', request.payload) };
        case 'yanyi.shadow-hook.install': {
          if (
            sender.tab?.id === undefined ||
            !/^yanyi-shadow-[0-9a-f-]{36}$/u.test(request.eventType)
          )
            return { accepted: false };
          const target =
            sender.frameId === undefined
              ? { tabId: sender.tab.id }
              : { tabId: sender.tab.id, frameIds: [sender.frameId] };
          const installed = await browser.scripting
            .executeScript({
              target,
              world: 'MAIN',
              func: installMainWorldShadowHook,
              args: [request.eventType],
            })
            .then(() => true)
            .catch(() => false);
          return { accepted: installed };
        }
        case 'yanyi.page.ready':
          if (sender.tab?.id !== undefined) {
            lastContentTabId = sender.tab.id;
            await browser.storage.session.set({ [CONTENT_TAB_STORAGE_KEY]: sender.tab.id });
          }
          return { accepted: true };
        case 'yanyi.translation.scan.updated': {
          const tabId = sender.tab?.id;
          if (tabId === undefined) return { accepted: false };
          return {
            accepted: await handleDynamicScanUpdate(tabId, request.payload, sender.tab?.url ?? ''),
          };
        }
        case 'yanyi.translation.start':
          return { accepted: await startTranslation(request.tabId) };
        case 'yanyi.translation.pause': {
          const tabId = request.tabId ?? sender.tab?.id;
          if (tabId === undefined) return { accepted: false };
          const route = await routeForControl(tabId);
          if (route === undefined) return { accepted: false };
          const accepted = sendNative(
            'translation.pause',
            { taskId: route.task.taskId },
            route.task.taskId,
          );
          if (!accepted) return { accepted: false };
          route.task = { ...route.task, state: 'paused' };
          await persistRoute();
          return { accepted: true };
        }
        case 'yanyi.translation.resume': {
          const tabId = request.tabId ?? sender.tab?.id;
          if (tabId === undefined) return { accepted: false };
          const route = await routeForControl(tabId);
          if (route === undefined) return { accepted: false };
          const accepted = sendNative(
            'translation.resume',
            { taskId: route.task.taskId },
            route.task.taskId,
          );
          if (!accepted) return { accepted: false };
          route.task = { ...route.task, state: 'translating' };
          await persistRoute();
          return { accepted: true };
        }
        case 'yanyi.translation.cancel': {
          const tabId = request.tabId ?? sender.tab?.id;
          if (tabId === undefined) return { accepted: false };
          const route = await routeForControl(tabId);
          if (route === undefined) return { accepted: false };
          const accepted = sendNative(
            'translation.cancel',
            { taskId: route.task.taskId },
            route.task.taskId,
          );
          if (!accepted) return { accepted: false };
          pendingDynamicSegments.delete(tabId);
          pendingSegmentTranslations.clear();
          delete route.continuationCursor;
          route.task = { ...route.task, state: 'cancelling' };
          await persistRoute();
          return { accepted: true };
        }
        case 'yanyi.translation.restore': {
          const tabId = request.tabId ?? sender.tab?.id;
          if (tabId === undefined) return { accepted: false };
          const route = await routeForControl(tabId);
          if (route === undefined) return { accepted: false };
          pendingDynamicSegments.delete(tabId);
          pendingSegmentTranslations.clear();
          sendNative('translation.cancel', { taskId: route.task.taskId }, route.task.taskId);
          const response: unknown = await browser.tabs
            .sendMessage(route.tabId, { type: 'yanyi.translation.restore' })
            .catch(() => undefined);
          const restored =
            typeof response === 'object' &&
            response !== null &&
            'accepted' in response &&
            response.accepted === true;
          if (!restored) {
            route.task = {
              ...route.task,
              state: 'error',
              message: '页面未确认原文已经还原。请刷新页面后重试。',
            };
            await persistRoute();
            return { accepted: false };
          }
          activeRoute = undefined;
          await persistRoute();
          return { accepted: true };
        }
        case 'yanyi.translation.mode.set': {
          if (sender.tab?.id === undefined) return { accepted: false };
          const route = await routeForControl(sender.tab.id);
          if (route !== undefined) {
            await updatePreferencesForTab(route.tabId, { mode: request.mode });
            route.mode = request.mode;
            await persistRoute();
            await browser.tabs
              .sendMessage(route.tabId, {
                type: 'yanyi.translation.mode.set',
                mode: request.mode,
              })
              .catch(() => undefined);
          }
          return { accepted: route !== undefined };
        }
        case 'yanyi.translation.preferences.update': {
          const tabId = request.tabId ?? sender.tab?.id;
          if (tabId === undefined) return { accepted: false };
          const updated = await updatePreferencesForTab(tabId, request.patch);
          if (updated === undefined) return { accepted: false };
          if (activeRoute?.tabId === tabId && request.patch.mode !== undefined) {
            activeRoute.mode = updated.mode;
            await persistRoute();
            await browser.tabs
              .sendMessage(tabId, { type: 'yanyi.translation.mode.set', mode: updated.mode })
              .catch(() => undefined);
          }
          return { accepted: true, snapshot: await getSnapshot(tabId) };
        }
        case 'yanyi.sidepanel.open': {
          // Fallback path for content scripts, which cannot call sidePanel.open().
          // Extension pages must call the API directly to keep the user gesture.
          const windowId = request.windowId ?? sender.tab?.windowId;
          if (windowId === undefined) return { accepted: false };
          try {
            await browser.sidePanel.open({ windowId });
            return { accepted: true };
          } catch (error) {
            return {
              accepted: false,
              error: error instanceof Error ? error.message : '侧边栏未能打开。',
            };
          }
        }
        case 'yanyi.conversation.site.get': {
          const event = await sendNativeRequest(
            'conversation.site.active.get',
            { siteOrigin: request.siteOrigin },
            'conversation.site.active.ready',
          );
          const payload = event?.payload as { conversationId?: unknown } | undefined;
          return {
            accepted: event !== undefined,
            conversationId:
              typeof payload?.conversationId === 'string' ? payload.conversationId : undefined,
          };
        }
        case 'yanyi.conversation.site.set': {
          const event = await sendNativeRequest(
            'conversation.site.active.set',
            {
              siteOrigin: request.siteOrigin,
              conversationId: request.conversationId,
              ...(request.knowledgeMode === undefined
                ? {}
                : { knowledgeMode: request.knowledgeMode }),
            },
            'conversation.site.active.ready',
          );
          return { accepted: event !== undefined };
        }
        case 'yanyi.conversation.site.new': {
          const event = await sendNativeRequest(
            'conversation.site.new',
            { siteOrigin: request.siteOrigin },
            'conversation.site.active.ready',
          );
          return { accepted: event !== undefined };
        }
        case 'yanyi.model.capability.verify': {
          // One user-initiated probe; the host performs a single minimal request.
          const event = await sendNativeRequest(
            'model.capability.verify',
            {
              providerId: request.providerId ?? 'deepseek',
              modelId: request.modelId,
              probeThinking: request.probeThinking ?? false,
            },
            'model.capability.verified',
            30_000,
          );
          const payload = event?.payload as
            { status?: unknown; message?: unknown; models?: unknown[] } | undefined;
          return {
            accepted: event !== undefined,
            status: typeof payload?.status === 'string' ? payload.status : undefined,
            message: typeof payload?.message === 'string' ? payload.message : undefined,
            models: payload?.models ?? [],
          };
        }
      }
    })();
  });
});
