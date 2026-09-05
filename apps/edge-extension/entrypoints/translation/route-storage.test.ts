import { describe, expect, it, vi } from 'vitest';
import { loadEphemeralRoute, persistEphemeralRoute, type RouteStorageArea } from './route-storage';

function storage(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const area: RouteStorageArea = {
    get: vi.fn((key) => Promise.resolve({ [key]: values.get(key) })),
    set: vi.fn((items) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
      return Promise.resolve();
    }),
    remove: vi.fn((key) => {
      values.delete(key);
      return Promise.resolve();
    }),
  };
  return { area, values };
}

describe('ephemeral translation route storage', () => {
  it('persists sensitive route state in session and clears a legacy local copy', async () => {
    const session = storage();
    const local = storage({ route: { completedByHash: { private: '译文' } } });
    const route = { pageUrl: 'https://example.com/private', completedByHash: { hash: '译文' } };

    await persistEphemeralRoute(session.area, local.area, 'route', route);

    expect(session.values.get('route')).toEqual(route);
    expect(local.values.has('route')).toBe(false);
  });

  it('loads only the session copy and never migrates legacy local page content', async () => {
    const sessionRoute = { pageUrl: 'https://session.example/' };
    const session = storage({ route: sessionRoute });
    const local = storage({ route: { pageUrl: 'https://legacy.example/secret' } });

    await expect(loadEphemeralRoute(session.area, local.area, 'route')).resolves.toEqual(
      sessionRoute,
    );
    expect(local.values.has('route')).toBe(false);
  });

  it('removes both stores when the route ends', async () => {
    const session = storage({ route: { pageUrl: 'https://session.example/' } });
    const local = storage({ route: { pageUrl: 'https://legacy.example/' } });

    await persistEphemeralRoute(session.area, local.area, 'route', undefined);

    expect(session.values.has('route')).toBe(false);
    expect(local.values.has('route')).toBe(false);
  });
});
