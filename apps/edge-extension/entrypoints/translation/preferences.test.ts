import { describe, expect, it } from 'vitest';
import { defaultTranslationPreferences } from '@yanyi/shared-types';
import {
  applyPreferencePatch,
  parseStoredPreferences,
  translationSettingsKey,
} from './preferences';

describe('translation preferences', () => {
  it('accepts a validated patch and normalizes duplicate tags', () => {
    expect(
      applyPreferencePatch(defaultTranslationPreferences, {
        sourceLanguage: 'auto',
        targetLanguage: 'ja',
        primaryDomain: '人工智能与机器学习',
        tags: ['Transformer', ' Transformer '],
        modelProfileId: 'precise',
      }),
    ).toMatchObject({
      sourceLanguage: 'auto',
      targetLanguage: 'ja',
      primaryDomain: '人工智能与机器学习',
      tags: ['Transformer'],
      modelProfileId: 'precise',
    });
  });

  it('rejects untrusted values and falls back for corrupt stored data', () => {
    expect(applyPreferencePatch(defaultTranslationPreferences, { targetLanguage: 'invalid' })).toBe(
      undefined,
    );
    expect(parseStoredPreferences({ tags: [''] })).toEqual(defaultTranslationPreferences);
  });

  it('makes language, domain, tags, mode, and model part of the page reuse key', () => {
    const base = translationSettingsKey(defaultTranslationPreferences, 'domain-cs-se', ['Linux']);
    const changed = translationSettingsKey(
      { ...defaultTranslationPreferences, targetLanguage: 'ja' },
      'domain-cs-se',
      ['Linux'],
    );
    expect(changed).not.toBe(base);
  });
});
