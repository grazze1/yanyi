export interface PageBatchCursor {
  pageJobId: string;
  batchIndex: number;
  /** True once the final native batch for the current page job has been dispatched. */
  finalBatchSent?: boolean;
}

export interface ResolvedPageBatchCursor extends PageBatchCursor {
  finalBatchSent: boolean;
}

export type PageBatchMessageType = 'translation.start' | 'translation.batch.continue';

/**
 * A logical page job is opened exactly once. Every later native batch for the
 * same job uses the continuation message, while a delta job restarts at batch
 * zero and therefore opens a fresh native page job.
 */
export function pageBatchMessageType(
  cursor: Pick<PageBatchCursor, 'batchIndex'>,
): PageBatchMessageType {
  return cursor.batchIndex === 0 ? 'translation.start' : 'translation.batch.continue';
}

/**
 * Advances a logical page job without reopening a job whose final batch was
 * already sent. Late MutationObserver work becomes a new delta job, while
 * ordinary long-page continuations keep their original job identity.
 */
export function nextPageBatchCursor(
  cursor: PageBatchCursor,
  finalBatch: boolean,
  createPageJobId: () => string = () => crypto.randomUUID(),
): ResolvedPageBatchCursor {
  if (cursor.finalBatchSent === true) {
    return {
      pageJobId: createPageJobId(),
      batchIndex: 0,
      finalBatchSent: finalBatch,
    };
  }
  return {
    pageJobId: cursor.pageJobId,
    batchIndex: cursor.batchIndex + 1,
    finalBatchSent: finalBatch,
  };
}
