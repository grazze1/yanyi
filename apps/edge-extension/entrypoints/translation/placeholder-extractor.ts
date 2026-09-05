import { eligibleSelector, isProtectedElement } from './eligibility';

export type PlaceholderKind =
  'CODE' | 'MATH' | 'LINK' | 'TERM' | 'URL' | 'PATH' | 'CITATION' | 'VERSION' | 'IDENTIFIER';

export interface ProtectedPlaceholder {
  token: string;
  kind: PlaceholderKind;
  text: string;
  node?: Node | undefined;
}

export interface PlaceholderExtraction {
  sourceText: string;
  placeholders: ProtectedPlaceholder[];
}

const textProtected = [
  { kind: 'URL' as const, pattern: /https?:\/\/[^\s<>"')\]]+|www\.[^\s<>"')\]]+/gu },
  { kind: 'PATH' as const, pattern: /(?:[A-Za-z]:\\|~\/|\.\.\/|\.\/|\/)[\w./\\-]+/gu },
  { kind: 'CITATION' as const, pattern: /\[[0-9][0-9,\-\s]*\]/gu },
  {
    kind: 'VERSION' as const,
    pattern: /\bv?\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?\b/gu,
  },
  {
    kind: 'IDENTIFIER' as const,
    pattern:
      /(?<![\p{L}\p{N}_])(?:--?[A-Za-z][\w-]*|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+|[A-Za-z]\w*(?:_[A-Za-z0-9]+)+|[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+)(?![\p{L}\p{N}_])/gu,
  },
];

const exactPlaceholderPattern = /^__YANYI_[A-Z]+_[0-9]+__$/u;

function replaceOutsidePlaceholders(
  input: string,
  pattern: RegExp,
  replace: (matched: string) => string,
): string {
  return input
    .split(/(__YANYI_[A-Z]+_[0-9]+__)/gu)
    .map((part) => (exactPlaceholderPattern.test(part) ? part : part.replace(pattern, replace)))
    .join('');
}

function normalize(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** Protects opaque values that occur inside one TextNode without touching its surrounding DOM. */
export function extractTextPlaceholders(text: string): PlaceholderExtraction {
  const placeholders: ProtectedPlaceholder[] = [];
  let sourceText = text;
  for (const matcher of textProtected) {
    sourceText = replaceOutsidePlaceholders(sourceText, matcher.pattern, (matched) => {
      const token = `__YANYI_${matcher.kind}_${placeholders.length}__`;
      placeholders.push({ token, kind: matcher.kind, text: matched });
      return token;
    });
  }
  return { sourceText: normalize(sourceText), placeholders };
}

function protectedKind(element: Element): PlaceholderKind {
  if (element.matches('math,mjx-container,.katex')) return 'MATH';
  if (element.matches('a[href]')) return 'LINK';
  if (element.matches('[translate="no"],[data-yanyi-protected]')) return 'TERM';
  return 'CODE';
}

/** Replaces opaque page fragments with typed tokens before any model request. */
export function extractPlaceholders(root: HTMLElement): PlaceholderExtraction {
  const placeholders: ProtectedPlaceholder[] = [];
  const nextToken = (kind: PlaceholderKind, text: string, node?: Node) => {
    const token = `__YANYI_${kind}_${placeholders.length}__`;
    placeholders.push({ token, kind, text, node });
    return token;
  };
  const protectText = (input: string) => {
    let remaining = input;
    for (const matcher of textProtected) {
      remaining = replaceOutsidePlaceholders(remaining, matcher.pattern, (matched) =>
        nextToken(matcher.kind, matched),
      );
    }
    return remaining;
  };
  const visit = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return protectText(node.textContent ?? '');
    if (!(node instanceof Element)) return '';
    if (node !== root && node.matches(eligibleSelector)) return '';
    if (node !== root && isProtectedElement(node)) {
      return nextToken(protectedKind(node), node.textContent ?? '', node.cloneNode(true));
    }
    return [...node.childNodes].map(visit).join('');
  };
  return { sourceText: normalize(visit(root)), placeholders };
}

export function placeholderTokens(text: string): string[] {
  return text.match(/__YANYI_[A-Z]+_[0-9]+__/gu) ?? [];
}

export function validatePlaceholders(
  translation: string,
  placeholders: readonly ProtectedPlaceholder[],
): boolean {
  const expected = placeholders.map((placeholder) => placeholder.token);
  const actual = placeholderTokens(translation);
  return (
    actual.length === expected.length && actual.every((token, index) => token === expected[index])
  );
}

export function createSafeFragment(
  document: Document,
  translation: string,
  placeholders: readonly ProtectedPlaceholder[],
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const byToken = new Map(placeholders.map((placeholder) => [placeholder.token, placeholder]));
  let cursor = 0;
  const tokenPattern = /__YANYI_[A-Z]+_[0-9]+__/gu;
  for (const match of translation.matchAll(tokenPattern)) {
    const start = match.index ?? cursor;
    if (start > cursor) fragment.append(document.createTextNode(translation.slice(cursor, start)));
    const placeholder = byToken.get(match[0]);
    if (placeholder === undefined) throw new Error('unknown translation placeholder');
    fragment.append(placeholder.node?.cloneNode(true) ?? document.createTextNode(placeholder.text));
    cursor = start + match[0].length;
  }
  if (cursor < translation.length)
    fragment.append(document.createTextNode(translation.slice(cursor)));
  return fragment;
}
