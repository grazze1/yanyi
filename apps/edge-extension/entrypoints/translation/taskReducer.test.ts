import { describe, expect, it } from 'vitest';
import type { ProtocolEnvelope } from '@yanyi/protocol';
import {
  applySegmentCommitToCache,
  createQueuedTask,
  reduceSegmentCommitAck,
  reduceTaskEvent,
} from './taskReducer';

const event = (sequence: number, type: string): ProtocolEnvelope<any> => ({
  protocolVersion: 1,
  requestId: '00000000-0000-4000-8000-000000000001',
  type: type as ProtocolEnvelope['type'],
  sequence,
  done: false,
  payload: {
    taskId: 'task-1',
    segmentId: 'segment-1',
    sourceHash: 'hash',
    completed: 1,
    failed: 0,
    total: 1,
  },
});

describe('task reducer', () => {
  it('ignores stale sequences and routes only the active task', () => {
    const queued = createQueuedTask('task-1', 'session-1', ['segment-1']);
    const started = reduceTaskEvent(queued, event(1, 'translation.segment.started'));
    expect(started.segments['segment-1']).toBe('translating');
    expect(reduceTaskEvent(started, event(1, 'translation.segment.completed'))).toEqual(started);
    expect(
      reduceTaskEvent(started, {
        ...event(2, 'translation.segment.completed'),
        payload: { taskId: 'other' },
      } as any),
    ).toEqual(started);
  });

  it('does not trust Native terminal counts without page commit acknowledgements', () => {
    const queued = createQueuedTask('task-1', 'session-1', ['segment-1', 'segment-2']);

    const partial = reduceTaskEvent(queued, {
      ...event(1, 'translation.completed'),
      payload: { taskId: 'task-1', completed: 1, failed: 1, total: 2, reason: 'partial' },
    } as any);
    expect(partial).toMatchObject({ state: 'error', completed: 0, failed: 1, total: 2 });

    const completed = reduceTaskEvent(queued, {
      ...event(1, 'translation.completed'),
      payload: { taskId: 'task-1', completed: 2, failed: 0, total: 2, reason: 'completed' },
    } as any);
    expect(completed).toMatchObject({ state: 'error', completed: 0, failed: 0, total: 2 });
  });

  it('keeps translation.failed as an error terminal state', () => {
    const queued = createQueuedTask('task-1', 'session-1', ['segment-1']);
    const failed = reduceTaskEvent(queued, {
      ...event(1, 'translation.failed'),
      payload: {
        taskId: 'task-1',
        completed: 0,
        failed: 1,
        total: 1,
        reason: 'all_segments_failed',
      },
    } as any);

    expect(failed.state).toBe('error');
    expect(failed.completed).toBe(0);
    expect(failed.failed).toBe(1);
    expect(failed.total).toBe(1);
  });

  it('counts a Native completion only after the page acknowledges the DOM commit', () => {
    const queued = createQueuedTask('task-1', 'session-1', ['segment-1']);
    const started = reduceTaskEvent(queued, event(1, 'translation.segment.started'));
    const rejected = reduceSegmentCommitAck(started, event(2, 'translation.segment.completed'), {
      rendered: false,
      message: '页面内容已变化，片段译文未提交，已保留原文。',
    });

    expect(rejected.completed).toBe(0);
    expect(rejected.failed).toBe(1);
    expect(rejected.segments['segment-1']).toBe('failed');
    expect(rejected.message).toContain('已保留原文');

    const nativeProgress = reduceTaskEvent(rejected, {
      ...event(3, 'translation.progress'),
      payload: { taskId: 'task-1', completed: 1, failed: 0, total: 1 },
    });
    expect(nativeProgress).toMatchObject({ completed: 0, failed: 1, total: 1 });

    const terminal = reduceTaskEvent(nativeProgress, {
      ...event(4, 'translation.completed'),
      done: true,
      payload: { taskId: 'task-1', completed: 1, failed: 0, total: 1 },
    });
    expect(terminal.state).toBe('error');
    expect(terminal.message).toContain('已保留原文');
  });

  it('reports partial when only some Native completions are committed to the page', () => {
    const queued = createQueuedTask('task-1', 'session-1', ['segment-1', 'segment-2']);
    const firstStarted = reduceTaskEvent(queued, event(1, 'translation.segment.started'));
    const firstCommitted = reduceSegmentCommitAck(
      firstStarted,
      event(2, 'translation.segment.completed'),
      { rendered: true },
    );
    const secondStarted = reduceTaskEvent(firstCommitted, {
      ...event(3, 'translation.segment.started'),
      payload: { ...event(3, 'translation.segment.started').payload, segmentId: 'segment-2' },
    });
    const secondRejected = reduceSegmentCommitAck(
      secondStarted,
      {
        ...event(4, 'translation.segment.completed'),
        payload: { ...event(4, 'translation.segment.completed').payload, segmentId: 'segment-2' },
      },
      { rendered: false, message: '第二段无法写入页面，已保留原文。' },
    );
    const terminal = reduceTaskEvent(secondRejected, {
      ...event(5, 'translation.completed'),
      done: true,
      payload: { taskId: 'task-1', completed: 2, failed: 0, total: 2 },
    });

    expect(terminal).toMatchObject({
      state: 'partial',
      completed: 1,
      failed: 1,
      total: 2,
      message: '第二段无法写入页面，已保留原文。',
    });
  });

  it('persists a translated hash only for a successful DOM commit acknowledgement', () => {
    const payload = {
      taskId: 'task-1',
      segmentId: 'segment-1',
      sourceHash: 'hash',
      translation: '译文',
    };
    const committed = applySegmentCommitToCache({}, payload, { rendered: true });
    expect(committed).toEqual({ hash: '译文' });

    const rejected = applySegmentCommitToCache(committed, payload, {
      rendered: false,
      message: '页面拒绝提交，已保留原文。',
    });
    expect(rejected).toEqual({});
    expect(committed).toEqual({ hash: '译文' });
  });

  it('removes a superseded DOM version from the active denominator without reporting failure', () => {
    const queued = createQueuedTask('task-1', 'session-1', ['segment-1']);
    const started = reduceTaskEvent(queued, event(1, 'translation.segment.started'));
    const stale = reduceSegmentCommitAck(started, event(2, 'translation.segment.completed'), {
      rendered: false,
      reason: 'stale',
      message: '页面内容已更新，旧版本译文已丢弃。',
    });

    expect(stale).toMatchObject({ completed: 0, failed: 0, total: 0 });
    expect(stale.segments['segment-1']).toBe('stale');

    const terminal = reduceTaskEvent(stale, {
      ...event(3, 'translation.completed'),
      done: true,
      payload: { taskId: 'task-1', completed: 0, failed: 0, total: 0 },
    });
    expect(terminal.state).toBe('completed');
  });

  it('does not count or cache a split part before its TextNode is atomically rendered', () => {
    const queued = createQueuedTask('task-1', 'session-1', ['segment-1', 'segment-2']);
    const started = reduceTaskEvent(queued, event(1, 'translation.segment.started'));
    const acknowledgement = {
      rendered: false as const,
      accepted: true as const,
      pending: true as const,
    };

    const accepted = reduceSegmentCommitAck(
      started,
      event(2, 'translation.segment.completed'),
      acknowledgement,
    );
    expect(accepted).toMatchObject({ completed: 0, failed: 0 });
    expect(accepted.segments['segment-1']).toBe('translating');
    const nativeProgress = reduceTaskEvent(accepted, {
      ...event(3, 'translation.progress'),
      payload: { taskId: 'task-1', completed: 1, failed: 0, total: 2 },
    });
    expect(nativeProgress).toMatchObject({ completed: 0, failed: 0, total: 2 });
    expect(
      applySegmentCommitToCache(
        {},
        {
          taskId: 'task-1',
          segmentId: 'segment-1',
          sourceHash: 'hash',
          translation: '聚合中的译文部分',
        },
        acknowledgement,
      ),
    ).toEqual({});
  });

  it('marks every split part complete only when the final part renders the whole TextNode', () => {
    const queued = createQueuedTask('task-1', 'session-1', ['segment-1', 'segment-2']);
    const firstStarted = reduceTaskEvent(queued, event(1, 'translation.segment.started'));
    const firstPending = reduceSegmentCommitAck(
      firstStarted,
      event(2, 'translation.segment.completed'),
      { rendered: false, accepted: true, pending: true },
    );
    const secondStarted = reduceTaskEvent(firstPending, {
      ...event(3, 'translation.segment.started'),
      payload: { ...event(3, 'translation.segment.started').payload, segmentId: 'segment-2' },
    });
    const rendered = reduceSegmentCommitAck(
      secondStarted,
      {
        ...event(4, 'translation.segment.completed'),
        payload: { ...event(4, 'translation.segment.completed').payload, segmentId: 'segment-2' },
      },
      { rendered: true, committedSegmentIds: ['segment-1', 'segment-2'] },
    );

    expect(rendered).toMatchObject({ completed: 2, failed: 0 });
    expect(rendered.segments).toMatchObject({
      'segment-1': 'completed',
      'segment-2': 'completed',
    });
  });

  it('keeps zero completed parts when a split TextNode never reaches its atomic commit', () => {
    const queued = createQueuedTask('task-1', 'session-1', ['segment-1', 'segment-2']);
    const firstStarted = reduceTaskEvent(queued, event(1, 'translation.segment.started'));
    const firstPending = reduceSegmentCommitAck(
      firstStarted,
      event(2, 'translation.segment.completed'),
      { rendered: false, accepted: true, pending: true },
    );
    const nativeProgress = reduceTaskEvent(firstPending, {
      ...event(3, 'translation.segment.started'),
      type: 'translation.progress',
      payload: { taskId: 'task-1', completed: 1, failed: 0, total: 2 },
    });
    expect(nativeProgress).toMatchObject({ completed: 0, failed: 0, total: 2 });
    const secondStarted = reduceTaskEvent(nativeProgress, {
      ...event(4, 'translation.segment.started'),
      payload: { ...event(3, 'translation.segment.started').payload, segmentId: 'segment-2' },
    });
    const secondFailed = reduceTaskEvent(secondStarted, {
      ...event(5, 'translation.segment.failed'),
      payload: {
        ...event(5, 'translation.segment.failed').payload,
        segmentId: 'segment-2',
        error: { code: 'invalid_translation', message: '译文校验失败。', recoverable: true },
      },
    });
    const terminal = reduceTaskEvent(secondFailed, {
      ...event(6, 'translation.completed'),
      done: true,
      payload: { taskId: 'task-1', completed: 1, failed: 1, total: 2, reason: 'partial' },
    } as any);

    expect(terminal).toMatchObject({ state: 'error', completed: 0, failed: 1, total: 2 });
    expect(terminal.segments['segment-1']).toBe('translating');
  });
});
