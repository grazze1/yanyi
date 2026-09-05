/**
 * Typed mapping of schema/envelope.schema.json. The JSON Schema is the wire
 * contract; this module intentionally exposes only the payloads accepted by
 * the v1 Native Messaging bridge.
 */
export const PROTOCOL_VERSION = 1 as const;
export const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;
export const MAX_TRANSLATION_SEGMENTS = 160;
export const MAX_TRANSLATION_SEGMENT_CHARS = 1200;
export const MAX_TRANSLATION_TECHNICAL_TAGS = 16;
export const MAX_TRANSLATION_TECHNICAL_TAG_CHARS = 64;
export const MAX_TRANSLATION_LANGUAGE_CHARS = 32;

export type TranslationTaskState =
  | 'idle'
  | 'scanning'
  | 'queued'
  | 'translating'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'partial'
  | 'error'
  | 'offline';

export type TranslationSegmentState = 'queued' | 'translating' | 'completed' | 'failed' | 'stale';
export type TranslationModel = string;
export type ThinkingMode = 'enabled' | 'disabled';
export type ReasoningEffort = 'high' | 'max';
export type KnowledgeMode = 'hybrid' | 'page_only' | 'general';
export type UntranslatedReason =
  | 'ignored'
  | 'protected'
  | 'failed'
  | 'stale'
  | 'over_budget'
  | 'unsupported'
  | 'cancelled'
  | 'not_scanned';
export type TranslationDomRole =
  | 'heading'
  | 'paragraph'
  | 'button'
  | 'link'
  | 'navigation'
  | 'tag'
  | 'table_cell'
  | 'list_item'
  | 'label'
  | 'text';

export interface ScanDiagnostics {
  discoveredVisible: number;
  eligible: number;
  protected: number;
  ignored: number;
  queued: number;
  completed: number;
  failed: number;
  stale: number;
  overBudget: number;
  unsupported: number;
  cancelled: number;
  notScanned: number;
}

export interface PageTranslationJob {
  pageJobId: string;
  pageSessionId: string;
  state: 'scanning' | 'translating' | 'paused' | 'completed' | 'partial' | 'failed' | 'cancelled';
  batchIndex: number;
  hasMore: boolean;
  diagnostics: ScanDiagnostics;
}

export interface PageTranslationProfile {
  pageTitle: string;
  site: string;
  documentType: string;
  detectedDomain?: string;
  sectionHeadings: string[];
  namedEntities: string[];
  productNames: string[];
  acronyms: string[];
  protectedTerms: string[];
  uiVocabulary: string[];
}

export interface TranslationSegmentInput {
  segmentId: string;
  sourceText: string;
  sourceHash: string;
  placeholders: string[];
  /** 0 is viewport-visible and runs first. */
  priority: number;
  /** Stable within one page session; all parts of a long TextNode share it. */
  nodeId?: string;
  partIndex?: number;
  partCount?: number;
  domRole?: TranslationDomRole;
  componentId?: string;
}

export interface TranslationProfile {
  model: TranslationModel;
  providerId?: string;
  apiProfileId?: string;
  thinking: ThinkingMode;
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
  timeoutMs?: number;
  streaming?: boolean;
}

export type CapabilityVerification = 'verified' | 'provider_reported' | 'manual' | 'unverified';
export type ModelAvailability = 'available' | 'unavailable' | 'unknown';
export interface ModelCapabilities {
  supportsStreaming?: boolean;
  supportsThinking?: boolean;
  reasoningEfforts?: ReasoningEffort[];
  supportsTools?: boolean;
  supportsJsonSchema?: boolean;
  contextWindow?: number;
  verification: CapabilityVerification;
}

export interface ModelCatalogEntry {
  providerId: string;
  modelId: string;
  owner: string;
  availability: ModelAvailability;
  capabilityStatus: 'verified' | 'unverified' | 'manual';
  supportsThinking: boolean | null;
  reasoningEffortsJson: string;
  supportsStreaming: boolean | null;
  supportsJsonOutput: boolean | null;
  supportsTools: boolean | null;
  contextWindow: number | null;
  metadataJson: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelSelectionOverride {
  apiProfileId?: string;
  modelId?: string;
  thinking?: ThinkingMode;
  reasoningEffort?: ReasoningEffort;
}

export interface TranslationStartPayload {
  taskId: string;
  tabId: number;
  frameId: number;
  pageSessionId: string;
  sourceLanguage?: string;
  targetLanguage: string;
  promptVersion: string;
  domainId?: string;
  technicalTags?: string[];
  workspaceId?: string;
  siteDomain?: string;
  glossaryVersion: number;
  translationMode: 'replace' | 'below' | 'bilingual';
  websiteRuleVersion: number;
  segments: TranslationSegmentInput[];
  profile: TranslationProfile;
  pageJobId?: string;
  batchIndex?: number;
  finalBatch?: boolean;
  scanDiagnostics?: ScanDiagnostics;
  pageProfile?: PageTranslationProfile;
}

export interface TranslationTaskPayload {
  taskId: string;
}

export interface TranslationSegmentEventPayload extends TranslationTaskPayload {
  segmentId: string;
  sourceHash: string;
  translation?: string;
  delta?: string;
  error?: ProtocolError;
}

export interface TranslationProgressPayload extends TranslationTaskPayload {
  completed: number;
  failed: number;
  total: number;
}

export interface TranslationScanReportPayload extends TranslationTaskPayload {
  pageJobId: string;
  pageSessionId: string;
  diagnostics: ScanDiagnostics;
  segmentStates: Record<string, 'failed' | 'stale' | 'cancelled'>;
}

export interface TranslationScanReportReadyPayload {
  accepted: boolean;
  pageJobId?: string;
  state?: 'queued' | 'running' | 'paused' | 'completed' | 'partial' | 'failed' | 'cancelled';
  error?: Pick<ProtocolError, 'code'> & Partial<Omit<ProtocolError, 'code'>>;
}

export interface TranslationTerminalPayload extends TranslationProgressPayload {
  reason?: string;
}

export type AssistantIntent = 'translate' | 'explain' | 'follow_up' | 'chat';
export interface AssistantContext {
  selection: string;
  sentence?: string;
  adjacentSentences?: string[];
  paragraph?: string;
  heading?: string;
  sectionPath?: string[];
  componentTitle?: string;
  componentBody?: string;
  labels?: string[];
  buttons?: string[];
  domRole?: string;
  domainId?: string;
  technicalTags?: string[];
  glossaryRules?: string[];
  contextHash?: string;
  title?: string;
  url?: string;
  tabId?: number;
  frameId?: number;
  pageSessionId?: string;
  capturedAt?: number;
}
export interface AssistantStartPayload {
  taskId: string;
  intent: AssistantIntent;
  prompt: string;
  context: AssistantContext;
  profile: TranslationProfile;
  conversationId?: string;
  knowledgeMode?: KnowledgeMode;
  workspaceId?: string;
  /** Completed ephemeral messages promoted when a quick translation becomes a conversation. */
  transientMessages?: AssistantTransientMessage[];
}
export interface AssistantTransientMessage {
  role: 'user' | 'assistant';
  content: string;
  intent: AssistantIntent;
}
export interface AssistantEventPayload {
  taskId: string;
  conversationId?: string | null;
  messageId?: string;
  knowledgeMode?: KnowledgeMode;
  delta?: string;
  answer?: string;
  error?: ProtocolError;
  citations?: AssistantCitation[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

export interface AssistantCitation {
  id: string;
  title: string;
  excerpt: string;
  source: 'page' | 'workspace' | 'general';
  locator?: string;
}

export type ConversationStatus = 'active' | 'archived' | 'legacy';
export type ConversationTitleSource = 'pending' | 'auto' | 'user' | 'legacy';
export type ConversationGenerationStatus =
  'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled';
export type StoredCitationSource = 'page' | 'workspace' | 'general_knowledge' | 'tool' | 'legacy';

export interface ConversationCitationRecord {
  id: string;
  messageId: string;
  sourceKind: StoredCitationSource;
  sourceId: string | null;
  documentId: string | null;
  sectionId: string | null;
  sourceTitle: string;
  sourceExcerpt: string;
  locator: Record<string, unknown>;
  createdAt: string;
}

export interface ConversationMessageRecord {
  id: string;
  conversationId: string;
  parentMessageId: string | null;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  contentTruncated: boolean;
  intent: AssistantIntent | null;
  contentFormat: 'markdown' | 'plain_text' | 'json';
  generationStatus: ConversationGenerationStatus;
  modelId: string | null;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort | null;
  sequence: number;
  createdAt: string;
  updatedAt: string;
  citations: ConversationCitationRecord[];
}

export interface ConversationRecord {
  id: string;
  workspaceId: string | null;
  documentId: string | null;
  title: string;
  titleSource: ConversationTitleSource;
  status: ConversationStatus;
  lastMessageAt: string | null;
  knowledgeMode: KnowledgeMode;
  currentModelId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessage: string;
}

export interface ConversationDetailRecord {
  conversation: ConversationRecord;
  messages: ConversationMessageRecord[];
  messageOffset: number;
  messageLimit: number;
  totalMessages: number;
  hasMore: boolean;
}

export interface ConversationListRequestPayload {
  search?: string;
  status?: ConversationStatus;
  offset?: number;
  limit?: number;
}

export interface ConversationListReadyPayload {
  conversations: ConversationRecord[];
}

export interface ConversationGetRequestPayload {
  conversationId: string;
  messageOffset?: number;
  messageLimit?: number;
}

export interface ConversationGetReadyPayload {
  conversation: ConversationDetailRecord;
}

export interface ConversationRenameRequestPayload {
  conversationId: string;
  title: string;
}

export interface ConversationArchiveRequestPayload {
  conversationId: string;
  archived: boolean;
}

export interface ConversationDeleteRequestPayload {
  conversationId: string;
  confirmed: true;
}

export interface ModelCatalogRequestPayload {
  providerId?: string;
  refresh?: boolean;
}

export interface ModelCatalogReadyPayload {
  providerId: string;
  models: ModelCatalogEntry[];
}

export interface ModelSelectionRequestPayload {
  conversationId?: string;
  task: string;
}

export interface ModelSelectionInputPayload {
  scope: 'global' | 'task' | 'conversation';
  scopeId: string;
  task: string;
  providerId: string;
  apiProfileId?: string;
  modelId: string;
  thinkingEnabled: boolean;
  reasoningEffort?: ReasoningEffort;
}

export interface ModelSelectionRecord {
  scope: 'global' | 'task' | 'conversation';
  scopeId: string;
  task: string;
  providerId: string;
  apiProfileId: string | null;
  modelId: string;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort | null;
  updatedAt: string;
}

export interface ModelSelectionReadyPayload {
  selection: ModelSelectionRecord | null;
}

export const MESSAGE_TYPES = [
  'system.handshake.request',
  'system.handshake.ready',
  'system.error',
  'request.cancel',
  'translation.start',
  'translation.accepted',
  'translation.pause',
  'translation.resume',
  'translation.cancel',
  'translation.segment.started',
  'translation.segment.delta',
  'translation.segment.completed',
  'translation.segment.failed',
  'translation.progress',
  'translation.completed',
  'translation.cancelled',
  'translation.failed',
  'translation.scan.report',
  'translation.scan.report.ready',
  'translation.batch.continue',
  'assistant.start',
  'assistant.accepted',
  'assistant.cancel',
  'assistant.delta',
  'assistant.completed',
  'assistant.cancelled',
  'assistant.failed',
  'conversation.get.request',
  'conversation.get.ready',
  'conversation.list.request',
  'conversation.list.ready',
  'conversation.rename.request',
  'conversation.renamed',
  'conversation.archive.request',
  'conversation.archived',
  'conversation.delete.request',
  'conversation.deleted',
  // Site-scoped active conversation: one conversation per URL origin, replaced
  // only when the user opens another conversation or starts a new chat.
  'conversation.site.active.get',
  'conversation.site.active.set',
  'conversation.site.new',
  'conversation.site.active.ready',
  'model.catalog.request',
  'model.catalog.ready',
  'model.selection.get',
  'model.selection.ready',
  'model.selection.set',
  'model.selection.saved',
  // User-initiated capability probe. "Unverified" is a status, not a lock.
  'model.capability.verify',
  'model.capability.verified',
  'glossary.quick-add',
  'glossary.saved',
  'note.create',
  'note.created',
  'site.policy.request',
  'site.policy.ready',
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface ProtocolEnvelope<T extends object = Record<string, unknown>> {
  protocolVersion: typeof PROTOCOL_VERSION;
  requestId: string;
  type: MessageType;
  sequence: number;
  done: boolean;
  idempotencyKey?: string;
  payload: T;
}

export interface HandshakeRequest {
  extensionVersion: string;
  supportedProtocolVersions: number[];
}

export interface HandshakeReady {
  hostVersion: string;
  negotiatedProtocolVersion: typeof PROTOCOL_VERSION;
  capabilities: string[];
  databaseSchemaVersion: number;
}

export interface ProtocolError {
  code: string;
  message: string;
  recoverable: boolean;
  retryAfterMs?: number;
}

const messageTypes = new Set<MessageType>(MESSAGE_TYPES);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isProtocolEnvelope(value: unknown): value is ProtocolEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.protocolVersion === PROTOCOL_VERSION &&
    typeof candidate.requestId === 'string' &&
    UUID_PATTERN.test(candidate.requestId) &&
    typeof candidate.type === 'string' &&
    messageTypes.has(candidate.type as MessageType) &&
    Number.isInteger(candidate.sequence) &&
    Number(candidate.sequence) >= 0 &&
    typeof candidate.done === 'boolean' &&
    typeof candidate.payload === 'object' &&
    candidate.payload !== null &&
    !Array.isArray(candidate.payload) &&
    (candidate.idempotencyKey === undefined ||
      (typeof candidate.idempotencyKey === 'string' &&
        candidate.idempotencyKey.length > 0 &&
        candidate.idempotencyKey.length <= 128))
  );
}

function isBoundedOptionalString(value: unknown, maximum: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maximum);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isScanDiagnostics(value: unknown): value is ScanDiagnostics {
  if (typeof value !== 'object' || value === null) return false;
  const diagnostics = value as Record<string, unknown>;
  return [
    'discoveredVisible',
    'eligible',
    'protected',
    'ignored',
    'queued',
    'completed',
    'failed',
    'stale',
    'overBudget',
    'unsupported',
    'cancelled',
    'notScanned',
  ].every((field) => isNonNegativeInteger(diagnostics[field]));
}

function isPageTranslationProfile(value: unknown): value is PageTranslationProfile {
  if (typeof value !== 'object' || value === null) return false;
  const profile = value as Record<string, unknown>;
  const boundedItems = (items: unknown): boolean =>
    Array.isArray(items) &&
    items.length <= 64 &&
    items.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 240);
  return (
    typeof profile.pageTitle === 'string' &&
    profile.pageTitle.length <= 500 &&
    typeof profile.site === 'string' &&
    profile.site.trim().length > 0 &&
    profile.site.length <= 253 &&
    typeof profile.documentType === 'string' &&
    profile.documentType.trim().length > 0 &&
    profile.documentType.length <= 64 &&
    isBoundedOptionalString(profile.detectedDomain, 128) &&
    boundedItems(profile.sectionHeadings) &&
    boundedItems(profile.namedEntities) &&
    boundedItems(profile.productNames) &&
    boundedItems(profile.acronyms) &&
    boundedItems(profile.protectedTerms) &&
    boundedItems(profile.uiVocabulary)
  );
}

export function isTranslationStartPayload(value: unknown): value is TranslationStartPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Partial<TranslationStartPayload>;
  const rawProfile = (value as Record<string, unknown>).profile;
  const profile =
    typeof rawProfile === 'object' && rawProfile !== null
      ? (rawProfile as Record<string, unknown>)
      : undefined;
  const hasPageJob = payload.pageJobId !== undefined;
  const pageJobFieldsAreCoherent = hasPageJob
    ? typeof payload.pageJobId === 'string' &&
      payload.pageJobId.trim().length > 0 &&
      payload.pageJobId.length <= 128 &&
      isNonNegativeInteger(payload.batchIndex) &&
      payload.batchIndex < 1_000_000 &&
      (payload.finalBatch === undefined || typeof payload.finalBatch === 'boolean')
    : payload.batchIndex === undefined && !payload.finalBatch;
  return (
    typeof payload.taskId === 'string' &&
    payload.taskId.trim().length > 0 &&
    isNonNegativeInteger(payload.tabId) &&
    isNonNegativeInteger(payload.frameId) &&
    typeof payload.pageSessionId === 'string' &&
    payload.pageSessionId.trim().length > 0 &&
    pageJobFieldsAreCoherent &&
    (payload.scanDiagnostics === undefined || isScanDiagnostics(payload.scanDiagnostics)) &&
    (payload.pageProfile === undefined || isPageTranslationProfile(payload.pageProfile)) &&
    (payload.sourceLanguage === undefined ||
      (typeof payload.sourceLanguage === 'string' &&
        payload.sourceLanguage.trim().length > 0 &&
        payload.sourceLanguage.length <= MAX_TRANSLATION_LANGUAGE_CHARS)) &&
    typeof payload.targetLanguage === 'string' &&
    payload.targetLanguage.trim().length > 0 &&
    payload.targetLanguage.length <= MAX_TRANSLATION_LANGUAGE_CHARS &&
    typeof payload.promptVersion === 'string' &&
    payload.promptVersion.trim().length > 0 &&
    payload.promptVersion.length <= 64 &&
    isBoundedOptionalString(payload.domainId, 128) &&
    isBoundedOptionalString(payload.workspaceId, 128) &&
    isBoundedOptionalString(payload.siteDomain, 253) &&
    (payload.technicalTags === undefined ||
      (Array.isArray(payload.technicalTags) &&
        payload.technicalTags.length <= MAX_TRANSLATION_TECHNICAL_TAGS &&
        payload.technicalTags.every(
          (tag) =>
            typeof tag === 'string' &&
            tag.trim().length > 0 &&
            tag.length <= MAX_TRANSLATION_TECHNICAL_TAG_CHARS,
        ))) &&
    isNonNegativeInteger(payload.glossaryVersion) &&
    (payload.translationMode === 'replace' ||
      payload.translationMode === 'below' ||
      payload.translationMode === 'bilingual') &&
    isNonNegativeInteger(payload.websiteRuleVersion) &&
    Array.isArray(payload.segments) &&
    payload.segments.length > 0 &&
    payload.segments.length <= MAX_TRANSLATION_SEGMENTS &&
    payload.segments.every(
      (segment) =>
        typeof segment.segmentId === 'string' &&
        segment.segmentId.trim().length > 0 &&
        segment.segmentId.length <= 160 &&
        typeof segment.sourceText === 'string' &&
        segment.sourceText.length > 0 &&
        segment.sourceText.length <= MAX_TRANSLATION_SEGMENT_CHARS &&
        typeof segment.sourceHash === 'string' &&
        segment.sourceHash.length >= 8 &&
        segment.sourceHash.length <= 64 &&
        Array.isArray(segment.placeholders) &&
        segment.placeholders.length <= 80 &&
        segment.placeholders.every((placeholder) => typeof placeholder === 'string') &&
        isNonNegativeInteger(segment.priority) &&
        segment.priority <= 9 &&
        (segment.nodeId === undefined ||
          (typeof segment.nodeId === 'string' &&
            segment.nodeId.trim().length > 0 &&
            segment.nodeId.length <= 160)) &&
        ((segment.partIndex === undefined && segment.partCount === undefined) ||
          (isNonNegativeInteger(segment.partIndex) &&
            isNonNegativeInteger(segment.partCount) &&
            segment.partCount > 0 &&
            segment.partCount <= 1_024 &&
            segment.partIndex < segment.partCount)) &&
        (segment.domRole === undefined ||
          [
            'heading',
            'paragraph',
            'button',
            'link',
            'navigation',
            'tag',
            'table_cell',
            'list_item',
            'label',
            'text',
          ].includes(segment.domRole)) &&
        (segment.componentId === undefined ||
          (typeof segment.componentId === 'string' &&
            segment.componentId.trim().length > 0 &&
            segment.componentId.length <= 160)),
    ) &&
    typeof profile?.model === 'string' &&
    profile.model.length > 0 &&
    profile.model.length <= 128 &&
    (profile.providerId === undefined ||
      (typeof profile.providerId === 'string' &&
        profile.providerId.trim().length > 0 &&
        profile.providerId.length <= 128)) &&
    (profile.apiProfileId === undefined ||
      (typeof profile.apiProfileId === 'string' &&
        profile.apiProfileId.trim().length > 0 &&
        profile.apiProfileId.length <= 128)) &&
    (profile.thinking === 'enabled' || profile.thinking === 'disabled') &&
    (profile.reasoningEffort === undefined ||
      profile.reasoningEffort === 'high' ||
      profile.reasoningEffort === 'max') &&
    (profile.thinking === 'enabled' || profile.reasoningEffort === undefined) &&
    (profile.maxOutputTokens === undefined ||
      (Number.isInteger(profile.maxOutputTokens) &&
        Number(profile.maxOutputTokens) >= 1 &&
        Number(profile.maxOutputTokens) <= 393_216)) &&
    (profile.timeoutMs === undefined ||
      (Number.isInteger(profile.timeoutMs) &&
        Number(profile.timeoutMs) >= 1_000 &&
        Number(profile.timeoutMs) <= 600_000)) &&
    (profile.streaming === undefined || typeof profile.streaming === 'boolean')
  );
}

export function isTranslationScanReportPayload(
  value: unknown,
): value is TranslationScanReportPayload {
  if (typeof value !== 'object' || value === null) return false;
  const report = value as Partial<TranslationScanReportPayload>;
  const segmentStates = (value as Record<string, unknown>).segmentStates;
  if (
    typeof report.taskId !== 'string' ||
    report.taskId.trim().length === 0 ||
    report.taskId.length > 128 ||
    typeof report.pageJobId !== 'string' ||
    report.pageJobId.trim().length === 0 ||
    report.pageJobId.length > 128 ||
    typeof report.pageSessionId !== 'string' ||
    report.pageSessionId.trim().length === 0 ||
    report.pageSessionId.length > 256 ||
    !isScanDiagnostics(report.diagnostics) ||
    typeof segmentStates !== 'object' ||
    segmentStates === null
  )
    return false;
  const states = Object.entries(segmentStates);
  return (
    states.length <= MAX_TRANSLATION_SEGMENTS &&
    states.every(
      ([segmentId, state]) =>
        segmentId.trim().length > 0 &&
        segmentId.length <= 256 &&
        (state === 'failed' || state === 'stale' || state === 'cancelled'),
    )
  );
}

export function createEnvelope<T extends object>(
  type: MessageType,
  payload: T,
  options: { requestId?: string; sequence?: number; done?: boolean; idempotencyKey?: string } = {},
): ProtocolEnvelope<T> {
  const envelope: ProtocolEnvelope<T> = {
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId ?? crypto.randomUUID(),
    type,
    sequence: options.sequence ?? 0,
    done: options.done ?? true,
    payload,
  };
  if (options.idempotencyKey !== undefined) envelope.idempotencyKey = options.idempotencyKey;
  return envelope;
}
