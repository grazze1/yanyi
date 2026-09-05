import type {
  AssistantIntent,
  AssistantTransientMessage,
  TranslationProfile,
} from '@yanyi/protocol';
import type { KnowledgeMode } from '@yanyi/shared-types';

export type ConversationStatus = 'idle' | 'sending' | 'streaming' | 'stopping' | 'error';
export type MessageStatus = 'sending' | 'streaming' | 'complete' | 'failed' | 'cancelled';

export interface ConversationCitation {
  id: string;
  title: string;
  excerpt: string;
  locator?: string;
  source: 'page' | 'workspace' | 'general';
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  intent: AssistantIntent;
  createdAt: number;
  taskId?: string;
  error?: string;
  citations?: ConversationCitation[];
}

export interface SelectionContext {
  /** Present only for one-shot Side Panel launches created by the background worker. */
  launchToken?: string;
  text: string;
  sentence?: string;
  adjacentText?: string;
  paragraph?: string;
  heading?: string;
  headingPath?: string[];
  componentTitle?: string;
  componentText?: string;
  labels?: string[];
  buttonText?: string;
  domRole?: string;
  domainId?: string;
  technicalTags?: string[];
  glossaryRules?: string[];
  contextHash?: string;
  title: string;
  url: string;
  isPdf: boolean;
  intent: string;
  tabId: number;
  frameId?: number;
  capturedAt: number;
  pageSessionId?: string;
}

export interface ConversationContext {
  selection: string;
  sentence?: string;
  adjacentText?: string;
  paragraph?: string;
  heading?: string;
  headingPath?: string[];
  componentTitle?: string;
  componentText?: string;
  labels?: string[];
  buttonText?: string;
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

export interface AssistantStartRequest {
  clientRequestId: string;
  conversationId?: string;
  knowledgeMode: KnowledgeMode;
  intent: AssistantIntent;
  prompt: string;
  context: ConversationContext;
  profile: TranslationProfile & { providerId?: string; apiProfileId?: string };
  transientMessages?: AssistantTransientMessage[];
  /** URL origin of the page, so the host can reuse this site's conversation. */
  siteOrigin?: string;
}

export interface AssistantStartResult {
  accepted: boolean;
  taskId?: string;
  conversationId?: string;
  knowledgeMode?: KnowledgeMode;
  error?: string;
}

export type AssistantStreamEvent =
  | {
      type: 'accepted';
      taskId: string;
      conversationId?: string;
      knowledgeMode?: KnowledgeMode;
    }
  | { type: 'delta'; taskId: string; delta: string; conversationId?: string }
  | {
      type: 'completed';
      taskId: string;
      answer: string;
      conversationId?: string;
      knowledgeMode?: KnowledgeMode;
      citations?: ConversationCitation[];
    }
  | { type: 'failed'; taskId: string; message: string; conversationId?: string }
  | { type: 'cancelled'; taskId: string; conversationId?: string };

export interface ConversationHandoff {
  conversationId?: string;
  knowledgeMode: KnowledgeMode;
  context: ConversationContext;
  messages: ConversationMessage[];
  activeTaskId?: string;
  modelSelection?: AssistantModelSelection;
  capturedAt: number;
}

export interface ActiveConversationReference {
  conversationId: string;
  knowledgeMode: KnowledgeMode;
  savedAt: number;
}

export interface RestoredConversation {
  conversationId: string;
  knowledgeMode: KnowledgeMode;
  context: ConversationContext;
  messages: ConversationMessage[];
}

export interface AssistantModelOption {
  providerId: string;
  modelId: string;
  owner: string;
  availability: 'available' | 'unavailable' | 'unknown';
  capabilityStatus: 'verified' | 'unverified' | 'manual';
  supportsThinking?: boolean;
  reasoningEfforts: ('high' | 'max')[];
  supportsStreaming?: boolean;
  supportsJsonOutput?: boolean;
  supportsTools?: boolean;
  contextWindow?: number;
}

export interface AssistantModelSelection {
  scope: 'global' | 'task' | 'conversation';
  scopeId: string;
  task: string;
  providerId: string;
  apiProfileId?: string;
  modelId: string;
  thinkingEnabled: boolean;
  reasoningEffort?: 'high' | 'max';
}

export interface AssistantAdapter {
  start(request: AssistantStartRequest): Promise<AssistantStartResult>;
  cancel(taskId: string): Promise<boolean>;
  subscribe(listener: (event: AssistantStreamEvent) => void): () => void;
  consumeSelection(): Promise<SelectionContext | undefined>;
  loadHandoff(): Promise<ConversationHandoff | undefined>;
  saveHandoff(handoff: ConversationHandoff): Promise<void>;
  /** Active conversations are scoped to the page's URL origin. */
  loadActiveConversation?(
    pageUrl: string | undefined,
  ): Promise<ActiveConversationReference | undefined>;
  saveActiveConversation?(
    reference: ActiveConversationReference | undefined,
    pageUrl: string | undefined,
  ): Promise<void>;
  /** Ends the current site's conversation so the next question starts a new one. */
  clearActiveConversation?(pageUrl: string | undefined): Promise<void>;
  loadConversation?(conversationId: string): Promise<RestoredConversation | undefined>;
  openSidePanel(): Promise<boolean>;
  highlightSource(context: ConversationContext, excerpt: string): Promise<boolean>;
  saveNote(content: string, sourceExcerpt?: string): Promise<boolean>;
  saveGlossary(sourceTerm: string, targetTerm: string): Promise<boolean>;
  protectTerm(sourceTerm: string): Promise<boolean>;
  loadModelCatalog(providerId?: string, refresh?: boolean): Promise<AssistantModelOption[]>;
  loadModelSelection(
    conversationId: string | undefined,
    task: string,
  ): Promise<AssistantModelSelection | undefined>;
  saveModelSelection(selection: AssistantModelSelection): Promise<boolean>;
  /**
   * Runs one user-initiated capability probe. Never called automatically, so the
   * user's API budget is not spent on background verification.
   */
  verifyModelCapability?(
    providerId: string,
    modelId: string,
    probeThinking: boolean,
  ): Promise<{ status?: string; message?: string; models?: AssistantModelOption[] }>;
  loadTerminalEvent?(taskId: string): Promise<AssistantStreamEvent | undefined>;
}
