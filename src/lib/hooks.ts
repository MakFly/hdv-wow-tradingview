import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  streamUrl,
  type AhSnapshot,
  type AhSnapshotRow,
  type AhRefreshStatus,
  type Region,
  type StreamAhEvent,
  type StreamAhRefreshEvent,
  type StreamAhRealmEvent,
  type StreamCommoditiesEvent,
  type StreamSnapshot,
  type StreamTokenEvent,
  type TokenPoint,
} from "./api";

/** One-shot async fetch with manual refresh — for realm / item lookups that
 *  are NOT live data (no polling). `fn` may return null to mean "nothing to load". */
export function useAsync<T>(
  fn: () => Promise<T> | null,
  deps: unknown[]
): { data: T | null; error: string | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const run = () => {
    const id = ++seq.current;
    const pr = fnRef.current();
    if (!pr) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    pr
      .then(v => {
        if (id === seq.current) {
          setData(v);
          setError(null);
        }
      })
      .catch(e => {
        if (id === seq.current) setError((e as Error).message);
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps);
  return { data, error, loading, refresh: run };
}

export type StreamState = {
  connected: boolean;
  authConfigured: boolean;
  tokens: Record<Region, TokenPoint[]>;
  // ah key: `${region}:${crId}:${itemId}` (gear/BoE) or `${region}:c:${itemId}` (commodity)
  ah: Record<string, AhSnapshot[]>;
  ahRealm: AhSnapshotRow[]; // connected-realm items
  prevAhRealm: AhSnapshotRow[]; // the AH regeneration before `ahRealm` (movers baseline)
  commodities: AhSnapshotRow[]; // region-wide commodities
  prevCommodities: AhSnapshotRow[]; // the regeneration before `commodities` (movers baseline)
  pollTokenSec: number;
  pollAhSec: number;
  ahRefresh: AhRefreshStatus | null;
};

const EMPTY_TOKENS: Record<Region, TokenPoint[]> = { us: [], eu: [], kr: [], tw: [] };

/**
 * The single live data channel.
 *
 * The EventSource is opened EXACTLY ONCE and lives for the whole component
 * lifetime — it is never torn down/recreated for a UI change, so the screen
 * never resets and accumulated stream state is never lost. When the user
 * changes region / realm / watchlist, a debounced one-shot `api.subscribe`
 * command tells the server, which pushes a fresh `snapshot` event back down
 * the SAME open stream. No polling anywhere on the client.
 */
export function useEventStream(region: Region, crId: number | null, itemIds: number[]): StreamState {
  const itemsKey = [...new Set(itemIds)].sort((a, b) => a - b).join(",");
  // stable id for this browser tab — survives StrictMode remounts, EventSource
  // auto-reconnects, and even a page reload within the same tab session
  const [clientId] = useState(() => {
    const KEY = "azeroth-client-id";
    try {
      const existing = sessionStorage.getItem(KEY);
      if (existing) return existing;
      const id = crypto.randomUUID();
      sessionStorage.setItem(KEY, id);
      return id;
    } catch {
      return crypto.randomUUID();
    }
  });

  const [state, setState] = useState<StreamState>({
    connected: false,
    authConfigured: false,
    tokens: EMPTY_TOKENS,
    ah: {},
    ahRealm: [],
    prevAhRealm: [],
    commodities: [],
    prevCommodities: [],
    pollTokenSec: 300,
    pollAhSec: 900,
    ahRefresh: null,
  });

  // current subscription, mirrored into a ref so the (once-created) `open`
  // handler can resend it after an auto-reconnect
  const subRef = useRef<{ region: Region; crId: number | null; items: number[] }>({ region, crId, items: [] });
  useEffect(() => {
    subRef.current = { region, crId, items: itemsKey ? itemsKey.split(",").map(Number) : [] };
  }, [region, crId, itemsKey]);

  // send a subscribe command, but skip it if it's byte-identical to the last one
  // we sent — kills duplicate commands without suppressing real changes
  const lastSentRef = useRef("");
  const pushSubscribe = useCallback(
    (sub: { region: Region; crId: number | null; items: number[] }) => {
      const body = { clientId, region: sub.region, crId: sub.crId, items: sub.items };
      const payload = JSON.stringify(body);
      if (payload === lastSentRef.current) return;
      lastSentRef.current = payload;
      api.subscribe(body).catch(() => {});
    },
    [clientId]
  );

  // 1) the ONE persistent connection — opened once (clientId is stable)
  useEffect(() => {
    const es = new EventSource(streamUrl(clientId));

    es.addEventListener("open", () => {
      setState(s => ({ ...s, connected: true }));
      // (re)connected — force a fresh subscribe so the server has our state
      lastSentRef.current = "";
      pushSubscribe(subRef.current);
    });
    es.addEventListener("error", () => setState(s => ({ ...s, connected: false })));

    es.addEventListener("snapshot", e => {
      const d = JSON.parse((e as MessageEvent).data) as StreamSnapshot;
      setState({
        connected: true,
        authConfigured: d.authConfigured,
        tokens: { ...EMPTY_TOKENS, ...d.tokens },
        ah: d.ah ?? {},
        ahRealm: d.ahRealm ?? [],
        prevAhRealm: d.prevAhRealm ?? [],
        commodities: d.commodities ?? [],
        prevCommodities: d.prevCommodities ?? [],
        pollTokenSec: d.pollTokenSec,
        pollAhSec: d.pollAhSec,
        ahRefresh: d.ahRefresh ?? null,
      });
    });

    es.addEventListener("token", e => {
      const { region: r, point } = JSON.parse((e as MessageEvent).data) as StreamTokenEvent;
      setState(s => {
        const arr = s.tokens[r] ?? [];
        if (arr.length && arr[arr.length - 1].t === point.t) return s;
        return { ...s, tokens: { ...s.tokens, [r]: [...arr, point] } };
      });
    });

    es.addEventListener("ah", e => {
      const { key, snapshot } = JSON.parse((e as MessageEvent).data) as StreamAhEvent;
      setState(s => {
        const arr = s.ah[key] ?? [];
        if (arr.length && arr[arr.length - 1].t === snapshot.t) return s;
        return { ...s, ah: { ...s.ah, [key]: [...arr, snapshot] } };
      });
    });

    es.addEventListener("ah-realm", e => {
      const d = JSON.parse((e as MessageEvent).data) as StreamAhRealmEvent;
      setState(s => ({ ...s, ahRealm: d.items, prevAhRealm: d.prev ?? s.prevAhRealm }));
    });

    es.addEventListener("commodities", e => {
      const d = JSON.parse((e as MessageEvent).data) as StreamCommoditiesEvent;
      setState(s => ({ ...s, commodities: d.items, prevCommodities: d.prev ?? s.prevCommodities }));
    });

    es.addEventListener("ah-refresh", e => {
      const d = JSON.parse((e as MessageEvent).data) as StreamAhRefreshEvent;
      setState(s => ({ ...s, ahRefresh: d, pollAhSec: d.pollAhSec }));
    });

    return () => es.close();
  }, [clientId, pushSubscribe]);

  // 2) subscription side-channel — a single debounced command per user change,
  //    NOT a poll. Never recreates the connection above.
  useEffect(() => {
    const id = setTimeout(() => {
      pushSubscribe({ region, crId, items: itemsKey ? itemsKey.split(",").map(Number) : [] });
    }, 250);
    return () => clearTimeout(id);
  }, [pushSubscribe, region, crId, itemsKey]);

  return state;
}

/**
 * Lazy item-name/quality resolver, shared by views that render raw AH rows
 * (which carry only `itemId`). `request(ids)` resolves any not-yet-seen ids via
 * the proxy's cached /api/item endpoint with bounded concurrency — callers pass
 * only the ids they actually render (e.g. the visible window of a virtual list),
 * so a 20k-item AH never triggers 20k lookups. The cache resets when the region
 * or the UI language changes, since names are locale-specific.
 */
export function useItemNames(region: Region, lang: string) {
  const [names, setNames] = useState<Record<number, { name: string; quality: string }>>({});
  const seen = useRef<Set<number>>(new Set()); // requested OR resolved — never re-fetched
  const cacheKey = `${region}:${lang}`;
  const cachedKey = useRef(cacheKey);

  const request = useCallback(
    (ids: number[]) => {
      // region/language switched — the cache holds names for a different locale, drop it
      if (cachedKey.current !== cacheKey) {
        cachedKey.current = cacheKey;
        seen.current = new Set();
        setNames({});
      }
      const need = ids.filter(id => id && !seen.current.has(id));
      if (!need.length) return;
      for (const id of need) seen.current.add(id);
      let i = 0;
      const worker = async () => {
        while (i < need.length) {
          const id = need[i++];
          try {
            const it = await api.item(region, id, lang);
            setNames(n => ({ ...n, [id]: { name: it.name, quality: it.quality?.type ?? "COMMON" } }));
          } catch {
            setNames(n => ({ ...n, [id]: { name: `#${id}`, quality: "COMMON" } }));
          }
        }
      };
      // 6 workers drain the queue — fast enough to feel instant, gentle on the proxy
      void Promise.all(Array.from({ length: 6 }, worker));
    },
    [region, lang, cacheKey]
  );

  return { names, request };
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
