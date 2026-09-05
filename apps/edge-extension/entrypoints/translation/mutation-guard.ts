import type { PageSegment } from './segmenter';

type AttachShadow = (this: Element, init: ShadowRootInit) => ShadowRoot;

function isAttachShadow(value: unknown): value is AttachShadow {
  return typeof value === 'function';
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isOwned(node: Node): boolean {
  const element = isElement(node) ? node : node.parentElement;
  return element?.closest('[data-yanyi-owned]') !== null && element !== null;
}

function nodeContains(container: Node, candidate: Node): boolean {
  return container === candidate || container.contains(candidate);
}

export class MutationGuard {
  private readonly observer: MutationObserver;
  private readonly byNode = new Map<Text, string>();
  private readonly observedRoots = new WeakSet<Node>();
  private readonly ownedTextMutationCounts = new WeakMap<Text, number>();
  private readonly frameLoadListeners = new Map<Element, EventListener>();
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private restoreAttachShadow: (() => void) | undefined;

  constructor(
    document: Document,
    segments: readonly PageSegment[],
    private readonly onStale: (nodeId: string) => void,
    private readonly onRescan: () => void = () => undefined,
    private readonly debounceMs = 500,
  ) {
    this.observer = new MutationObserver((records) => {
      const relevant = records.filter((record) => {
        if (record.type === 'characterData') {
          if (record.target.nodeType === Node.TEXT_NODE) {
            const node = record.target as Text;
            const ownedCount = this.ownedTextMutationCounts.get(node) ?? 0;
            if (ownedCount > 0) {
              if (ownedCount === 1) this.ownedTextMutationCounts.delete(node);
              else this.ownedTextMutationCounts.set(node, ownedCount - 1);
              return false;
            }
          }
          return !isOwned(record.target);
        }
        const changed = [...record.addedNodes, ...record.removedNodes];
        return changed.length === 0 || changed.some((node) => !isOwned(node));
      });
      if (relevant.length === 0) return;

      const staleNodeIds = new Set<string>();
      for (const record of relevant) {
        for (const added of record.addedNodes) this.watchFrames(added);
        for (const [node, nodeId] of this.byNode) {
          const changedNodes = [...record.addedNodes, ...record.removedNodes];
          if (
            (record.type === 'characterData' && nodeContains(record.target, node)) ||
            changedNodes.some(
              (changed) => nodeContains(changed, node) || nodeContains(node, changed),
            )
          )
            staleNodeIds.add(nodeId);
        }
      }
      for (const nodeId of staleNodeIds) this.onStale(nodeId);
      this.scheduleRescan();
    });
    const root = document.body ?? document.documentElement;
    this.observeRoot(root);
    this.watchFrames(root);
    this.installAttachShadowHook(document);
    this.setSegments(segments);
  }

  setSegments(segments: readonly PageSegment[]) {
    this.byNode.clear();
    for (const segment of segments) {
      this.byNode.set(segment.node, segment.nodeId);
      const root = segment.node.getRootNode();
      const observed =
        root.nodeType === Node.DOCUMENT_NODE
          ? ((root as Document).body ?? (root as Document).documentElement)
          : root;
      this.observeRoot(observed);
    }
  }

  runOwned(operation: () => void) {
    const before = new Map<Text, string>();
    for (const node of this.byNode.keys()) before.set(node, node.data);
    operation();
    for (const [node, value] of before) {
      if (node.data === value) continue;
      this.ownedTextMutationCounts.set(node, (this.ownedTextMutationCounts.get(node) ?? 0) + 1);
    }
  }

  observeOpenShadowRoot(root: ShadowRoot) {
    this.observeRoot(root);
    this.scheduleRescan();
  }

  disconnect() {
    this.observer.disconnect();
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    this.restoreAttachShadow?.();
    for (const [frame, listener] of this.frameLoadListeners) {
      frame.removeEventListener('load', listener);
    }
    this.frameLoadListeners.clear();
    this.debounceTimer = undefined;
    this.restoreAttachShadow = undefined;
    this.byNode.clear();
  }

  private observeRoot(root: Node) {
    if (this.observedRoots.has(root)) return;
    try {
      this.observer.observe(root, { childList: true, characterData: true, subtree: true });
      this.observedRoots.add(root);
    } catch {
      // A frame may become cross-origin between scan and observation; the next scan reports it.
    }
  }

  /**
   * An iframe can be inserted before its document has any text. Parent-document mutations do not
   * fire when that frame later finishes loading, so explicitly rescan after every frame load.
   * Cross-origin frames remain classified as unsupported by the scanner.
   */
  private watchFrames(root: Node) {
    const frames: Element[] = [];
    const pending: Node[] = [root];
    while (pending.length > 0) {
      const current = pending.shift();
      if (current === undefined) break;
      if (isElement(current) && current.tagName.toLowerCase() === 'iframe') frames.push(current);
      pending.push(...current.childNodes);
    }
    for (const frame of frames) {
      if (this.frameLoadListeners.has(frame)) continue;
      const listener: EventListener = () => this.scheduleRescan();
      frame.addEventListener('load', listener);
      this.frameLoadListeners.set(frame, listener);
    }
  }

  private scheduleRescan() {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(
      () => {
        this.debounceTimer = undefined;
        this.onRescan();
      },
      Math.max(500, this.debounceMs),
    );
  }

  private installAttachShadowHook(document: Document) {
    const prototype = document.defaultView?.Element.prototype;
    if (prototype === undefined) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'attachShadow');
    const original: unknown = descriptor?.value;
    if (!isAttachShadow(original)) return;
    const originalAttachShadow: AttachShadow = original;
    const observeOpenShadowRoot = (root: ShadowRoot) => {
      this.observeOpenShadowRoot(root);
    };
    function attachShadow(this: Element, init: ShadowRootInit): ShadowRoot {
      const root = originalAttachShadow.call(this, init);
      if (init.mode === 'open') {
        observeOpenShadowRoot(root);
      }
      return root;
    }
    try {
      Object.defineProperty(prototype, 'attachShadow', {
        ...descriptor,
        configurable: true,
        value: attachShadow,
      });
      this.restoreAttachShadow = () => {
        if (prototype.attachShadow !== attachShadow) return;
        if (descriptor === undefined) delete (prototype as Partial<Element>).attachShadow;
        else Object.defineProperty(prototype, 'attachShadow', descriptor);
      };
    } catch {
      // Frozen prototypes are handled by the bounded open-root poll below.
    }
  }
}
