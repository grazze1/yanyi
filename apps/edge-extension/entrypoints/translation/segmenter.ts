import type {
  PageTranslationProfile,
  ScanDiagnostics,
  TranslationDomRole,
  TranslationSegmentInput,
  UntranslatedReason,
} from '@yanyi/protocol';
import {
  classifyTextNode,
  closestComposed,
  isUsefulSourceText,
  isVisibleTextNode,
} from './eligibility';
import {
  extractTextPlaceholders,
  placeholderTokens,
  type ProtectedPlaceholder,
} from './placeholder-extractor';

export const TARGET_SEGMENT_CHARS = 800;
export const MAX_SEGMENT_CHARS = 1200;
/** Native Messaging batch limit; discovery continues after this boundary. */
export const MAX_PAGE_SEGMENTS = 160;
export const MAX_PAGE_CHARS = 96_000;

export interface PageSegment extends TranslationSegmentInput {
  nodeId: string;
  partIndex: number;
  partCount: number;
  domRole: TranslationDomRole;
  componentId: string;
  node: Text;
  /** Nearest owning element, retained for compatibility with existing callers/tests. */
  element: HTMLElement;
  sourceSnapshot: string;
  placeholdersDetailed: ProtectedPlaceholder[];
  domFingerprint: string;
}

export interface UntranslatedNode {
  nodeId: string;
  reason: UntranslatedReason;
  domRole: TranslationDomRole;
}

export interface SegmentationResult {
  pageSessionId: string;
  segments: PageSegment[];
  skipped: number;
  capped: boolean;
  continuationCursor?: number;
  diagnostics: ScanDiagnostics;
  untranslated: UntranslatedNode[];
  pageProfile: PageTranslationProfile;
}

export interface SegmentationOptions {
  ignoredSelectors?: string[];
  forceContentSelector?: string;
  translateTables?: boolean;
  continuationCursor?: number;
}

interface ScanRuntimeOptions {
  identityRegistry?: TextNodeIdentityRegistry;
  excludeSegmentIds?: ReadonlySet<string>;
}

interface TextRoot {
  root: Node;
  ownerDocument: Document;
}

interface NodeGroup {
  nodeId: string;
  segments: PageSegment[];
  priority: number;
  order: number;
  domRole: TranslationDomRole;
}

function emptyDiagnostics(): ScanDiagnostics {
  return {
    discoveredVisible: 0,
    eligible: 0,
    protected: 0,
    ignored: 0,
    queued: 0,
    completed: 0,
    failed: 0,
    stale: 0,
    overBudget: 0,
    unsupported: 0,
    cancelled: 0,
    notScanned: 0,
  };
}

const FNV_1A_128_OFFSET_BASIS = 0x6c62272e07bb014262b821756295c58dn;
const FNV_1A_128_PRIME = 0x0000000001000000000000000000013bn;
const UINT_128_MASK = (1n << 128n) - 1n;
const STABLE_HASH_VERSION = 'fnv1a128-v1';
const UTF8_ENCODER = new TextEncoder();

/**
 * Produces a synchronous, browser-native 128-bit fingerprint for cache and DOM identities.
 *
 * The version prefix deliberately keeps these values in a separate key space from the former
 * eight-hex-character FNV-1a/32 values, so persisted cache entries cannot be mistaken for a new
 * fingerprint after an extension upgrade.
 */
export function stableHash(value: string): string {
  let hash = FNV_1A_128_OFFSET_BASIS;
  for (const byte of UTF8_ENCODER.encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_1A_128_PRIME) & UINT_128_MASK;
  }
  return `${STABLE_HASH_VERSION}-${hash.toString(16).padStart(32, '0')}`;
}

function nodeIndex(node: Node): number {
  const siblings = node.parentNode?.childNodes;
  if (siblings === undefined) return 0;
  return [...siblings].indexOf(node as ChildNode);
}

function nodeLocator(node: Node): string {
  const parts: string[] = [];
  let current: Node | null = node;
  while (current !== null) {
    if (current.nodeType === Node.TEXT_NODE) {
      parts.push(`#text:${nodeIndex(current)}`);
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as Element;
      const parent = element.parentElement;
      const ordinal =
        parent === null
          ? 0
          : [...parent.children]
              .filter((sibling) => sibling.tagName === element.tagName)
              .indexOf(element);
      parts.push(`${element.tagName.toLowerCase()}:${ordinal}`);
    } else if (current.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in current) {
      parts.push('#shadow');
      current = (current as ShadowRoot).host;
      continue;
    } else if (current.nodeType === Node.DOCUMENT_NODE) {
      const frame: Element | null | undefined = (current as Document).defaultView?.frameElement;
      if (frame !== null && frame !== undefined) {
        parts.push('#frame');
        current = frame;
        continue;
      }
      parts.push('#document');
    }
    current = current.parentNode;
  }
  return parts.reverse().join('/');
}

export class TextNodeIdentityRegistry {
  private readonly ids = new WeakMap<Text, string>();
  private readonly collisions = new Map<string, number>();

  idFor(node: Text): string {
    const existing = this.ids.get(node);
    if (existing !== undefined) return existing;
    const base = `node-${stableHash(nodeLocator(node))}`;
    const collision = this.collisions.get(base) ?? 0;
    this.collisions.set(base, collision + 1);
    const id = collision === 0 ? base : `${base}-${collision}`;
    this.ids.set(node, id);
    return id;
  }
}

function splitSource(text: string): string[] {
  if (text.length <= MAX_SEGMENT_CHARS) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_SEGMENT_CHARS) {
    const searchEnd = Math.min(MAX_SEGMENT_CHARS, remaining.length);
    const candidate = remaining.slice(0, searchEnd);
    const boundaries = [
      candidate.lastIndexOf('. ', TARGET_SEGMENT_CHARS),
      candidate.lastIndexOf('。', TARGET_SEGMENT_CHARS),
      candidate.lastIndexOf('; ', TARGET_SEGMENT_CHARS),
      candidate.lastIndexOf('；', TARGET_SEGMENT_CHARS),
      candidate.lastIndexOf('! ', TARGET_SEGMENT_CHARS),
      candidate.lastIndexOf('? ', TARGET_SEGMENT_CHARS),
    ];
    const boundary = Math.max(...boundaries);
    let cut = boundary > 120 ? boundary + 1 : searchEnd;
    for (const match of remaining.matchAll(/__YANYI_[A-Z]+_[0-9]+__/gu)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (start < cut && end > cut) {
        cut = start > 120 ? start : end;
        break;
      }
    }
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) parts.push(remaining);
  return parts;
}

function placeholdersInSource(
  sourceText: string,
  placeholdersByToken: ReadonlyMap<string, ProtectedPlaceholder>,
): ProtectedPlaceholder[] {
  const placeholders: ProtectedPlaceholder[] = [];
  for (const token of placeholderTokens(sourceText)) {
    const placeholder = placeholdersByToken.get(token);
    if (placeholder !== undefined) placeholders.push(placeholder);
  }
  return placeholders;
}

function viewportPriority(node: Text): number {
  const element = node.parentElement;
  const view = node.ownerDocument.defaultView;
  if (element === null || view === null) return 1;
  const rect = element.getBoundingClientRect();
  return rect.bottom >= 0 && rect.top <= view.innerHeight ? 0 : 1;
}

function roleFor(node: Text): TranslationDomRole {
  if (closestComposed(node, 'button,[role="button"]') !== null) return 'button';
  if (closestComposed(node, 'a[href],[role="link"]') !== null) return 'link';
  if (closestComposed(node, 'h1,h2,h3,h4,h5,h6,[role="heading"]') !== null) return 'heading';
  if (
    closestComposed(
      node,
      'th,td,caption,[role="cell"],[role="columnheader"],[role="rowheader"]',
    ) !== null
  )
    return 'table_cell';
  if (closestComposed(node, 'li,[role="listitem"]') !== null) return 'list_item';
  if (closestComposed(node, 'label,[aria-label]') !== null) return 'label';
  if (closestComposed(node, '[role="tab"],[role="option"],[data-tag],[data-chip]') !== null)
    return 'tag';
  if (closestComposed(node, 'nav,[role="navigation"]') !== null) return 'navigation';
  if (closestComposed(node, 'p,blockquote,figcaption,dd,dt') !== null) return 'paragraph';
  return 'text';
}

function componentFor(node: Text): string {
  const component = closestComposed(
    node,
    '[data-yanyi-component],article,section,nav,main,aside,form,table,tr,li,figure,details,dialog,[role="dialog"],[role="region"]',
  );
  return `component-${stableHash(component === null ? nodeLocator(node.parentNode ?? node) : nodeLocator(component))}`;
}

function ignoredByPolicy(node: Text, options?: SegmentationOptions): boolean {
  if (
    options?.translateTables === false &&
    closestComposed(node, 'table,thead,tbody,tfoot,tr,th,td,caption') !== null
  )
    return true;
  return (options?.ignoredSelectors ?? []).some((selector) => {
    try {
      return closestComposed(node, selector) !== null;
    } catch {
      return true;
    }
  });
}

function asTextRoot(node: Node): TextRoot {
  const ownerDocument =
    node.nodeType === Node.DOCUMENT_NODE ? (node as Document) : node.ownerDocument;
  if (ownerDocument === null) throw new Error('A scan root must belong to a document.');
  return {
    root: node,
    ownerDocument,
  };
}

function* rootElements(root: Node): Iterable<Element> {
  const ownerDocument =
    root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : root.ownerDocument;
  if (ownerDocument === null) return;
  if (root.nodeType === Node.ELEMENT_NODE) yield root as Element;
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode();
  while (current !== null) {
    yield current as Element;
    current = walker.nextNode();
  }
}

function collectTextRoots(
  document: Document,
  options: SegmentationOptions | undefined,
  diagnostics: ScanDiagnostics,
  untranslated: UntranslatedNode[],
): TextRoot[] {
  let initial: Node | null = document.body ?? document.documentElement;
  if (options?.forceContentSelector !== undefined) {
    try {
      initial = document.querySelector(options.forceContentSelector);
    } catch {
      initial = null;
    }
  }
  if (initial === null) return [];

  const roots: TextRoot[] = [];
  const pending: TextRoot[] = [asTextRoot(initial)];
  const seen = new Set<Node>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) break;
    if (seen.has(current.root)) continue;
    seen.add(current.root);
    roots.push(current);
    for (const element of rootElements(current.root)) {
      if (element.shadowRoot !== null) pending.push(asTextRoot(element.shadowRoot));
      if (element.tagName !== 'IFRAME') continue;
      let frameDocument: Document | null;
      try {
        frameDocument = (element as HTMLIFrameElement).contentDocument;
      } catch {
        frameDocument = null;
      }
      if (frameDocument?.body !== null && frameDocument?.body !== undefined) {
        pending.push(asTextRoot(frameDocument.body));
      } else {
        diagnostics.unsupported += 1;
        untranslated.push({
          nodeId: `frame-${stableHash((element as HTMLIFrameElement).src || nodeLocator(element))}`,
          reason: 'unsupported',
          domRole: 'text',
        });
      }
    }
  }
  return roots;
}

function uniqueText(values: Iterable<string>, limit: number, maxChars = 120): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.replace(/\s+/gu, ' ').trim().slice(0, maxChars);
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function productNameTokens(value: string): string[] {
  return (value.match(/\b[A-Za-z][A-Za-z0-9.+-]*\b/gu) ?? []).filter((token) => {
    // Candidates are deliberately ASCII-only, so direct character-class counts are exact and do
    // not risk decomposing user-facing Unicode grapheme clusters.
    const uppercase = token.match(/[A-Z]/gu)?.length ?? 0;
    const lowercase = token.match(/[a-z]/gu)?.length ?? 0;
    return /[0-9.+-]/u.test(token) || (uppercase >= 2 && lowercase >= 1);
  });
}

export function buildPageTranslationProfile(document: Document): PageTranslationProfile {
  const headings = uniqueText(
    [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((element) => element.textContent ?? ''),
    48,
    240,
  );
  const protectedTerms = uniqueText(
    [...document.querySelectorAll('[translate="no"],[data-yanyi-protected]')].map(
      (element) => element.textContent ?? '',
    ),
    64,
  );
  const uiVocabulary = uniqueText(
    [
      ...document.querySelectorAll(
        'button,a[href],nav [aria-label],[role="button"],[role="tab"],[role="menuitem"]',
      ),
    ]
      .map((element) => element.textContent ?? element.getAttribute('aria-label') ?? '')
      .filter((value) => value.trim().length <= 80),
    64,
    80,
  );
  const sampledBodyText = uniqueText(
    [...document.querySelectorAll('p,li,td,th,figcaption')]
      .slice(0, 128)
      .map((element) => element.textContent ?? ''),
    128,
    240,
  );
  const profileCorpus = [
    document.title,
    ...headings,
    ...protectedTerms,
    ...uiVocabulary,
    ...sampledBodyText,
  ].join(' ');
  const acronyms = uniqueText(profileCorpus.match(/\b[A-Z][A-Z0-9]{1,9}\b/gu) ?? [], 48, 20);
  // Do not treat ordinary Title Case headings (for example "Getting Started") as product names.
  // Such a false positive makes the native validator require the whole English heading verbatim
  // and rejects an otherwise correct translation. Product candidates therefore stay token-sized
  // and need a distinctive brand shape such as PyTorch/GitHub/TensorRT or a digit/punctuation mark.
  const productNames = uniqueText(productNameTokens(profileCorpus), 48, 80);
  const site = document.location.hostname || 'local-page';
  const documentType =
    site === 'github.com'
      ? 'repository'
      : document.querySelector('article,[itemtype*="Article"]') !== null
        ? 'article'
        : headings.length >= 3 && document.querySelector('nav') !== null
          ? 'documentation'
          : 'webpage';
  return {
    pageTitle: document.title.slice(0, 500),
    site,
    documentType,
    sectionHeadings: headings,
    namedEntities: productNames,
    productNames,
    acronyms,
    protectedTerms,
    uiVocabulary,
  };
}

function createSegmentsForNode(
  node: Text,
  pageSessionId: string,
  registry: TextNodeIdentityRegistry,
): PageSegment[] {
  const extracted = extractTextPlaceholders(node.data);
  const sourceParts = splitSource(extracted.sourceText);
  const placeholdersByToken = new Map(
    extracted.placeholders.map((placeholder) => [placeholder.token, placeholder]),
  );
  const nodeId = registry.idFor(node);
  const element = node.parentElement;
  if (element === null) return [];
  const domRole = roleFor(node);
  const componentId = componentFor(node);
  const domFingerprint = stableHash(node.data.normalize('NFKC'));
  return sourceParts.map((sourceText, partIndex) => {
    const sourceHash = stableHash(sourceText.normalize('NFKC'));
    const placeholdersDetailed = placeholdersInSource(sourceText, placeholdersByToken);
    return {
      segmentId: `${pageSessionId}:${nodeId}:${partIndex}:${sourceHash}`,
      nodeId,
      partIndex,
      partCount: sourceParts.length,
      domRole,
      componentId,
      sourceText,
      sourceHash,
      placeholders: placeholdersDetailed.map((placeholder) => placeholder.token),
      placeholdersDetailed,
      sourceSnapshot: node.data,
      domFingerprint,
      priority: viewportPriority(node),
      node,
      element,
    } satisfies PageSegment;
  });
}

export function scanPage(
  document: Document,
  pageSessionId: string = crypto.randomUUID(),
  options?: SegmentationOptions,
  runtime: ScanRuntimeOptions = {},
): SegmentationResult {
  const diagnostics = emptyDiagnostics();
  const untranslated: UntranslatedNode[] = [];
  const registry = runtime.identityRegistry ?? new TextNodeIdentityRegistry();
  const visibilityCache = new WeakMap<Element, boolean>();
  const groups: NodeGroup[] = [];
  let order = 0;

  for (const { root, ownerDocument } of collectTextRoots(
    document,
    options,
    diagnostics,
    untranslated,
  )) {
    const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current !== null) {
      const node = current as Text;
      if (!isVisibleTextNode(node, visibilityCache)) {
        if (node.data.trim().length > 0) diagnostics.ignored += 1;
        current = walker.nextNode();
        continue;
      }
      diagnostics.discoveredVisible += 1;
      const nodeId = registry.idFor(node);
      const domRole = roleFor(node);
      const eligibility = classifyTextNode(node);
      if (eligibility === 'protected') {
        diagnostics.protected += 1;
        untranslated.push({ nodeId, reason: 'protected', domRole });
        current = walker.nextNode();
        continue;
      }
      if (eligibility === 'ignored' || ignoredByPolicy(node, options)) {
        diagnostics.ignored += 1;
        untranslated.push({ nodeId, reason: 'ignored', domRole });
        current = walker.nextNode();
        continue;
      }
      const segments = createSegmentsForNode(node, pageSessionId, registry);
      if (
        segments.length === 0 ||
        !isUsefulSourceText(segments.map(({ sourceText }) => sourceText).join(' '))
      ) {
        diagnostics.protected += 1;
        untranslated.push({ nodeId, reason: 'protected', domRole });
        current = walker.nextNode();
        continue;
      }
      diagnostics.eligible += 1;
      const firstSegment = segments[0];
      if (firstSegment === undefined) {
        current = walker.nextNode();
        continue;
      }
      groups.push({ nodeId, segments, priority: firstSegment.priority, order, domRole });
      order += 1;
      current = walker.nextNode();
    }
  }

  groups.sort((left, right) => left.priority - right.priority || left.order - right.order);
  const segments: PageSegment[] = [];
  let queuedGroups = 0;
  let pageChars = 0;
  // Continuation calls carry stable segment IDs for every previously queued node. Re-scan from
  // the start after filtering those IDs: viewport priority may legitimately change between
  // batches, so an array index into the old priority ordering is not a stable cursor.
  const cursor =
    runtime.excludeSegmentIds === undefined ? Math.max(0, options?.continuationCursor ?? 0) : 0;
  let continuationCursor: number | undefined;
  for (let index = cursor; index < groups.length; index += 1) {
    const group = groups[index];
    if (group === undefined) break;
    const excluded = group.segments.every((segment) =>
      runtime.excludeSegmentIds?.has(segment.segmentId),
    );
    if (excluded) continue;
    const groupChars = group.segments.reduce(
      (total, segment) => total + segment.sourceText.length,
      0,
    );
    if (group.segments.length > MAX_PAGE_SEGMENTS || groupChars > MAX_PAGE_CHARS) {
      diagnostics.overBudget += 1;
      untranslated.push({ nodeId: group.nodeId, reason: 'over_budget', domRole: group.domRole });
      continue;
    }
    if (
      continuationCursor !== undefined ||
      segments.length + group.segments.length > MAX_PAGE_SEGMENTS ||
      pageChars + groupChars > MAX_PAGE_CHARS
    ) {
      continuationCursor ??= index;
      diagnostics.overBudget += 1;
      untranslated.push({ nodeId: group.nodeId, reason: 'over_budget', domRole: group.domRole });
      continue;
    }
    segments.push(...group.segments);
    queuedGroups += 1;
    pageChars += groupChars;
  }
  diagnostics.queued = queuedGroups;

  return {
    pageSessionId,
    segments,
    skipped: diagnostics.protected + diagnostics.ignored,
    capped: continuationCursor !== undefined || diagnostics.overBudget > 0,
    ...(continuationCursor === undefined ? {} : { continuationCursor }),
    diagnostics,
    untranslated,
    pageProfile: buildPageTranslationProfile(document),
  };
}
