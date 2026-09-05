import type {
  ProtocolEnvelope,
  TranslationProgressPayload,
  TranslationSegmentEventPayload,
  TranslationSegmentState,
  TranslationTaskState,
} from '@yanyi/protocol';

export interface ExtensionTaskState {
  taskId?: string;
  pageSessionId?: string;
  state: TranslationTaskState;
  total: number;
  completed: number;
  failed: number;
  sequence: number;
  message?: string;
  segments: Record<string, TranslationSegmentState>;
}

export const idleTaskState: ExtensionTaskState = {
  state: 'idle',
  total: 0,
  completed: 0,
  failed: 0,
  sequence: -1,
  segments: {},
};

export type SegmentCommitAck =
  | {
      rendered: true;
      accepted?: true;
      pending?: false;
      committedSegmentIds?: string[];
      message?: string;
    }
  | {
      rendered: false;
      accepted: true;
      pending: true;
      committedSegmentIds?: string[];
      message?: string;
    }
  | {
      rendered: false;
      accepted?: false;
      pending?: false;
      reason?: 'stale' | 'failed';
      message: string;
      committedSegmentIds?: string[];
    };

function transitionSegment(
  state: ExtensionTaskState,
  segmentId: string,
  segmentState: TranslationSegmentState,
): Pick<ExtensionTaskState, 'completed' | 'failed' | 'segments'> {
  const previous = state.segments[segmentId];
  return {
    completed:
      state.completed +
      (segmentState === 'completed' && previous !== 'completed' ? 1 : 0) -
      (previous === 'completed' && segmentState !== 'completed' ? 1 : 0),
    failed:
      state.failed +
      (segmentState === 'failed' && previous !== 'failed' ? 1 : 0) -
      (previous === 'failed' && segmentState !== 'failed' ? 1 : 0),
    segments: { ...state.segments, [segmentId]: segmentState },
  };
}

function withProgress(
  state: ExtensionTaskState,
  payload: TranslationProgressPayload,
): ExtensionTaskState {
  const browserTracksPageCommits = Object.keys(state.segments).length > 0;
  return {
    ...state,
    // Native completion means model output exists; it does not prove that the page accepted an
    // atomic DOM commit. For tracked page tasks, acknowledgement-derived counts are authoritative.
    completed: browserTracksPageCommits ? state.completed : payload.completed,
    failed: browserTracksPageCommits ? Math.max(state.failed, payload.failed) : payload.failed,
    total: browserTracksPageCommits ? state.total : payload.total,
  };
}

/** Ignores messages for another task and late/out-of-order Native Host events. */
export function reduceTaskEvent(
  state: ExtensionTaskState,
  event: ProtocolEnvelope<TranslationSegmentEventPayload | TranslationProgressPayload>,
): ExtensionTaskState {
  const taskId = event.payload.taskId;
  if (state.taskId !== undefined && state.taskId !== taskId) return state;
  if (event.sequence <= state.sequence) return state;
  const next = { ...state, taskId, sequence: event.sequence };
  switch (event.type) {
    case 'translation.segment.started': {
      const payload = event.payload as TranslationSegmentEventPayload;
      return {
        ...next,
        state: state.state === 'paused' ? 'paused' : 'translating',
        segments: { ...state.segments, [payload.segmentId]: 'translating' },
      };
    }
    case 'translation.segment.completed': {
      const payload = event.payload as TranslationSegmentEventPayload;
      return {
        ...next,
        ...transitionSegment(state, payload.segmentId, 'completed'),
      };
    }
    case 'translation.segment.failed': {
      const payload = event.payload as TranslationSegmentEventPayload;
      return {
        ...next,
        message: payload.error?.message ?? '一个页面片段翻译失败。',
        ...transitionSegment(state, payload.segmentId, 'failed'),
      };
    }
    case 'translation.progress':
      return withProgress(next, event.payload as TranslationProgressPayload);
    case 'translation.completed': {
      const completed = withProgress(next, event.payload as TranslationProgressPayload);
      const incomplete = completed.failed > 0 || completed.completed < completed.total;
      return {
        ...completed,
        state: incomplete ? (completed.completed === 0 ? 'error' : 'partial') : 'completed',
      };
    }
    case 'translation.cancelled':
      return {
        ...withProgress(next, event.payload as TranslationProgressPayload),
        state: 'cancelled',
      };
    case 'translation.failed':
      return { ...withProgress(next, event.payload as TranslationProgressPayload), state: 'error' };
    default:
      return next;
  }
}

/** Applies a Native completion only after the content script confirms its atomic DOM commit. */
export function reduceSegmentCommitAck(
  state: ExtensionTaskState,
  event: ProtocolEnvelope<TranslationSegmentEventPayload>,
  acknowledgement: SegmentCommitAck,
): ExtensionTaskState {
  const taskId = event.payload.taskId;
  if (state.taskId !== undefined && state.taskId !== taskId) return state;
  if (event.sequence <= state.sequence) return state;
  if (acknowledgement.accepted === true && acknowledgement.pending) {
    // A split TextNode is still showing its source snapshot. Keep the part in-flight until
    // the content script atomically commits every sibling part belonging to that node.
    return { ...state, taskId, sequence: event.sequence };
  }
  if (acknowledgement.rendered) {
    let committed: ExtensionTaskState = { ...state, taskId, sequence: event.sequence };
    const committedSegmentIds = new Set([
      event.payload.segmentId,
      ...(acknowledgement.committedSegmentIds ?? []),
    ]);
    for (const segmentId of committedSegmentIds) {
      committed = {
        ...committed,
        ...transitionSegment(committed, segmentId, 'completed'),
      };
    }
    return committed;
  }
  if ('reason' in acknowledgement && acknowledgement.reason === 'stale') {
    return {
      ...state,
      taskId,
      sequence: event.sequence,
      total: Math.max(0, state.total - 1),
      ...(acknowledgement.message === undefined ? {} : { message: acknowledgement.message }),
      ...transitionSegment(state, event.payload.segmentId, 'stale'),
    };
  }
  return {
    ...state,
    taskId,
    sequence: event.sequence,
    message: acknowledgement.message ?? '页面拒绝提交片段译文，已保留原文。',
    ...transitionSegment(state, event.payload.segmentId, 'failed'),
  };
}

/** Keeps the browser recovery cache aligned with translations actually visible in the page. */
export function applySegmentCommitToCache(
  completedByHash: Readonly<Record<string, string>>,
  payload: TranslationSegmentEventPayload,
  acknowledgement: SegmentCommitAck,
): Record<string, string> {
  if (acknowledgement.rendered && payload.translation !== undefined) {
    return { ...completedByHash, [payload.sourceHash]: payload.translation };
  }
  return Object.fromEntries(
    Object.entries(completedByHash).filter(([sourceHash]) => sourceHash !== payload.sourceHash),
  );
}

export function createScanningTask(taskId: string, pageSessionId: string): ExtensionTaskState {
  return { ...idleTaskState, taskId, pageSessionId, state: 'scanning' };
}

export function createQueuedTask(
  taskId: string,
  pageSessionId: string,
  segmentIds: readonly string[],
): ExtensionTaskState {
  return {
    ...idleTaskState,
    taskId,
    pageSessionId,
    state: 'queued',
    total: segmentIds.length,
    segments: Object.fromEntries(segmentIds.map((segmentId) => [segmentId, 'queued'])),
  };
}
