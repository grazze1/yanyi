import {
  defaultModelProfiles,
  defaultTranslationPreferences,
  sourceLanguageOptions,
  targetLanguageOptions,
  topLevelDomains,
  type TranslationPreferencePatch,
  type TranslationPreferences,
} from '@yanyi/shared-types';

const sourceLanguageIds = new Set<string>(sourceLanguageOptions.map(({ id }) => id));
const targetLanguageIds = new Set<string>(targetLanguageOptions.map(({ id }) => id));
const modelProfileIds = new Set(defaultModelProfiles.map(({ id }) => id));
const modes = new Set(['replace', 'below', 'bilingual']);

export function applyPreferencePatch(
  current: TranslationPreferences,
  patch: unknown,
): TranslationPreferences | undefined {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return undefined;
  const candidate = patch as Record<string, unknown>;
  const allowedKeys = new Set([
    'sourceLanguage',
    'targetLanguage',
    'mode',
    'primaryDomain',
    'tags',
    'modelProfileId',
  ]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) return undefined;

  if (
    candidate.sourceLanguage !== undefined &&
    (typeof candidate.sourceLanguage !== 'string' ||
      !sourceLanguageIds.has(candidate.sourceLanguage))
  )
    return undefined;
  if (
    candidate.targetLanguage !== undefined &&
    (typeof candidate.targetLanguage !== 'string' ||
      !targetLanguageIds.has(candidate.targetLanguage))
  )
    return undefined;
  if (
    candidate.mode !== undefined &&
    (typeof candidate.mode !== 'string' || !modes.has(candidate.mode))
  )
    return undefined;
  if (
    candidate.primaryDomain !== undefined &&
    candidate.primaryDomain !== null &&
    (typeof candidate.primaryDomain !== 'string' ||
      !(topLevelDomains as readonly string[]).includes(candidate.primaryDomain))
  )
    return undefined;
  if (
    candidate.modelProfileId !== undefined &&
    (typeof candidate.modelProfileId !== 'string' || !modelProfileIds.has(candidate.modelProfileId))
  )
    return undefined;
  if (candidate.tags !== undefined) {
    if (
      !Array.isArray(candidate.tags) ||
      candidate.tags.length > 16 ||
      candidate.tags.some(
        (tag) => typeof tag !== 'string' || tag.trim().length === 0 || tag.trim().length > 64,
      )
    )
      return undefined;
  }

  const next = { ...current, ...(candidate as TranslationPreferencePatch) };
  next.tags = [...new Set(next.tags.map((tag) => tag.trim()))];
  return next;
}

export function parseStoredPreferences(value: unknown): TranslationPreferences {
  return (
    applyPreferencePatch(defaultTranslationPreferences, value) ?? {
      ...defaultTranslationPreferences,
      tags: [...defaultTranslationPreferences.tags],
    }
  );
}

export function translationSettingsKey(
  preferences: TranslationPreferences,
  effectiveDomainId: string | undefined,
  effectiveTags: readonly string[],
): string {
  return JSON.stringify({
    sourceLanguage: preferences.sourceLanguage,
    targetLanguage: preferences.targetLanguage,
    mode: preferences.mode,
    domainId: effectiveDomainId ?? null,
    tags: [...new Set(effectiveTags.map((tag) => tag.trim()))].sort((a, b) => a.localeCompare(b)),
    modelProfileId: preferences.modelProfileId,
  });
}
