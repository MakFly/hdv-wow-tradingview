/**
 * Best-effort item / realm name resolution against the local dashboard proxy
 * (`:8788`). The `.data/*.json` history files only carry numeric itemIds — human
 * names need the running backend. Every request is bounded by a short timeout;
 * any failure degrades gracefully to `#<itemId>` / `realm-<id>` so the analysis
 * still completes when the server is down.
 */

const TIMEOUT_MS = 1500;
const CONCURRENCY = 6;

async function getJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Probe `/api/health` — true when the proxy is reachable and reports ok. */
export async function apiUp(apiBase: string): Promise<boolean> {
  const j = await getJson<{ ok?: boolean }>(`${apiBase}/api/health`);
  return j?.ok === true;
}

/**
 * Resolve item ids to names. Returns a map id → name; any id that fails to
 * resolve falls back to `#<id>`. `apiAvailable` is false when the health probe
 * failed (in that case every name is the `#<id>` fallback).
 */
export async function resolveItemNames(
  apiBase: string,
  region: string,
  ids: number[]
): Promise<{ names: Map<number, string>; apiAvailable: boolean }> {
  const names = new Map<number, string>();
  if (ids.length === 0) return { names, apiAvailable: false };

  if (!(await apiUp(apiBase))) {
    for (const id of ids) names.set(id, `#${id}`);
    return { names, apiAvailable: false };
  }

  // small concurrency — mirrors the lazy per-item lookup the dashboard UI does
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      const j = await getJson<{ name?: string }>(`${apiBase}/api/item/${id}?region=${region}`);
      names.set(id, j?.name ?? `#${id}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { names, apiAvailable: true };
}

/** Resolve a connected-realm id to its display name; null on any failure. */
export async function resolveRealmName(
  apiBase: string,
  region: string,
  realmId: number
): Promise<string | null> {
  const list = await getJson<Array<{ id: number; name: string }>>(
    `${apiBase}/api/realms?region=${region}`
  );
  if (!list) return null;
  return list.find(r => r.id === realmId)?.name ?? null;
}
