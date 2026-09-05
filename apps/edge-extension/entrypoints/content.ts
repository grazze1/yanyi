import { browser } from 'wxt/browser';
import type { AssistantIntent, TranslationSegmentEventPayload } from '@yanyi/protocol';
import type { TranslationMode } from '@yanyi/shared-types';
import type { SelectionContext } from './assistant/types';
import {
  mountSelectionPopover,
  type PopoverRect,
  type SelectionPopoverHandle,
} from './selection/SelectionPopover';
import { PageTranslationController } from './translation/translation-controller';
import { PageTranslationToolbar } from './translation/page-toolbar';
import { stableHash, type SegmentationOptions } from './translation/segmenter';

type ContentRequest =
  | { type: 'yanyi.page.inspect' }
  | { type: 'yanyi.selection.context' }
  | {
      type: 'yanyi.selection.popover.open';
      context: Partial<SelectionContext> & { intent?: string };
    }
  | { type: 'yanyi.source.highlight'; excerpt: string }
  | { type: 'yanyi.translation.scan.start'; policy?: SegmentationOptions }
  | { type: 'yanyi.translation.scan.continue'; cursor?: number }
  | { type: 'yanyi.translation.scan.diagnostics' }
  | {
      type: 'yanyi.translation.segment.completed';
      payload: TranslationSegmentEventPayload;
      mode: TranslationMode;
    }
  | { type: 'yanyi.translation.segment.failed'; segmentId: string }
  | { type: 'yanyi.translation.mode.set'; mode: TranslationMode }
  | { type: 'yanyi.translation.restore' };

interface SelectionSnapshot {
  text: string;
  range: Range;
  sentence: string;
  adjacentText: string;
  paragraph: string;
  heading: string;
  headingPath: string[];
  componentTitle?: string;
  componentText?: string;
  labels: string[];
  buttonText?: string;
  domRole: string;
  contextHash: string;
  capturedAt: number;
}

function selectionElement(range: Range): Element | undefined {
  const node = range.commonAncestorContainer;
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : (node.parentElement ?? undefined);
}

function headingForSelection(element: Element | undefined): string {
  const section = element?.closest('section,article,main');
  const sectionHeading = section?.querySelector('h1,h2,h3,h4,h5,h6')?.textContent.trim();
  if (sectionHeading !== undefined && sectionHeading.length > 0) return sectionHeading;
  const preceding = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter(
      (candidate) =>
        (candidate.compareDocumentPosition(element ?? document.body) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
    )
    .at(-1)
    ?.textContent.trim();
  return preceding === undefined || preceding.length === 0 ? document.title : preceding;
}

function headingPathForSelection(element: Element | undefined): string[] {
  if (element === undefined) return [];
  const path: string[] = [];
  const container = element.closest('section,article,main');
  const headings = container === null ? [] : [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  for (const section of headings) {
    if ((section.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) === 0)
      continue;
    const text = section.textContent.trim();
    if (text.length > 0) path.push(text.slice(0, 240));
  }
  const current = headingForSelection(element);
  if (current.length > 0 && path.at(-1) !== current) path.push(current);
  return [...new Set(path)].slice(-6);
}

function sentenceContext(
  paragraph: string,
  selection: string,
): { sentence: string; adjacentText: string } {
  const index = paragraph.indexOf(selection);
  if (index < 0) return { sentence: selection, adjacentText: paragraph.slice(0, 2_000) };
  const before = paragraph.slice(0, index);
  const after = paragraph.slice(index + selection.length);
  const sentenceStart = Math.max(
    before.lastIndexOf('. '),
    before.lastIndexOf('。'),
    before.lastIndexOf('! '),
    before.lastIndexOf('? '),
  );
  const nextBoundaries = [
    after.indexOf('. '),
    after.indexOf('。'),
    after.indexOf('! '),
    after.indexOf('? '),
  ].filter((boundary) => boundary >= 0);
  const sentenceEnd = nextBoundaries.length === 0 ? after.length : Math.min(...nextBoundaries) + 1;
  return {
    sentence: paragraph
      .slice(sentenceStart < 0 ? 0 : sentenceStart + 1, index + selection.length + sentenceEnd)
      .trim()
      .slice(0, 2_000),
    adjacentText: paragraph.slice(Math.max(0, index - 800), index + selection.length + 800),
  };
}

function selectionDomRole(element: Element | undefined): string {
  if (element === undefined) return 'text';
  if (element.closest('button,[role="button"]') !== null) return 'button';
  if (element.closest('a[href],[role="link"]') !== null) return 'link';
  if (element.closest('h1,h2,h3,h4,h5,h6,[role="heading"]') !== null) return 'heading';
  if (element.closest('th,td,caption,[role="cell"]') !== null) return 'table_cell';
  if (element.closest('li,[role="listitem"]') !== null) return 'list_item';
  if (element.closest('nav,[role="navigation"]') !== null) return 'navigation';
  if (element.closest('p,blockquote,figcaption') !== null) return 'paragraph';
  return 'text';
}

function componentContext(element: Element | undefined): {
  componentTitle?: string;
  componentText?: string;
  labels: string[];
  buttonText?: string;
} {
  if (element === undefined) return { labels: [] };
  const component = element.closest(
    '[data-yanyi-component],article,section,nav,table,tr,li,form,figure,details,[role="region"],[role="dialog"]',
  );
  const componentTitle =
    component?.querySelector('h1,h2,h3,h4,h5,h6,caption,legend,summary')?.textContent.trim() ??
    component?.getAttribute('aria-label')?.trim();
  const componentText = component?.textContent.replace(/\s+/gu, ' ').trim().slice(0, 4_000);
  const labels = [
    element.closest('label')?.textContent,
    element.closest('[aria-label]')?.getAttribute('aria-label'),
    element.id.length > 0
      ? element.ownerDocument.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent
      : undefined,
  ]
    .flatMap((label) => (label === null || label === undefined ? [] : [label.trim().slice(0, 240)]))
    .filter((label) => label.length > 0);
  const buttonText = element.closest('button,[role="button"]')?.textContent.trim().slice(0, 240);
  return {
    ...(componentTitle === undefined || componentTitle.length === 0 ? {} : { componentTitle }),
    ...(componentText === undefined || componentText.length === 0 ? {} : { componentText }),
    labels: [...new Set(labels)].slice(0, 12),
    ...(buttonText === undefined || buttonText.length === 0 ? {} : { buttonText }),
  };
}

function captureSelection(previous?: SelectionSnapshot): SelectionSnapshot | undefined {
  const selection = getSelection();
  const text = selection?.toString().trim() ?? '';
  if (
    selection === null ||
    selection.rangeCount === 0 ||
    selection.isCollapsed ||
    text.length === 0
  )
    return previous;
  const range = selection.getRangeAt(0).cloneRange();
  const element = selectionElement(range);
  const paragraph =
    element?.closest('p,li,blockquote,td,th,figcaption,section,article')?.textContent.trim() ??
    text;
  const boundedParagraph = paragraph.slice(0, 8_000);
  const sentence = sentenceContext(boundedParagraph, text);
  const component = componentContext(element);
  const contextHash = stableHash(
    JSON.stringify([
      location.origin,
      location.pathname,
      text,
      boundedParagraph,
      headingForSelection(element),
      component.componentTitle ?? '',
    ]),
  );
  return {
    text,
    range,
    ...sentence,
    paragraph: boundedParagraph,
    heading: headingForSelection(element).slice(0, 500),
    headingPath: headingPathForSelection(element),
    ...component,
    domRole: selectionDomRole(element),
    contextHash,
    capturedAt: Date.now(),
  };
}

function rectFromRange(range: Range): PopoverRect | undefined {
  if (!range.startContainer.isConnected || typeof range.getBoundingClientRect !== 'function')
    return undefined;
  const rect = range.getBoundingClientRect();
  if (
    ![rect.top, rect.right, rect.bottom, rect.left, rect.width, rect.height].every(Number.isFinite)
  )
    return undefined;
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function assistantIntent(value: string | undefined): AssistantIntent {
  if (value === 'translate' || value === 'explain') return value;
  return 'follow_up';
}

export default defineContentScript({
  registration: 'runtime',
  main() {
    let toolbar: PageTranslationToolbar | undefined;
    let selectionSnapshot: SelectionSnapshot | undefined;
    let selectionPopover: SelectionPopoverHandle | undefined;
    let translatedLocation: string | undefined;

    const controller = new PageTranslationController(document, {
      onScanUpdate: (update) => {
        translatedLocation = location.href;
        if (update.reason === 'navigation') {
          toolbar?.destroy();
          toolbar = undefined;
        }
        if (update.segments.length > 0) toolbar?.addTotal(update.segments.length);
        void browser.runtime
          .sendMessage({ type: 'yanyi.translation.scan.updated', payload: update })
          .catch(() => undefined);
      },
    });
    const shadowEventType = `yanyi-shadow-${crypto.randomUUID()}`;
    document.addEventListener(
      shadowEventType,
      (event) => {
        const host = event.target;
        if (!(host instanceof Element) || host.shadowRoot === null) return;
        controller.observeOpenShadowRoot(host.shadowRoot);
      },
      { capture: true },
    );
    void browser.runtime.sendMessage({
      type: 'yanyi.shadow-hook.install',
      eventType: shadowEventType,
    });
    const removeToolbar = () => {
      toolbar?.destroy();
      toolbar = undefined;
    };
    const ensureToolbar = (total: number) => {
      removeToolbar();
      toolbar = new PageTranslationToolbar(document, {
        setMode: (mode) => {
          controller.setMode(mode);
          void browser.runtime.sendMessage({ type: 'yanyi.translation.mode.set', mode });
        },
        pause: () => {
          void browser.runtime.sendMessage({ type: 'yanyi.translation.pause' });
        },
        resume: () => {
          void browser.runtime.sendMessage({ type: 'yanyi.translation.resume' });
        },
        cancel: () => {
          void browser.runtime.sendMessage({ type: 'yanyi.translation.cancel' });
        },
        restore: () => {
          controller.restore();
          translatedLocation = undefined;
          removeToolbar();
          void browser.runtime.sendMessage({ type: 'yanyi.translation.restore' });
        },
      });
      toolbar.mount(total);
    };

    const refreshSelection = () => {
      selectionSnapshot = captureSelection(selectionSnapshot);
    };
    document.addEventListener('selectionchange', refreshSelection, { passive: true });
    document.addEventListener('contextmenu', refreshSelection, { capture: true, passive: true });

    const handleSpaNavigation = () => {
      if (
        controller.getPageSessionId() === undefined ||
        translatedLocation === undefined ||
        translatedLocation === location.href
      )
        return;
      const result = controller.handleNavigation();
      translatedLocation = location.href;
      ensureToolbar(result.segments.length);
    };
    window.addEventListener('popstate', handleSpaNavigation);
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);
    try {
      history.pushState = (...arguments_) => {
        originalPushState(...arguments_);
        queueMicrotask(handleSpaNavigation);
      };
      history.replaceState = (...arguments_) => {
        originalReplaceState(...arguments_);
        queueMicrotask(handleSpaNavigation);
      };
    } catch {
      // Some pages freeze History methods; MutationObserver still detects their DOM navigation.
    }

    document.documentElement.dataset.yanyiContentReady = 'true';
    void browser.runtime.sendMessage({ type: 'yanyi.page.ready' });
    const handleContentRequest = (message: ContentRequest): unknown => {
      switch (message.type) {
        case 'yanyi.page.inspect':
          return {
            title: document.title,
            url: location.href,
            selection: getSelection()?.toString() ?? '',
            isPdf: document.contentType === 'application/pdf',
          };
        case 'yanyi.selection.context': {
          selectionSnapshot = captureSelection(selectionSnapshot);
          const snapshot = selectionSnapshot;
          return {
            text: snapshot?.text ?? '',
            sentence: snapshot?.sentence ?? '',
            adjacentText: snapshot?.adjacentText ?? '',
            paragraph: snapshot?.paragraph ?? '',
            heading: snapshot?.heading ?? document.title,
            headingPath: snapshot?.headingPath ?? [],
            ...(snapshot?.componentTitle === undefined
              ? {}
              : { componentTitle: snapshot.componentTitle }),
            ...(snapshot?.componentText === undefined
              ? {}
              : { componentText: snapshot.componentText }),
            labels: snapshot?.labels ?? [],
            ...(snapshot?.buttonText === undefined ? {} : { buttonText: snapshot.buttonText }),
            domRole: snapshot?.domRole ?? 'text',
            ...(snapshot?.contextHash === undefined ? {} : { contextHash: snapshot.contextHash }),
            title: document.title,
            url: location.href,
            isPdf: document.contentType === 'application/pdf',
            pageSessionId: controller.getPageSessionId(),
            capturedAt: snapshot?.capturedAt ?? Date.now(),
          };
        }
        case 'yanyi.selection.popover.open': {
          selectionSnapshot = captureSelection(selectionSnapshot);
          const snapshot = selectionSnapshot;
          const text = message.context.text?.trim() ?? snapshot?.text ?? '';
          const range = snapshot?.range;
          const anchorRect = range === undefined ? undefined : rectFromRange(range);
          if (
            text.length === 0 ||
            snapshot === undefined ||
            range === undefined ||
            anchorRect === undefined
          )
            return { accepted: false, reason: 'selection_unavailable' };
          const pageSessionId = message.context.pageSessionId ?? controller.getPageSessionId();
          const intent = assistantIntent(message.context.intent);
          const componentTitle = message.context.componentTitle ?? snapshot.componentTitle;
          const componentText = message.context.componentText ?? snapshot.componentText;
          const buttonText = message.context.buttonText ?? snapshot.buttonText;
          const context: SelectionContext = {
            text,
            sentence: message.context.sentence ?? snapshot.sentence,
            adjacentText: message.context.adjacentText ?? snapshot.adjacentText,
            paragraph: message.context.paragraph ?? snapshot.paragraph,
            heading: message.context.heading ?? snapshot.heading,
            headingPath: message.context.headingPath ?? snapshot.headingPath,
            ...(componentTitle === undefined ? {} : { componentTitle }),
            ...(componentText === undefined ? {} : { componentText }),
            labels: message.context.labels ?? snapshot.labels,
            ...(buttonText === undefined ? {} : { buttonText }),
            domRole: message.context.domRole ?? snapshot.domRole,
            ...(message.context.domainId === undefined
              ? {}
              : { domainId: message.context.domainId }),
            ...(message.context.glossaryRules === undefined
              ? {}
              : { glossaryRules: message.context.glossaryRules }),
            ...(message.context.technicalTags === undefined
              ? {}
              : { technicalTags: message.context.technicalTags }),
            contextHash: message.context.contextHash ?? snapshot.contextHash,
            title: message.context.title ?? document.title,
            url: message.context.url ?? location.href,
            isPdf: message.context.isPdf ?? document.contentType === 'application/pdf',
            intent,
            tabId: message.context.tabId ?? 0,
            ...(message.context.frameId === undefined ? {} : { frameId: message.context.frameId }),
            capturedAt: message.context.capturedAt ?? snapshot.capturedAt,
            ...(pageSessionId === undefined ? {} : { pageSessionId }),
          };
          selectionPopover?.close();
          const mounted = mountSelectionPopover({
            ownerDocument: document,
            anchorRect,
            getAnchorRect: () => rectFromRange(range) ?? anchorRect,
            context,
            intent,
            autoStart: intent !== 'follow_up',
            onClose: () => {
              selectionPopover = undefined;
            },
          });
          selectionPopover = mounted;
          if (intent === 'follow_up') selectionPopover.focus();
          return { accepted: true };
        }
        case 'yanyi.source.highlight': {
          const excerpt = message.excerpt.trim();
          if (excerpt.length === 0) return { highlighted: false };
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Node | null = walker.nextNode();
          while (node !== null) {
            const value = node.textContent ?? '';
            const index = value.indexOf(excerpt);
            if (index >= 0) {
              const range = document.createRange();
              range.setStart(node, index);
              range.setEnd(node, index + excerpt.length);
              const selection = getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
              node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              return { highlighted: true };
            }
            node = walker.nextNode();
          }
          return { highlighted: false };
        }
        case 'yanyi.translation.scan.start': {
          const result = controller.startScan(message.policy);
          translatedLocation = location.href;
          ensureToolbar(result.segments.length);
          return result;
        }
        case 'yanyi.translation.scan.continue': {
          const result = controller.continueScan(message.cursor);
          if (result === undefined) return { accepted: false, reason: 'no_continuation' };
          toolbar?.addTotal(result.segments.length);
          return { accepted: true, ...result };
        }
        case 'yanyi.translation.scan.diagnostics':
          return {
            accepted: true,
            pageSessionId: controller.getPageSessionId(),
            diagnostics: controller.getDiagnostics(),
          };
        case 'yanyi.translation.segment.completed': {
          const completion = controller.completeSegment(message.payload, message.mode);
          if (completion.rendered)
            toolbar?.markCompleted(Math.max(1, completion.committedSegmentIds.length));
          return completion;
        }
        case 'yanyi.translation.segment.failed':
          return {
            accepted: true,
            discardedSegmentIds: controller.failSegment(message.segmentId),
          };
        case 'yanyi.translation.mode.set':
          controller.setMode(message.mode);
          return { accepted: true };
        case 'yanyi.translation.restore':
          controller.restore();
          translatedLocation = undefined;
          removeToolbar();
          return { accepted: true };
      }
    };
    browser.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
      const response = handleContentRequest(message);
      if (response !== undefined) sendResponse(response);
      return false;
    });
  },
});
