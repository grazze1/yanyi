import { invoke } from '@tauri-apps/api/core';

export interface EnvironmentStatus {
  appVersion: string;
  databasePath: string;
  databaseSchemaVersion: number;
  nativeHostName: string;
  protocolVersion: number;
}
export interface DashboardSummary {
  workspaces: number;
  glossaryEntries: number;
  candidateTerms: number;
  conversations: number;
  confirmedMemories: number;
  translatedPages: number;
  cacheEntries: number;
}
export interface WorkspaceRecord {
  id: string;
  name: string;
  description: string;
  primaryDomain?: string;
  icon: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface GlossaryEntryRecord {
  id: string;
  workspaceId?: string;
  domainId?: string;
  sourceTerm: string;
  targetTerm?: string;
  strategy: string;
  scope: string;
  source: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface CandidateTermRecord {
  id: string;
  workspaceId?: string;
  documentId?: string;
  sourceTerm: string;
  suggestedTranslation?: string;
  occurrenceCount: number;
  confidence?: number;
  exampleText?: string;
  state: string;
  createdAt: string;
  updatedAt: string;
}
export interface WebsiteRuleRecord {
  id: string;
  workspaceId?: string;
  domainPattern: string;
  urlPattern?: string;
  defaultMode?: string;
  dynamicStrategy: string;
  translateNewContent: boolean;
  autoTranslate: boolean;
  translateNavigation: boolean;
  translateButtons: boolean;
  translateTables: boolean;
  protectLinkText: boolean;
  pdfStrategy: string;
  isBuiltin: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface ConversationRecord {
  id: string;
  workspaceId?: string;
  documentId?: string;
  title: string;
  status: ConversationStatus;
  lastMessageAt?: string;
  knowledgeMode: KnowledgeMode;
  currentModelId?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastMessage: string;
}
export type ConversationStatus = 'active' | 'archived' | 'legacy';
export type KnowledgeMode = 'hybrid' | 'page_only' | 'general';
export interface ConversationMessageRecord {
  id: string;
  conversationId: string;
  parentMessageId?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  contentTruncated: boolean;
  intent?: string;
  contentFormat: 'markdown' | 'plain_text' | 'json';
  generationStatus: 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled';
  modelId?: string;
  thinkingEnabled: boolean;
  reasoningEffort?: 'high' | 'max';
  sequence: number;
  createdAt: string;
  updatedAt: string;
}
export interface ConversationDetailRecord {
  conversation: ConversationRecord;
  messages: ConversationMessageRecord[];
  messageOffset: number;
  messageLimit: number;
  totalMessages: number;
  hasMore: boolean;
}
export interface MemoryRecord {
  id: string;
  workspaceId?: string;
  kind: string;
  content: string;
  sourceType: string;
  sourceId?: string;
  confirmedAt?: string;
  isCrossWorkspace: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface MemoryCandidateRecord {
  id: string;
  workspaceId?: string;
  content: string;
  sourceType: string;
  sourceId?: string;
  confidence?: number;
  state: string;
  createdAt: string;
  updatedAt: string;
}
/**
 * Global memory types.
 *
 * Global memory records who the user is and how they want answers written. It is
 * separate from the glossary (how a term is translated) and from workspaces
 * (which documents belong to a project).
 */
export const globalMemoryTypes = [
  'profile',
  'preference',
  'response_style',
  'domain_background',
  'translation_preference',
  'personal_context',
  'custom',
] as const;
export type GlobalMemoryType = (typeof globalMemoryTypes)[number];

export const globalMemoryTypeLabels: Record<GlobalMemoryType, string> = {
  profile: '个人资料',
  preference: '使用偏好',
  response_style: '回答风格',
  domain_background: '领域背景',
  translation_preference: '翻译偏好',
  personal_context: '个人语境',
  custom: '自定义',
};

export interface GlobalMemoryRecord {
  id: string;
  type: GlobalMemoryType;
  title: string;
  content: string;
  enabled: boolean;
  pinned: boolean;
  priority: number;
  sourceType: string;
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  usageCount: number;
}

export interface GlobalMemoryInput {
  type: GlobalMemoryType;
  title: string;
  content: string;
  enabled: boolean;
  pinned: boolean;
  priority: number;
  tags: string[];
}

export interface GlobalMemoryCandidateRecord {
  id: string;
  jobId: string;
  type: GlobalMemoryType;
  title: string;
  content: string;
  state: 'pending' | 'accepted' | 'rejected' | 'duplicate';
  glossaryHint: boolean;
  ordinal: number;
}

export interface GlobalMemoryImportPreview {
  jobId: string;
  sourceName: string;
  sourceFormat: string;
  candidates: GlobalMemoryCandidateRecord[];
}

export interface GlobalMemoryImportJobRecord {
  id: string;
  sourceName: string;
  sourceFormat: string;
  sourceBytes: number;
  state: string;
  candidateCount: number;
  acceptedCount: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalMemorySnapshot {
  version: number;
  fingerprint: string;
  stableProfile: string;
  stablePreferences: string;
  stableResponseStyle: string;
  memoryCount: number;
}

export interface TaskPresetRecord {
  id: string;
  task: string;
  label: string;
  modelId: string;
  thinkingEnabled: boolean;
  reasoningEffort?: string;
  maxOutputTokens: number;
  timeoutMs: number;
  streaming: boolean;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface ModelCatalogRecord {
  providerId: string;
  modelId: string;
  owner: string;
  availability: 'available' | 'unavailable' | 'unknown';
  capabilityStatus: 'verified' | 'unverified' | 'manual';
  supportsThinking?: boolean;
  reasoningEffortsJson: string;
  supportsStreaming?: boolean;
  supportsJsonOutput?: boolean;
  supportsTools?: boolean;
  contextWindow?: number;
  metadataJson: string;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface ModelSelectionRecord {
  scope: 'global' | 'task' | 'conversation';
  scopeId: string;
  task: string;
  apiProfileId?: string;
  modelId: string;
  thinkingEnabled: boolean;
  reasoningEffort?: 'high' | 'max';
  updatedAt: string;
}
export interface ModelSelectionInput {
  scope: ModelSelectionRecord['scope'];
  scopeId: string;
  task: string;
  apiProfileId?: string;
  modelId: string;
  thinkingEnabled: boolean;
  reasoningEffort?: 'high' | 'max';
}
export interface ApiConfigStatus {
  configured: boolean;
  baseUrl: string;
  maskedKey?: string;
  proxyUrl?: string;
  firstTokenTimeoutMs: number;
  totalTimeoutMs: number;
  maxConcurrency: number;
  maxRetries: number;
}
export interface NativeRegistrationStatus {
  edge: boolean;
  chrome: boolean;
}
export interface ApiSmokeResult {
  model: string;
  availableModels: string[];
  elapsedMs: number;
  outputCharacters: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export const desktopApi = {
  environment: () => invoke<EnvironmentStatus>('environment_status'),
  dashboard: () => invoke<DashboardSummary>('dashboard_summary'),
  workspaces: () => invoke<WorkspaceRecord[]>('workspace_list', { includeArchived: true }),
  saveWorkspace: (input: {
    id?: string | undefined;
    name: string;
    description: string;
    primaryDomain?: string | undefined;
    icon?: string | undefined;
  }) => invoke<WorkspaceRecord>('workspace_save', { input }),
  archiveWorkspace: (id: string, archived: boolean) =>
    invoke<null>('workspace_archive', { id, archived }),
  deleteWorkspace: (id: string) => invoke<null>('workspace_delete', { id }),
  glossary: (search = '') => invoke<GlossaryEntryRecord[]>('glossary_list', { search, limit: 100 }),
  saveGlossary: (input: {
    id?: string | undefined;
    sourceTerm: string;
    targetTerm?: string | undefined;
    strategy: string;
    scope: string;
  }) => invoke<GlossaryEntryRecord>('glossary_save', { input }),
  deleteGlossary: (id: string) => invoke<null>('glossary_delete', { id }),
  exportGlossary: () => invoke<string>('glossary_export'),
  importGlossary: (path: string, strategy: 'merge' | 'overwrite' | 'skip') =>
    invoke<{ inserted: number; updated: number; skipped: number }>('glossary_import', {
      path,
      strategy,
    }),
  candidates: () =>
    invoke<CandidateTermRecord[]>('candidate_list', { state: 'pending', limit: 100 }),
  setCandidateState: (id: string, state: string) =>
    invoke<null>('candidate_set_state', { id, state }),
  websiteRules: () => invoke<WebsiteRuleRecord[]>('website_rule_list'),
  saveWebsiteRule: (input: {
    domainPattern: string;
    urlPattern?: string | undefined;
    defaultMode?: string | undefined;
    translateNewContent: boolean;
    autoTranslate: boolean;
    translateNavigation: boolean;
    translateButtons: boolean;
    translateTables: boolean;
    protectLinkText: boolean;
    pdfStrategy: string;
  }) => invoke<WebsiteRuleRecord>('website_rule_save', { input }),
  conversations: (query: {
    search: string;
    status?: ConversationStatus;
    offset: number;
    limit: number;
  }) => invoke<ConversationRecord[]>('conversation_list', query),
  conversation: (conversationId: string, messageOffset = 0, messageLimit = 40) =>
    invoke<ConversationDetailRecord>('conversation_get', {
      conversationId,
      messageOffset,
      messageLimit,
    }),
  renameConversation: (conversationId: string, title: string) =>
    invoke<null>('conversation_rename', { conversationId, title }),
  archiveConversation: (conversationId: string, archived: boolean) =>
    invoke<null>('conversation_archive', { conversationId, archived }),
  deleteConversation: (conversationId: string, confirmed: boolean) =>
    invoke<null>('conversation_delete', { conversationId, confirmed }),
  memories: (search = '') => invoke<MemoryRecord[]>('memory_list', { search, limit: 100 }),
  memoryCandidates: () => invoke<MemoryCandidateRecord[]>('memory_candidate_list'),
  setMemoryCandidateState: (id: string, state: 'confirmed' | 'rejected') =>
    invoke<null>('memory_candidate_set_state', { id, state }),

  // Global memory: real CRUD, reviewed import, and the cacheable stable snapshot.
  globalMemories: (search = '', memoryType?: GlobalMemoryType) =>
    invoke<GlobalMemoryRecord[]>('global_memory_list', {
      search,
      memoryType: memoryType ?? null,
      limit: 200,
    }),
  createGlobalMemory: (input: GlobalMemoryInput) =>
    invoke<string>('global_memory_create', { input }),
  updateGlobalMemory: (id: string, input: GlobalMemoryInput) =>
    invoke<null>('global_memory_update', { id, input }),
  setGlobalMemoryEnabled: (id: string, enabled: boolean) =>
    invoke<null>('global_memory_set_enabled', { id, enabled }),
  setGlobalMemoryPinned: (id: string, pinned: boolean) =>
    invoke<null>('global_memory_set_pinned', { id, pinned }),
  deleteGlobalMemory: (id: string) => invoke<null>('global_memory_delete', { id }),
  globalMemoryTags: (id: string) => invoke<string[]>('global_memory_tags', { id }),
  /** Parses a file into candidates; nothing is saved until the user confirms. */
  previewGlobalMemoryImport: (path: string, defaultType: GlobalMemoryType) =>
    invoke<GlobalMemoryImportPreview>('global_memory_import_preview', {
      path,
      defaultType,
    }),
  applyGlobalMemoryImport: (jobId: string, acceptedIds: string[]) =>
    invoke<number>('global_memory_import_apply', { jobId, acceptedIds }),
  discardGlobalMemoryImport: (jobId: string) =>
    invoke<null>('global_memory_import_discard', { jobId }),
  globalMemoryImportJobs: () => invoke<GlobalMemoryImportJobRecord[]>('global_memory_import_jobs'),
  exportGlobalMemories: () => invoke<string>('global_memory_export'),
  globalMemorySnapshot: () => invoke<GlobalMemorySnapshot>('global_memory_snapshot'),
  taskPresets: () => invoke<TaskPresetRecord[]>('task_preset_list'),
  modelCatalog: (providerId = 'deepseek') =>
    invoke<ModelCatalogRecord[]>('model_catalog_list', { providerId }),
  refreshModelCatalog: (providerId = 'deepseek') =>
    invoke<ModelCatalogRecord[]>('model_catalog_refresh', { providerId }),
  modelSelection: (task: string, conversationId?: string) =>
    invoke<ModelSelectionRecord | null>('model_selection_get', { conversationId, task }),
  saveModelSelection: (providerId: string, input: ModelSelectionInput) =>
    invoke<ModelSelectionRecord>('model_selection_set', { providerId, input }),
  apiStatus: () => invoke<ApiConfigStatus>('api_config_status'),
  saveApi: (input: {
    baseUrl: string;
    apiKey: string;
    proxyUrl?: string | undefined;
    firstTokenTimeoutMs: number;
    totalTimeoutMs: number;
    maxConcurrency: number;
    maxRetries: number;
  }) => invoke<ApiConfigStatus>('api_config_save', { input }),
  clearApi: () => invoke<ApiConfigStatus>('api_config_clear'),
  testApi: (model?: string) => invoke<ApiSmokeResult>('api_connection_test', { model }),
  nativeRegistration: () => invoke<NativeRegistrationStatus>('native_registration_status'),
  repairNativeRegistration: () => invoke<NativeRegistrationStatus>('native_registration_repair'),
  openDirectory: (kind: 'data' | 'logs') => invoke<null>('open_local_directory', { kind }),
  clearCache: () => invoke<number>('cache_clear'),
  exportData: () => invoke<string>('data_export'),
  scheduleImport: (path: string) => invoke<string>('data_import_schedule', { path }),
  exportDiagnostics: () => invoke<string>('diagnostic_export'),
  startupStatus: () => invoke<boolean>('startup_status'),
  setStartup: (enabled: boolean) => invoke<boolean>('startup_set', { enabled }),
};
