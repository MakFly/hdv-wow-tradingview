/** Typed client for the local Blizzard proxy.
 *  Live data arrives over SSE (see useEventStream); only realm/item lookups
 *  are one-shot HTTP requests. */

export type Region = "us" | "eu" | "kr" | "tw";

export type TokenPoint = { t: number; price: number }; // t in ms
export type TokenSummary = Record<Region, { current: TokenPoint | null; ch24h: number | null }>;

export type Realm = {
  id: number;
  name: string;
  slug: string;
  status: string;
  population: string;
  region: Region;
};

export type ItemSearchResult = {
  id: number;
  name: string;
  quality: string; // POOR, COMMON, UNCOMMON, RARE, EPIC, LEGENDARY, ARTIFACT, HEIRLOOM
};

export type ItemDetail = {
  id: number;
  name: string;
  quality: { type: string; name: string };
  item_class?: { name: string };
  item_subclass?: { name: string };
  purchase_price?: number;
  sell_price?: number;
  icon?: string;
};

export type AhSnapshot = {
  t: number; // seconds
  min: number;
  median: number;
  total: number;
  listings: number;
};

export type AhSnapshotRow = AhSnapshot & { itemId: number };
export type AhRefreshFeed = { key: string; fetchedAt: number | null; lastModified: string | null };
export type AhRefreshStatus = {
  serverNow: number;
  nextAhPollAt: number | null;
  pollAhSec: number;
  staleMs: number;
  realm: AhRefreshFeed | null;
  commodities: AhRefreshFeed;
};

// ----- SSE event payloads (mirror server/index.ts) -----

export type StreamSnapshot = {
  authConfigured: boolean;
  time: number;
  pollTokenSec: number;
  pollAhSec: number;
  ahRefresh: AhRefreshStatus;
  tokens: Record<Region, TokenPoint[]>;
  // ah key: `${region}:${crId}:${itemId}` (gear/BoE) or `${region}:c:${itemId}` (commodity)
  ah: Record<string, AhSnapshot[]>;
  ahRealm: AhSnapshotRow[]; // connected-realm items (gear / BoE)
  prevAhRealm: AhSnapshotRow[]; // the AH regeneration before `ahRealm` (movers baseline)
  commodities: AhSnapshotRow[]; // region-wide commodities (ore, herbs, leather…)
  prevCommodities: AhSnapshotRow[]; // the regeneration before `commodities` (movers baseline)
};
export type StreamTokenEvent = { region: Region; point: TokenPoint };
export type StreamAhEvent = { key: string; snapshot: AhSnapshot };
export type StreamAhRealmEvent = { region: Region; crId: number; items: AhSnapshotRow[]; prev: AhSnapshotRow[] };
export type StreamCommoditiesEvent = { region: Region; items: AhSnapshotRow[]; prev: AhSnapshotRow[] };
export type StreamAhRefreshEvent = AhRefreshStatus;

// ----- one-shot HTTP lookups -----

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      msg = (await r.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return r.json();
}

export type SubscribeBody = {
  clientId: string;
  region: Region;
  crId: number | null;
  items: number[];
};

export const api = {
  health: () => jget<{ ok: boolean; authConfigured: boolean; clients: number }>("/api/health"),
  realms: (region: Region) => jget<Realm[]>(`/api/realms?region=${region}`),
  // `lang` is the UI language ("en" | "fr"); the proxy maps it to a Blizzard
  // locale valid for the region (e.g. fr → fr_FR on EU, en_US elsewhere).
  search: (region: Region, q: string, lang = "en") =>
    jget<{ results: ItemSearchResult[] }>(
      `/api/items/search?region=${region}&q=${encodeURIComponent(q)}&lang=${lang}`
    ),
  item: (region: Region, id: number, lang = "en") =>
    jget<ItemDetail>(`/api/item/${id}?region=${region}&lang=${lang}`),
  /** One-shot command (NOT a poll): tell the server what this client is now watching.
   *  The server pushes a fresh `snapshot` event down the already-open SSE stream. */
  subscribe: (body: SubscribeBody) =>
    fetch("/api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
};

/** EventSource URL for the live stream — carries only the stable client id.
 *  The connection is opened once and never recreated; subscription changes go
 *  through `api.subscribe`, not through a new URL. */
export function streamUrl(clientId: string): string {
  return `/api/stream?clientId=${encodeURIComponent(clientId)}`;
}

/** Derive the per-region ticker summary from streamed token histories. */
export function summarizeTokens(tokens: Record<Region, TokenPoint[]>): TokenSummary {
  const out = {} as TokenSummary;
  for (const r of ["us", "eu", "kr", "tw"] as Region[]) {
    const a = tokens[r] ?? [];
    const cur = a[a.length - 1] ?? null;
    let ch: number | null = null;
    if (cur) {
      const cutoff = cur.t - 86400_000; // t is ms
      const past = a.find(x => x.t >= cutoff) ?? a[0];
      ch = past && past !== cur ? ((cur.price - past.price) / past.price) * 100 : 0;
    }
    out[r] = { current: cur, ch24h: ch };
  }
  return out;
}

export const QUALITY_COLOR: Record<string, string> = {
  POOR: "#9d9d9d",
  COMMON: "#ffffff",
  UNCOMMON: "#1eff00",
  RARE: "#0070dd",
  EPIC: "#a335ee",
  LEGENDARY: "#ff8000",
  ARTIFACT: "#e6cc80",
  HEIRLOOM: "#00ccff",
};

export function fmtGold(copper: number): string {
  // copper -> "12g 34s 56c" or compact
  if (!isFinite(copper)) return "—";
  const g = Math.floor(copper / 10000);
  const s = Math.floor((copper % 10000) / 100);
  const c = Math.floor(copper % 100);
  if (g >= 10000) {
    const k = Math.round((g / 1000) * 10) / 10;
    const fmt = Math.abs(k - Math.round(k)) < 1e-9 ? Math.round(k).toString() : k.toFixed(1);
    return `${fmt}k gold`;
  }
  if (g > 0) return `${g.toLocaleString()}g ${s}s`;
  if (s > 0) return `${s}s ${c}c`;
  return `${c}c`;
}

export function fmtGoldShort(gold: number): string {
  if (!isFinite(gold)) return "—";
  const abs = Math.abs(gold);
  if (abs >= 1_000) {
    const k = Math.round((gold / 1_000) * 10) / 10;
    const fmt = Math.abs(k - Math.round(k)) < 1e-6 ? Math.round(k).toString() : k.toFixed(1);
    return `${fmt}k gold`;
  }
  if (gold >= 10) return `${gold.toFixed(0)} gold`;
  return `${gold.toFixed(2)} gold`;
}
