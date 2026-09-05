import type { TranslationMode } from '@yanyi/shared-types';
import { createSafeFragment, validatePlaceholders } from './placeholder-extractor';
import type { PageSegment } from './segmenter';
import { stableHash } from './segmenter';

interface RenderedNode {
  nodeId: string;
  node: Text;
  sourceSnapshot: string;
  translatedText: string;
  translatedFragment: DocumentFragment;
  container?: HTMLElement;
  blockLayout: boolean;
  mode: TranslationMode;
  stale: boolean;
}

const styleId = 'yanyi-page-translation-styles';
const styleText = `
  [data-yanyi-owned="translation"] {
    box-sizing: border-box; max-width: 100%; color: inherit; background: transparent;
    font: inherit; line-height: inherit; overflow-wrap: anywhere;
  }
  [data-yanyi-owned="translation"][data-yanyi-layout="block"] {
    display: block; margin-block: .35em; padding-inline-start: .65em;
    border-inline-start: 2px solid currentColor;
  }
  [data-yanyi-owned="translation"][data-yanyi-layout="inline"] {
    display: inline; margin-inline-start: .35em;
  }
  [data-yanyi-owned="translation"][data-yanyi-mode="bilingual"] {
    border-inline-start-style: dashed;
  }
`;

function ensureStyles(node: Node) {
  const root = node.getRootNode();
  if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in root) {
    const shadow = root as ShadowRoot;
    if (shadow.querySelector(`#${styleId}`) !== null) return;
    const ownerDocument = node.ownerDocument;
    if (ownerDocument === null) return;
    const style = ownerDocument.createElement('style');
    style.id = styleId;
    style.dataset.yanyiOwned = 'true';
    style.textContent = styleText;
    shadow.prepend(style);
    return;
  }
  const document = node.ownerDocument ?? (root as Document);
  if (document.getElementById(styleId) !== null) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.dataset.yanyiOwned = 'true';
  style.textContent = styleText;
  (document.head ?? document.documentElement).append(style);
}

function whitespaceAffixes(source: string): { leading: string; trailing: string } {
  return {
    leading: /^\s*/u.exec(source)?.[0] ?? '',
    trailing: /\s*$/u.exec(source)?.[0] ?? '',
  };
}

function withSourceWhitespace(source: string, translation: string): string {
  const { leading, trailing } = whitespaceAffixes(source);
  return `${leading}${translation.trim()}${trailing}`;
}

function blockLayout(segment: PageSegment): boolean {
  return (
    segment.domRole === 'heading' ||
    segment.domRole === 'paragraph' ||
    segment.domRole === 'list_item' ||
    segment.domRole === 'table_cell' ||
    segment.domRole === 'navigation'
  );
}

export class TranslationRenderer {
  private readonly rendered = new Map<string, RenderedNode>();

  constructor(
    private readonly document: Document,
    private readonly runOwned: (operation: () => void) => void,
  ) {}

  /** Compatibility wrapper for an unsplit TextNode. */
  renderCompleted(segment: PageSegment, translation: string, mode: TranslationMode): boolean {
    return this.renderNode([segment], [translation], mode);
  }

  /** Atomically commits every validated part belonging to one source TextNode. */
  renderNode(
    segments: readonly PageSegment[],
    translations: readonly string[],
    mode: TranslationMode,
  ): boolean {
    const first = segments[0];
    if (first === undefined) return false;
    if (
      segments.length !== first.partCount ||
      translations.length !== segments.length ||
      segments.some(
        (segment, index) =>
          segment.node !== first.node ||
          segment.nodeId !== first.nodeId ||
          segment.partIndex !== index ||
          !validatePlaceholders(translations[index] ?? '', segment.placeholdersDetailed),
      )
    )
      return false;

    const existing = this.rendered.get(first.nodeId);
    if (existing?.stale === true) return false;
    const currentFingerprint = stableHash(first.node.data.normalize('NFKC'));
    const currentIsManagedTranslation = first.node.data === existing?.translatedText;
    if (currentFingerprint !== first.domFingerprint && !currentIsManagedTranslation) return false;

    const ownerDocument = first.node.ownerDocument ?? this.document;
    const fragments = segments.map((segment, index) =>
      createSafeFragment(ownerDocument, translations[index] ?? '', segment.placeholdersDetailed),
    );
    const translatedCore = fragments.map((fragment) => fragment.textContent ?? '').join(' ');
    const translatedText = withSourceWhitespace(first.sourceSnapshot, translatedCore);
    const translatedFragment = ownerDocument.createDocumentFragment();
    for (const [index, fragment] of fragments.entries()) {
      if (index > 0) translatedFragment.append(ownerDocument.createTextNode(' '));
      translatedFragment.append(fragment);
    }

    this.runOwned(() => {
      existing?.container?.remove();
      this.rendered.set(first.nodeId, {
        nodeId: first.nodeId,
        node: first.node,
        sourceSnapshot: first.sourceSnapshot,
        translatedText,
        translatedFragment,
        blockLayout: blockLayout(first),
        mode,
        stale: false,
      });
      this.applyModeTo(first.nodeId, mode);
    });
    return true;
  }

  markStale(nodeId: string) {
    const rendered = this.rendered.get(nodeId);
    if (rendered === undefined) return;
    rendered.stale = true;
    this.runOwned(() => {
      rendered.container?.remove();
      // A framework may move the same translated TextNode. Restore its snapshot before rescanning;
      // if the framework changed the value, leave that new page-owned value untouched.
      if (rendered.node.data === rendered.translatedText)
        rendered.node.data = rendered.sourceSnapshot;
    });
    this.rendered.delete(nodeId);
  }

  applyMode(mode: TranslationMode) {
    this.runOwned(() => {
      for (const nodeId of this.rendered.keys()) this.applyModeTo(nodeId, mode);
    });
  }

  restore() {
    this.runOwned(() => {
      for (const rendered of this.rendered.values()) {
        rendered.container?.remove();
        if (rendered.node.data === rendered.translatedText) {
          rendered.node.data = rendered.sourceSnapshot;
        }
      }
      this.rendered.clear();
    });
  }

  private createContainer(rendered: RenderedNode): HTMLElement | undefined {
    const parent = rendered.node.parentNode;
    if (parent === null) return undefined;
    ensureStyles(rendered.node);
    const ownerDocument = rendered.node.ownerDocument ?? this.document;
    const container = ownerDocument.createElement('span');
    container.dataset.yanyiOwned = 'translation';
    container.dataset.yanyiTranslationFor = rendered.nodeId;
    container.dataset.yanyiLayout = rendered.blockLayout ? 'block' : 'inline';
    container.setAttribute('role', 'note');
    container.setAttribute('aria-label', '研译翻译结果');
    parent.insertBefore(container, rendered.node.nextSibling);
    rendered.container = container;
    return container;
  }

  private applyModeTo(nodeId: string, mode: TranslationMode) {
    const rendered = this.rendered.get(nodeId);
    if (rendered === undefined || rendered.stale || !rendered.node.isConnected) return;
    rendered.mode = mode;
    if (mode === 'replace') {
      rendered.container?.remove();
      delete rendered.container;
      if (
        rendered.node.data === rendered.sourceSnapshot ||
        rendered.node.data === rendered.translatedText
      )
        rendered.node.data = rendered.translatedText;
      return;
    }

    if (rendered.node.data === rendered.translatedText)
      rendered.node.data = rendered.sourceSnapshot;
    if (rendered.node.data !== rendered.sourceSnapshot) {
      rendered.stale = true;
      rendered.container?.remove();
      return;
    }
    const container =
      rendered.container?.isConnected === true
        ? rendered.container
        : this.createContainer(rendered);
    if (container === undefined) return;
    container.dataset.yanyiMode = mode;
    container.replaceChildren(rendered.translatedFragment.cloneNode(true));
  }
}
