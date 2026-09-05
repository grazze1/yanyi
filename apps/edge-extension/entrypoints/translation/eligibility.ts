const TEXT_CONTAINER_TAGS = new Set([
  'A',
  'BUTTON',
  'CAPTION',
  'DD',
  'DIV',
  'DT',
  'FIGCAPTION',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LABEL',
  'LI',
  'NAV',
  'P',
  'SPAN',
  'TD',
  'TH',
]);

const PROTECTED_SELECTOR =
  'pre,code,kbd,samp,var,math,mjx-container,.katex,.MathJax,[data-yanyi-protected],[translate="no"]';
const IGNORED_SELECTOR =
  'script,style,noscript,template,input,textarea,select,option,[contenteditable="true"],[data-yanyi-owned],[data-yanyi-ignore],[data-yanyi-editor],[role="textbox"],[role="log"],[aria-live]';

/** Kept for the element placeholder helper; page discovery itself uses SHOW_TEXT. */
export const eligibleSelector = [...TEXT_CONTAINER_TAGS].map((tag) => tag.toLowerCase()).join(',');

function composedParentElement(node: Node): Element | null {
  if (node.parentElement !== null) return node.parentElement;
  const root = node.getRootNode();
  if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in root)
    return (root as ShadowRoot).host;
  if (root.nodeType === Node.DOCUMENT_NODE)
    return (root as Document).defaultView?.frameElement ?? null;
  return null;
}

export function closestComposed(node: Node, selector: string): Element | null {
  let current: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (current !== null) {
    if (current.matches(selector)) return current;
    current = composedParentElement(current);
  }
  return null;
}

function isVisibleElement(element: Element, cache: WeakMap<Element, boolean>): boolean {
  const cached = cache.get(element);
  if (cached !== undefined) return cached;
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
    cache.set(element, false);
    return false;
  }
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (
    style?.display === 'none' ||
    style?.visibility === 'hidden' ||
    style?.visibility === 'collapse'
  ) {
    cache.set(element, false);
    return false;
  }
  const parent = composedParentElement(element);
  const visible = parent === null || isVisibleElement(parent, cache);
  cache.set(element, visible);
  return visible;
}

export function isVisibleTextNode(
  node: Text,
  cache: WeakMap<Element, boolean> = new WeakMap<Element, boolean>(),
): boolean {
  return (
    node.data.trim().length > 0 &&
    node.parentElement !== null &&
    isVisibleElement(node.parentElement, cache)
  );
}

export type TextNodeEligibility = 'eligible' | 'protected' | 'ignored';

export function classifyTextNode(node: Text): TextNodeEligibility {
  if (closestComposed(node, IGNORED_SELECTOR) !== null) return 'ignored';
  if (closestComposed(node, PROTECTED_SELECTOR) !== null) return 'protected';
  return 'eligible';
}

export function isEligibleElement(element: Element): element is HTMLElement {
  if (!TEXT_CONTAINER_TAGS.has(element.tagName)) return false;
  if (element.matches(`${IGNORED_SELECTOR},${PROTECTED_SELECTOR}`)) return false;
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  return (
    !element.hasAttribute('hidden') &&
    element.getAttribute('aria-hidden') !== 'true' &&
    style?.display !== 'none' &&
    style?.visibility !== 'hidden'
  );
}

export function isProtectedElement(element: Element): boolean {
  return element.matches(`${PROTECTED_SELECTOR},a[data-yanyi-protected-link],cite,.citation`);
}

export function isUsefulSourceText(value: string): boolean {
  const text = value
    .replace(/__YANYI_[A-Z]+_[0-9]+__/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (text.length === 0) return false;
  if (/^[\d\s.,:%+\-–—/()[\]{}]+$/u.test(text)) return false;
  if (/^(?:https?:\/\/|www\.|[A-Za-z]:\\|\/|\.\/|\.\.\/)/u.test(text)) return false;
  return /[\p{L}\p{Script=Han}]/u.test(text);
}
