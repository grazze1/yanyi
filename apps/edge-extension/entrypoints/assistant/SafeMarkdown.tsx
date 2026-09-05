import { Fragment, type ReactNode } from 'react';

type MarkdownBlock =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'heading'; level: 2 | 3 | 4; text: string }
  | { type: 'quote'; lines: string[] }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'code'; language: string; text: string };

function safeExternalHref(rawHref: string): string | undefined {
  try {
    const href = new URL(rawHref.trim());
    return href.protocol === 'https:' || href.protocol === 'http:' ? href.href : undefined;
  } catch {
    return undefined;
  }
}

const inlinePattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g;

function inlineNodes(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const [index, match] of [...text.matchAll(inlinePattern)].entries()) {
    const matched = match[0];
    const start = match.index;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const key = `${keyPrefix}-${String(index)}`;
    if (matched.startsWith('`')) {
      nodes.push(<code key={key}>{matched.slice(1, -1)}</code>);
    } else if (matched.startsWith('**')) {
      nodes.push(<strong key={key}>{matched.slice(2, -2)}</strong>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(matched);
      const href = link?.[2] === undefined ? undefined : safeExternalHref(link[2]);
      const label = link?.[1] ?? matched;
      nodes.push(
        href === undefined ? (
          <span key={key}>{label}</span>
        ) : (
          <a href={href} key={key} rel="noreferrer noopener" target="_blank">
            {label}
          </a>
        ),
      );
    }
    cursor = start + matched.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  let paragraph: string[] = [];
  let quote: string[] = [];
  let unordered: string[] = [];
  let ordered: string[] = [];
  let code: string[] | undefined;
  let language = '';

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', lines: paragraph });
    if (quote.length > 0) blocks.push({ type: 'quote', lines: quote });
    if (unordered.length > 0) blocks.push({ type: 'unordered-list', items: unordered });
    if (ordered.length > 0) blocks.push({ type: 'ordered-list', items: ordered });
    paragraph = [];
    quote = [];
    unordered = [];
    ordered = [];
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (code === undefined) {
        flush();
        code = [];
        language = line
          .slice(3)
          .trim()
          .replaceAll(/[^a-zA-Z0-9_+-]/g, '')
          .slice(0, 24);
      } else {
        blocks.push({ type: 'code', language, text: code.join('\n') });
        code = undefined;
        language = '';
      }
      continue;
    }
    if (code !== undefined) {
      code.push(line);
      continue;
    }
    const heading = /^(#{2,4})\s+(.+)$/.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({
        type: 'heading',
        level: heading[1]?.length as 2 | 3 | 4,
        text: heading[2] ?? '',
      });
      continue;
    }
    const unorderedItem = /^\s*[-*]\s+(.+)$/.exec(line);
    if (unorderedItem !== null) {
      if (paragraph.length > 0 || quote.length > 0 || ordered.length > 0) flush();
      unordered.push(unorderedItem[1] ?? '');
      continue;
    }
    const orderedItem = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (orderedItem !== null) {
      if (paragraph.length > 0 || quote.length > 0 || unordered.length > 0) flush();
      ordered.push(orderedItem[1] ?? '');
      continue;
    }
    const quoteLine = /^>\s?(.*)$/.exec(line);
    if (quoteLine !== null) {
      if (paragraph.length > 0 || unordered.length > 0 || ordered.length > 0) flush();
      quote.push(quoteLine[1] ?? '');
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (quote.length > 0 || unordered.length > 0 || ordered.length > 0) flush();
    paragraph.push(line);
  }
  if (code !== undefined) blocks.push({ type: 'code', language, text: code.join('\n') });
  flush();
  return blocks;
}

export function SafeMarkdown({ content }: { content: string }) {
  return (
    <div className="yanyi-markdown">
      {parseMarkdown(content).map((block, index) => {
        const key = `${block.type}-${String(index)}`;
        if (block.type === 'heading') {
          const children = inlineNodes(block.text, key);
          if (block.level === 2) return <h2 key={key}>{children}</h2>;
          if (block.level === 3) return <h3 key={key}>{children}</h3>;
          return <h4 key={key}>{children}</h4>;
        }
        if (block.type === 'code') {
          return (
            <pre data-language={block.language || undefined} key={key}>
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === 'quote') {
          return <blockquote key={key}>{inlineNodes(block.lines.join(' '), key)}</blockquote>;
        }
        if (block.type === 'unordered-list') {
          return (
            <ul key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${String(itemIndex)}`}>{inlineNodes(item, key)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ordered-list') {
          return (
            <ol key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${String(itemIndex)}`}>{inlineNodes(item, key)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={key}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={`${key}-${String(lineIndex)}`}>
                {lineIndex > 0 && <br />}
                {inlineNodes(line, `${key}-${String(lineIndex)}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
