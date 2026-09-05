/**
 * Model selectability and capability rules.
 *
 * Four distinct states, deliberately separating "we have not checked" from
 * "we checked and it is not supported":
 *
 * - `verified`    — capabilities confirmed for this model.
 * - `unverified`  — not checked yet. The model is still selectable and usable with
 *                   safe default parameters; the user may run a verification.
 * - `unsupported` — a specific capability was confirmed absent. Only that
 *                   capability is disabled, never the whole model.
 * - `unavailable` — the model does not exist or the provider refused it. Only this
 *                   state makes a model unusable.
 *
 * The pre-remediation build collapsed unverified into unavailable, which locked
 * every unrefreshed model out of the selector permanently.
 */

import type { AssistantModelOption } from './types';

export type ModelState = 'verified' | 'unverified' | 'unsupported' | 'unavailable';

export interface ModelPresentation {
  state: ModelState;
  /** False only for `unavailable`. */
  selectable: boolean;
  /** Short suffix shown next to the model id. */
  badge: string;
  /** Whether a verification action is worth offering. */
  canVerify: boolean;
}

/** Capability support, keeping "unknown" distinct from "unsupported". */
export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown';

export function modelState(model: AssistantModelOption): ModelState {
  if (model.availability === 'unavailable') return 'unavailable';
  return model.capabilityStatus === 'unverified' ? 'unverified' : 'verified';
}

export function presentModel(model: AssistantModelOption): ModelPresentation {
  const state = modelState(model);
  switch (state) {
    case 'unavailable':
      return { state, selectable: false, badge: '不可用', canVerify: true };
    case 'unverified':
      // Selectable on purpose: unverified is a status, not a lock.
      return { state, selectable: true, badge: '未验证', canVerify: true };
    default:
      return { state, selectable: true, badge: '', canVerify: false };
  }
}

/** Resolves thinking support for a model, distinguishing unknown from unsupported. */
export function thinkingSupport(model: AssistantModelOption | undefined): CapabilitySupport {
  if (model === undefined) return 'unknown';
  if (model.supportsThinking === true) return 'supported';
  // A recorded `false` is a confirmed refusal; `undefined` means never checked.
  if (model.supportsThinking === false) return 'unsupported';
  return 'unknown';
}

export interface ThinkingControlState {
  /** Only a confirmed-unsupported capability disables the control. */
  disabled: boolean;
  label: string;
  hint: string;
  /** Offer verification when support is still unknown. */
  showVerify: boolean;
}

export function thinkingControlState(
  model: AssistantModelOption | undefined,
  running: boolean,
): ThinkingControlState {
  const support = thinkingSupport(model);
  if (model === undefined) {
    return {
      disabled: true,
      label: '思考模式',
      hint: '请先选择模型。',
      showVerify: false,
    };
  }
  if (support === 'unsupported') {
    // Hide the option rather than pretending it may work.
    return {
      disabled: true,
      label: '思考模式：不支持',
      hint: '该模型已确认不支持思考模式；其他能力仍可使用。',
      showVerify: false,
    };
  }
  if (support === 'unknown') {
    return {
      disabled: running,
      label: '思考模式：未验证',
      hint: '尚未验证该模型的思考能力。可先验证，或按安全默认参数直接使用。',
      showVerify: true,
    };
  }
  return {
    disabled: running,
    label: '思考模式',
    hint: '该模型已验证支持思考模式。',
    showVerify: false,
  };
}

/**
 * Reasoning efforts to offer. Empty when the model has none recorded, so the
 * control is hidden instead of presenting values the provider may reject.
 */
export function reasoningEffortOptions(
  model: AssistantModelOption | undefined,
): ('high' | 'max')[] {
  if (model === undefined || thinkingSupport(model) === 'unsupported') return [];
  return model.reasoningEfforts;
}

/**
 * Whether a request may be sent with this model.
 *
 * Only `unavailable` blocks. Research never silently substitutes another model or
 * provider, so a blocked model is reported rather than replaced.
 */
export function canSendWithModel(model: AssistantModelOption | undefined): boolean {
  if (model === undefined) return true; // Falls back to the task preset.
  return modelState(model) !== 'unavailable';
}
