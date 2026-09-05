export interface ContentScriptInjectionBridge {
  inspect: (tabId: number) => Promise<boolean>;
  inject: (tabId: number) => Promise<void>;
  delay?: (milliseconds: number) => Promise<void>;
}

export class ContentScriptInjector {
  private readonly pendingByTab = new Map<number, Promise<boolean>>();

  constructor(
    private readonly bridge: ContentScriptInjectionBridge,
    private readonly retryCount = 10,
    private readonly retryDelayMs = 250,
  ) {}

  ensure(tabId: number): Promise<boolean> {
    const existing = this.pendingByTab.get(tabId);
    if (existing !== undefined) return existing;
    const pending = this.injectAndWait(tabId).finally(() => this.pendingByTab.delete(tabId));
    this.pendingByTab.set(tabId, pending);
    return pending;
  }

  forget(tabId: number) {
    this.pendingByTab.delete(tabId);
  }

  private async injectAndWait(tabId: number): Promise<boolean> {
    if (await this.bridge.inspect(tabId)) return true;
    try {
      await this.bridge.inject(tabId);
    } catch {
      return false;
    }
    const delay = this.bridge.delay ?? defaultDelay;
    for (let attempt = 0; attempt < this.retryCount; attempt += 1) {
      await delay(this.retryDelayMs);
      if (await this.bridge.inspect(tabId)) return true;
    }
    return false;
  }
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
