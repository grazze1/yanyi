export interface RouteStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Translation routes contain page URLs, profile terms and completed translations.
 * Keep them only for the current browser session while still surviving MV3 worker
 * suspension. Any route written by the legacy local-storage implementation is
 * deliberately discarded rather than migrated.
 */
export async function persistEphemeralRoute<T>(
  session: RouteStorageArea,
  local: Pick<RouteStorageArea, 'remove'>,
  key: string,
  value: T | undefined,
): Promise<void> {
  await local.remove(key);
  if (value === undefined) await session.remove(key);
  else await session.set({ [key]: value });
}

export async function loadEphemeralRoute(
  session: Pick<RouteStorageArea, 'get'>,
  local: Pick<RouteStorageArea, 'remove'>,
  key: string,
): Promise<unknown> {
  await local.remove(key);
  const stored = await session.get(key);
  return stored[key];
}
