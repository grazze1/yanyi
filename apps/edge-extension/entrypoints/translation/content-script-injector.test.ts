import { describe, expect, it, vi } from 'vitest';
import { ContentScriptInjector } from './content-script-injector';

describe('ContentScriptInjector', () => {
  it('reuses an existing content script without injecting twice', async () => {
    const inspect = vi.fn().mockResolvedValue(true);
    const inject = vi.fn();
    const injector = new ContentScriptInjector({ inspect, inject });

    await expect(injector.ensure(42)).resolves.toBe(true);
    expect(inspect).toHaveBeenCalledWith(42);
    expect(inject).not.toHaveBeenCalled();
  });

  it('injects on demand and waits until the tab responds', async () => {
    const inspect = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const inject = vi.fn().mockResolvedValue(undefined);
    const delay = vi.fn().mockResolvedValue(undefined);
    const injector = new ContentScriptInjector({ inspect, inject, delay }, 3, 1);

    await expect(injector.ensure(7)).resolves.toBe(true);
    expect(inject).toHaveBeenCalledWith(7);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it('performs the final inspection after the last delay', async () => {
    const inspect = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const inject = vi.fn().mockResolvedValue(undefined);
    const delay = vi.fn().mockResolvedValue(undefined);
    const injector = new ContentScriptInjector({ inspect, inject, delay }, 3, 250);

    await expect(injector.ensure(8)).resolves.toBe(true);
    expect(inspect).toHaveBeenCalledTimes(4);
    expect(delay).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenNthCalledWith(3, 250);
  });

  it('deduplicates concurrent injection for the same tab', async () => {
    let ready = false;
    const inspect = vi.fn(() => Promise.resolve(ready));
    const inject = vi.fn(() => {
      ready = true;
      return Promise.resolve();
    });
    const injector = new ContentScriptInjector({ inspect, inject });

    const [first, second] = await Promise.all([injector.ensure(9), injector.ensure(9)]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(inject).toHaveBeenCalledTimes(1);
  });

  it('returns false when Edge rejects injection on a restricted page', async () => {
    const injector = new ContentScriptInjector({
      inspect: vi.fn().mockResolvedValue(false),
      inject: vi.fn().mockRejectedValue(new Error('Cannot access edge:// page')),
    });

    await expect(injector.ensure(13)).resolves.toBe(false);
  });
});
