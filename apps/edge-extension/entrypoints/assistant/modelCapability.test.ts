import { describe, expect, it } from 'vitest';
import {
  canSendWithModel,
  modelState,
  presentModel,
  reasoningEffortOptions,
  thinkingControlState,
  thinkingSupport,
} from './modelCapability';
import type { AssistantModelOption } from './types';

function model(overrides: Partial<AssistantModelOption> = {}): AssistantModelOption {
  return {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-pro',
    owner: 'deepseek',
    availability: 'available',
    capabilityStatus: 'verified',
    reasoningEfforts: ['high', 'max'],
    supportsThinking: true,
    ...overrides,
  };
}

describe('modelState', () => {
  it('treats an unverified model as unverified, not unavailable', () => {
    // The pre-remediation build collapsed these two, locking the model out.
    expect(modelState(model({ capabilityStatus: 'unverified' }))).toBe('unverified');
    expect(modelState(model({ availability: 'unknown', capabilityStatus: 'unverified' }))).toBe(
      'unverified',
    );
  });

  it('marks only a provider-refused model unavailable', () => {
    expect(modelState(model({ availability: 'unavailable' }))).toBe('unavailable');
  });

  it('treats a manually configured capability profile as verified', () => {
    expect(modelState(model({ capabilityStatus: 'manual' }))).toBe('verified');
  });
});

describe('presentModel', () => {
  it('keeps an unverified model selectable and offers verification', () => {
    const presentation = presentModel(model({ capabilityStatus: 'unverified' }));
    expect(presentation.selectable).toBe(true);
    expect(presentation.badge).toBe('未验证');
    expect(presentation.canVerify).toBe(true);
  });

  it('marks an unavailable model unselectable with a reason', () => {
    const presentation = presentModel(model({ availability: 'unavailable' }));
    expect(presentation.selectable).toBe(false);
    expect(presentation.badge).toBe('不可用');
  });

  it('shows no badge for a verified model', () => {
    expect(presentModel(model()).badge).toBe('');
    expect(presentModel(model()).canVerify).toBe(false);
  });
});

describe('thinkingSupport', () => {
  it('separates unknown from unsupported', () => {
    expect(thinkingSupport(model({ supportsThinking: true }))).toBe('supported');
    expect(thinkingSupport(model({ supportsThinking: false }))).toBe('unsupported');
    const unknown = model();
    delete unknown.supportsThinking;
    expect(thinkingSupport(unknown)).toBe('unknown');
    expect(thinkingSupport(undefined)).toBe('unknown');
  });
});

describe('thinkingControlState', () => {
  it('disables thinking only when support is confirmed absent', () => {
    const state = thinkingControlState(model({ supportsThinking: false }), false);
    expect(state.disabled).toBe(true);
    expect(state.label).toContain('不支持');
    expect(state.showVerify).toBe(false);
  });

  it('offers verification instead of pretending unsupported when unknown', () => {
    const unknown = model();
    delete unknown.supportsThinking;
    const state = thinkingControlState(unknown, false);
    expect(state.disabled).toBe(false);
    expect(state.label).toContain('未验证');
    expect(state.showVerify).toBe(true);
  });

  it('enables thinking for a verified model', () => {
    const state = thinkingControlState(model(), false);
    expect(state.disabled).toBe(false);
    expect(state.showVerify).toBe(false);
  });

  it('disables the control while a request is running', () => {
    expect(thinkingControlState(model(), true).disabled).toBe(true);
  });
});

describe('reasoningEffortOptions', () => {
  it('offers only the recorded efforts', () => {
    expect(reasoningEffortOptions(model())).toStrictEqual(['high', 'max']);
    expect(reasoningEffortOptions(model({ reasoningEfforts: [] }))).toStrictEqual([]);
  });

  it('offers nothing when thinking is unsupported', () => {
    expect(
      reasoningEffortOptions(model({ supportsThinking: false, reasoningEfforts: ['high'] })),
    ).toStrictEqual([]);
  });
});

describe('canSendWithModel', () => {
  it('permits verified and unverified models but not unavailable ones', () => {
    expect(canSendWithModel(model())).toBe(true);
    expect(canSendWithModel(model({ capabilityStatus: 'unverified' }))).toBe(true);
    expect(canSendWithModel(model({ availability: 'unavailable' }))).toBe(false);
  });

  it('permits an unknown model so the task preset can apply', () => {
    expect(canSendWithModel(undefined)).toBe(true);
  });
});
