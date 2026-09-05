import type {
  PageTranslationProfile,
  ScanDiagnostics,
  TranslationSegmentEventPayload,
  TranslationSegmentInput,
} from '@yanyi/protocol';
import type { TranslationMode } from '@yanyi/shared-types';
import { MutationGuard } from './mutation-guard';
import { validatePlaceholders } from './placeholder-extractor';
import { TranslationRenderer } from './renderer';
import {
  scanPage,
  stableHash,
  TextNodeIdentityRegistry,
  type PageSegment,
  type SegmentationOptions,
  type SegmentationResult,
  type UntranslatedNode,
} from './segmenter';

export interface ContentScanResult {
  pageSessionId: string;
  segments: TranslationSegmentInput[];
  capped: boolean;
  continuationCursor?: number;
  diagnostics: ScanDiagnostics;
  untranslated: UntranslatedNode[];
  pageProfile: PageTranslationProfile;
}

export interface DynamicScanUpdate extends ContentScanResult {
  reason: 'mutation' | 'navigation';
}

export interface SegmentCompletionResult {
  /** Translation passed source/hash/placeholder validation. */
  accepted: boolean;
  /** The complete TextNode translation was atomically committed to the DOM. */
  rendered: boolean;
  /** This long-node part is waiting for its sibling parts. */
  pending: boolean;
  /** All part IDs made visible by this atomic commit. */
  committedSegmentIds: string[];
  /** Why a completion was rejected; stale nodes are superseded rather than failed. */
  reason?: 'stale' | 'failed';
}

export interface PageTranslationControllerOptions {
  onScanUpdate?: (update: DynamicScanUpdate) => void;
  debounceMs?: number;
  createSessionId?: () => string;
}

function wireSegment(segment: PageSegment): TranslationSegmentInput {
  const {
    node: _node,
    element: _element,
    sourceSnapshot: _sourceSnapshot,
    placeholdersDetailed: _placeholdersDetailed,
    domFingerprint: _domFingerprint,
    ...input
  } = segment;
  return input;
}

function rejected(reason: 'stale' | 'failed' = 'failed'): SegmentCompletionResult {
  return {
    accepted: false,
    rendered: false,
    pending: false,
    committedSegmentIds: [],
    reason,
  };
}

export class PageTranslationController {
  private result: SegmentationResult | undefined;
  private renderer: TranslationRenderer | undefined;
  private guard: MutationGuard | undefined;
  private readonly segments = new Map<string, PageSegment>();
  private readonly pendingByNode = new Map<string, Map<number, string>>();
  private readonly queuedNodeIds = new Set<string>();
  private readonly committedNodeIds = new Set<string>();
  private readonly failedNodeIds = new Set<string>();
  private readonly staleSegmentIds = new Set<string>();
  private identityRegistry = new TextNodeIdentityRegistry();
  private scanOptions: SegmentationOptions | undefined;
  private currentUrl = '';

  constructor(
    private readonly document: Document,
    private readonly options: PageTranslationControllerOptions = {},
  ) {}

  startScan(options?: SegmentationOptions): ContentScanResult {
    this.teardown();
    this.scanOptions = options;
    this.identityRegistry = new TextNodeIdentityRegistry();
    this.currentUrl = this.document.location.href;
    const result = scanPage(
      this.document,
      this.options.createSessionId?.() ?? crypto.randomUUID(),
      options,
      { identityRegistry: this.identityRegistry },
    );
    this.install(result);
    return this.toContentResult(result);
  }

  continueScan(cursor = this.result?.continuationCursor): ContentScanResult | undefined {
    const pageSessionId = this.result?.pageSessionId;
    if (pageSessionId === undefined || cursor === undefined) return undefined;
    const result = scanPage(
      this.document,
      pageSessionId,
      { ...this.scanOptions, continuationCursor: cursor },
      {
        identityRegistry: this.identityRegistry,
        excludeSegmentIds: new Set(this.segments.keys()),
      },
    );
    this.merge(result);
    return this.toContentResult(result);
  }

  completeSegment(
    event: TranslationSegmentEventPayload,
    mode: TranslationMode,
  ): SegmentCompletionResult {
    const segment = this.segments.get(event.segmentId);
    if (segment === undefined && this.staleSegmentIds.has(event.segmentId)) {
      return rejected('stale');
    }
    if (segment === undefined || event.translation === undefined) {
      this.incrementDiagnostic('failed');
      return rejected();
    }
    if (this.failedNodeIds.has(segment.nodeId)) return rejected();
    if (event.sourceHash !== segment.sourceHash || !segment.node.isConnected) {
      this.markStale(segment.nodeId);
      return rejected('stale');
    }
    if (!validatePlaceholders(event.translation, segment.placeholdersDetailed)) {
      this.incrementDiagnostic('failed');
      return rejected();
    }

    const existingRender = this.committedNodeIds.has(segment.nodeId);
    if (
      !existingRender &&
      stableHash(segment.node.data.normalize('NFKC')) !== segment.domFingerprint
    ) {
      this.markStale(segment.nodeId);
      return rejected('stale');
    }

    const pending = this.pendingByNode.get(segment.nodeId) ?? new Map<number, string>();
    const previous = pending.get(segment.partIndex);
    if (previous !== undefined && previous !== event.translation) {
      this.incrementDiagnostic('failed');
      return rejected();
    }
    pending.set(segment.partIndex, event.translation);
    this.pendingByNode.set(segment.nodeId, pending);

    const parts = [...this.segments.values()]
      .filter((candidate) => candidate.nodeId === segment.nodeId)
      .sort((left, right) => left.partIndex - right.partIndex);
    if (
      parts.length !== segment.partCount ||
      parts.some((part, index) => part.partIndex !== index)
    ) {
      this.incrementDiagnostic('failed');
      return rejected();
    }
    if (pending.size < segment.partCount) {
      return {
        accepted: true,
        rendered: false,
        pending: true,
        committedSegmentIds: [],
      };
    }

    const translations = parts.map((part) => pending.get(part.partIndex) ?? '');
    const rendered = this.renderer?.renderNode(parts, translations, mode) ?? false;
    if (!rendered) {
      this.incrementDiagnostic('failed');
      return rejected();
    }
    this.pendingByNode.delete(segment.nodeId);
    if (!this.committedNodeIds.has(segment.nodeId)) {
      this.committedNodeIds.add(segment.nodeId);
      this.incrementDiagnostic('completed');
    }
    return {
      accepted: true,
      rendered: true,
      pending: false,
      committedSegmentIds: parts.map((part) => part.segmentId),
    };
  }

  setMode(mode: TranslationMode) {
    this.renderer?.applyMode(mode);
  }

  failSegment(segmentId: string): string[] {
    const segment = this.segments.get(segmentId);
    if (segment === undefined) return [];
    this.pendingByNode.delete(segment.nodeId);
    if (!this.failedNodeIds.has(segment.nodeId)) {
      this.failedNodeIds.add(segment.nodeId);
      this.incrementDiagnostic('failed');
    }
    return [...this.segments.values()]
      .filter((candidate) => candidate.nodeId === segment.nodeId)
      .map((candidate) => candidate.segmentId);
  }

  getPageSessionId(): string | undefined {
    return this.result?.pageSessionId;
  }

  getDiagnostics(): ScanDiagnostics | undefined {
    if (this.result === undefined) return undefined;
    return {
      ...this.result.diagnostics,
      queued: this.queuedNodeIds.size,
      completed: this.committedNodeIds.size,
      stale: Math.max(this.result.diagnostics.stale, this.staleSegmentIds.size),
    };
  }

  observeOpenShadowRoot(root: ShadowRoot) {
    this.guard?.observeOpenShadowRoot(root);
  }

  /** Called by the content script after pushState/replaceState/popstate. */
  handleNavigation(): ContentScanResult {
    const previousCallback = this.options.onScanUpdate;
    this.teardown();
    this.identityRegistry = new TextNodeIdentityRegistry();
    this.currentUrl = this.document.location.href;
    const result = scanPage(
      this.document,
      this.options.createSessionId?.() ?? crypto.randomUUID(),
      this.scanOptions,
      { identityRegistry: this.identityRegistry },
    );
    this.install(result);
    const contentResult = this.toContentResult(result);
    previousCallback?.({ ...contentResult, reason: 'navigation' });
    return contentResult;
  }

  restore() {
    this.teardown();
    this.scanOptions = undefined;
    this.currentUrl = '';
  }

  private install(result: SegmentationResult) {
    this.result = result;
    for (const segment of result.segments) {
      this.segments.set(segment.segmentId, segment);
      this.queuedNodeIds.add(segment.nodeId);
    }
    this.guard = new MutationGuard(
      this.document,
      result.segments,
      (nodeId) => this.markStale(nodeId),
      () => this.rescanDynamic(),
      this.options.debounceMs,
    );
    this.renderer = new TranslationRenderer(this.document, (operation) =>
      this.guard?.runOwned(operation),
    );
  }

  private merge(result: SegmentationResult) {
    const completed = this.result?.diagnostics.completed ?? 0;
    const failed = this.result?.diagnostics.failed ?? 0;
    const stale = this.result?.diagnostics.stale ?? 0;
    for (const segment of result.segments) {
      this.segments.set(segment.segmentId, segment);
      this.queuedNodeIds.add(segment.nodeId);
    }
    const active = [...this.segments.values()].filter(
      (segment) =>
        segment.node.isConnected &&
        stableHash(segment.node.data.normalize('NFKC')) === segment.domFingerprint,
    );
    this.guard?.setSegments(active);
    this.result = {
      ...result,
      diagnostics: {
        ...result.diagnostics,
        queued: this.queuedNodeIds.size,
        completed,
        failed,
        stale,
      },
    };
  }

  private rescanDynamic() {
    if (this.result === undefined) return;
    if (this.document.location.href !== this.currentUrl) {
      this.handleNavigation();
      return;
    }
    const result = scanPage(this.document, this.result.pageSessionId, this.scanOptions, {
      identityRegistry: this.identityRegistry,
      excludeSegmentIds: new Set(this.segments.keys()),
    });
    this.merge(result);
    this.options.onScanUpdate?.({ ...this.toContentResult(this.result), reason: 'mutation' });
  }

  private markStale(nodeId: string) {
    const staleSegments = [...this.segments.values()].filter(
      (segment) => segment.nodeId === nodeId,
    );
    if (staleSegments.length === 0) return;
    for (const segment of staleSegments) {
      this.staleSegmentIds.add(segment.segmentId);
      this.segments.delete(segment.segmentId);
    }
    this.pendingByNode.delete(nodeId);
    this.failedNodeIds.delete(nodeId);
    this.queuedNodeIds.delete(nodeId);
    if (this.committedNodeIds.delete(nodeId) && this.result !== undefined) {
      this.result.diagnostics.completed = Math.max(0, this.result.diagnostics.completed - 1);
    }
    this.renderer?.markStale(nodeId);
    this.incrementDiagnostic('stale');
    this.guard?.setSegments([...this.segments.values()]);
  }

  private incrementDiagnostic(key: 'completed' | 'failed' | 'stale', amount = 1) {
    if (this.result === undefined) return;
    this.result.diagnostics[key] += amount;
  }

  private teardown() {
    this.renderer?.restore();
    this.guard?.disconnect();
    this.renderer = undefined;
    this.guard = undefined;
    this.result = undefined;
    this.segments.clear();
    this.staleSegmentIds.clear();
    this.pendingByNode.clear();
    this.queuedNodeIds.clear();
    this.committedNodeIds.clear();
    this.failedNodeIds.clear();
  }

  private toContentResult(result: SegmentationResult): ContentScanResult {
    return {
      pageSessionId: result.pageSessionId,
      segments: result.segments.map(wireSegment),
      capped: result.capped,
      ...(result.continuationCursor === undefined
        ? {}
        : { continuationCursor: result.continuationCursor }),
      diagnostics: { ...result.diagnostics },
      untranslated: [...result.untranslated],
      pageProfile: result.pageProfile,
    };
  }
}
