import { describe, expect, it } from 'vitest';
import { nextPageBatchCursor, pageBatchMessageType } from './page-job-lifecycle';

describe('nextPageBatchCursor', () => {
  it('keeps one page job and contiguous indexes for explicit long-page continuations', () => {
    const second = nextPageBatchCursor(
      { pageJobId: 'page-job-1', batchIndex: 0, finalBatchSent: false },
      false,
    );
    const final = nextPageBatchCursor(second, true);

    expect(second).toEqual({
      pageJobId: 'page-job-1',
      batchIndex: 1,
      finalBatchSent: false,
    });
    expect(final).toEqual({
      pageJobId: 'page-job-1',
      batchIndex: 2,
      finalBatchSent: true,
    });
    expect(pageBatchMessageType(second)).toBe('translation.batch.continue');
    expect(pageBatchMessageType(final)).toBe('translation.batch.continue');
  });

  it('starts a delta job at batch zero for content that arrives after the final batch', () => {
    const delta = nextPageBatchCursor(
      { pageJobId: 'completed-page-job', batchIndex: 3, finalBatchSent: true },
      true,
      () => 'delta-page-job',
    );

    expect(delta).toEqual({
      pageJobId: 'delta-page-job',
      batchIndex: 0,
      finalBatchSent: true,
    });
    expect(pageBatchMessageType(delta)).toBe('translation.start');
  });

  it('supports a capped delta job without leaking back into the completed job', () => {
    const firstDelta = nextPageBatchCursor(
      { pageJobId: 'completed-page-job', batchIndex: 0, finalBatchSent: true },
      false,
      () => 'delta-page-job',
    );
    const finalDelta = nextPageBatchCursor(firstDelta, true);

    expect(firstDelta.pageJobId).toBe('delta-page-job');
    expect(firstDelta.batchIndex).toBe(0);
    expect(pageBatchMessageType(firstDelta)).toBe('translation.start');
    expect(finalDelta).toEqual({
      pageJobId: 'delta-page-job',
      batchIndex: 1,
      finalBatchSent: true,
    });
    expect(pageBatchMessageType(finalDelta)).toBe('translation.batch.continue');
  });
});
