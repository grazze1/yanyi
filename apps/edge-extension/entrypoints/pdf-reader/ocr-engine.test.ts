import { describe, expect, it } from 'vitest';
import { disabledOcrEngine } from './ocr-engine';

describe('optional OCR boundary', () => {
  it('is explicitly disabled and never silently uploads a page', async () => {
    expect(disabledOcrEngine.enabled).toBe(false);
    await expect(
      disabledOcrEngine.recognize({} as ImageData, 'eng', new AbortController().signal),
    ).rejects.toThrow('OCR_DISABLED');
  });
});
