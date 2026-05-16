import { useEffect, useMemo, useRef, useState } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { useTranslation } from "react-i18next";
import { Activity, Server, RefreshCcw } from "lucide-react";
import { AppNav, type AppView } from "@/components/AppNav";
import { BattleNetButton } from "@/components/BattleNetButton";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { PriceChart } from "@/components/PriceChart";
import { TokenChart } from "@/components/TokenChart";
import { TokenTicker } from "@/components/TokenTicker";
import { Watchlist, type WatchItem } from "@/components/Watchlist";
import { MarketTable } from "@/components/MarketTable";
import { MarketStats } from "@/components/MarketStats";
import { MoversCard } from "@/components/MoversCard";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { RealmCombobox } from "@/components/RealmCombobox";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";
import { ListSkeleton, TableSkeleton, ChartSkeleton, StatsSkeleton } from "@/components/Skeletons";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useAsync, useEventStream, useNow } from "@/lib/hooks";
import {
  api,
  fmtGoldShort,
  QUALITY_COLOR,
  summarizeTokens,
  type AhSnapshot,
  type AhSnapshotRow,
  type Region,
} from "@/lib/api";
import { normalizeLang } from "@/lib/i18n";

type Tf = "5m" | "15m" | "1h" | "4h" | "1d";
const TFS: Tf[] = ["5m", "15m", "1h", "4h", "1d"];

// Default panel sizes (percent) for the resizable dashboard layout. Shared by the
// `defaultSize` props and the double-click-to-reset handlers so they can't drift.
// COLs: Watchlist / PriceChart / right stack — derived from the old 260px/1fr/320px.
// ROWs: top region / MarketTable — derived from the old 1fr / minmax(200px,36%).
const COL_LAYOUT = [22, 51, 27];
const ROW_LAYOUT = [64, 36];

function dedupeByItemId(rows: AhSnapshotRow[], preferLatest = true): AhSnapshotRow[] {
  const seen = new Map<number, AhSnapshotRow>();
  for (const row of rows) {
    const prior = seen.get(row.itemId);
    if (!prior) {
      seen.set(row.itemId, row);
      continue;
    }
    if (preferLatest && row.t >= prior.t) {
      seen.set(row.itemId, row);
    }
  }
  return [...seen.values()];
}

// The watchlist is the set of items the user chose to track. It is global (the
// same in every region — only prices differ) and fully dynamic: no hard-coded
// seed list. It starts empty and is filled from the live AH (search box, the
// ★ in the market table, or top movers), then persisted to localStorage.
function loadWatch(): WatchItem[] {
  try {
    const j = localStorage.getItem("watch");
    if (j) return JSON.parse(j);
    // migrate legacy per-region lists (`watch:us`, `watch:eu`, …) into one
    // global list — union by id so no previously tracked item is lost
    const merged = new Map<number, WatchItem>();
    for (const r of ["us", "eu", "kr", "tw"]) {
      const legacy = localStorage.getItem(`watch:${r}`);
      if (legacy) for (const w of JSON.parse(legacy) as WatchItem[]) merged.set(w.id, w);
    }
    if (merged.size) {
      const list = [...merged.values()];
      localStorage.setItem("watch", JSON.stringify(list));
      return list;
    }
  } catch {
    /* ignore */
  }
  return [];
}

// ----- persisted UI state, so a page refresh keeps region / realm / selection -----
const REGION_SET = new Set<Region>(["us", "eu", "kr", "tw"]);
function parseIntParam(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}
function loadRegionFromUrl(): Region {
  try {
    const q = new URLSearchParams(window.location.search);
    const r = q.get("region");
    if (r && REGION_SET.has(r as Region)) return r as Region;
  } catch {
    /* ignore */
  }
  return loadRegion();
}
function loadCrIdFromUrl(region: Region): number | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const n = parseIntParam(q.get("cr") ?? q.get("crId") ?? q.get("realm"));
    if (n !== null) return n;
  } catch {
    /* ignore */
  }
  return loadCrId(region);
}
function loadRegion(): Region {
  const r = localStorage.getItem("region");
  return r && REGION_SET.has(r as Region) ? (r as Region) : "us";
}
function loadCrId(region: Region): number | null {
  const v = localStorage.getItem(`crId:${region}`);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
function loadSelected(): { id: number; name: string } | null {
  try {
    const v = localStorage.getItem("selected");
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
function loadSelectedFromUrl(): { id: number; name: string } | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const id = parseIntParam(q.get("item"));
    if (id == null) return loadSelected();
    const name = q.get("itemName")?.trim();
    return { id, name: name || `#${id}` };
  } catch {
    return loadSelected();
  }
}
function loadTf(): Tf {
  const v = localStorage.getItem("tf");
  return v && (TFS as string[]).includes(v) ? (v as Tf) : "1h";
}

function fmtCount(n: number | undefined): string {
  return Number.isFinite(n) ? Math.round(n as number).toLocaleString() : "—";
}

function fmtAge(now: Date, t?: number): string {
  if (!t) return "—";
  const sec = Math.max(0, Math.floor((now.getTime() - t * 1000) / 1000));
  if (sec < 60) return "<1m";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function fmtDuration(ms: number | null | undefined): string {
  if (!Number.isFinite(ms ?? NaN)) return "—";
  const sec = Math.max(0, Math.ceil((ms as number) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtLocalClock(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
    timeZoneName: "short",
  }).format(now);
}

function MarketMetric({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-[70px] font-mono">
      <div className="text-muted-foreground text-[9px] tracking-wider uppercase">{label}</div>
      <div className={`truncate text-xs ${tone}`}>{value}</div>
    </div>
  );
}

export function App() {
  const { t, i18n } = useTranslation();
  const lang = normalizeLang(i18n.language);
  const userTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const initialRegion = useMemo(() => loadRegionFromUrl(), []);
  const [region, setRegion] = useState<Region>(initialRegion);
  const [crId, setCrId] = useState<number | null>(() => loadCrIdFromUrl(initialRegion));
  const [activeView, setActiveView] = useState<AppView>("dashboard");
  const auth = useAuth();
  const [tf, setTf] = useState<Tf>(loadTf);
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(loadSelectedFromUrl);
  const [watch, setWatchState] = useState<WatchItem[]>(loadWatch);

  // the watchlist is global — it persists as-is across region/realm switches,
  // which only change the prices shown for these same items
  const setWatch = (w: WatchItem[]) => {
    setWatchState(w);
    localStorage.setItem("watch", JSON.stringify(w));
  };
  // add the item if absent, remove it if already watched — used by the ★ toggle
  const toggleWatch = (item: WatchItem) =>
    setWatch(watch.some(w => w.id === item.id) ? watch.filter(w => w.id !== item.id) : [...watch, item]);
  const watchedIds = useMemo(() => new Set(watch.map(w => w.id)), [watch]);

  // resizable dashboard layout — refs let a handle double-click reset its group
  const rowGroup = useRef<ImperativePanelGroupHandle>(null);
  const colGroup = useRef<ImperativePanelGroupHandle>(null);

  // persist UI state — survives a page refresh
  useEffect(() => {
    localStorage.setItem("region", region);
  }, [region]);
  useEffect(() => {
    if (crId != null) localStorage.setItem(`crId:${region}`, String(crId));
  }, [region, crId]);
  useEffect(() => {
    if (selected) localStorage.setItem("selected", JSON.stringify(selected));
    else localStorage.removeItem("selected");
  }, [selected]);
  useEffect(() => {
    localStorage.setItem("tf", tf);
  }, [tf]);

  // ----- the single live channel: server pushes everything over SSE -----
  const itemIds = useMemo(
    () => [...new Set([...watch.map(w => w.id), ...(selected ? [selected.id] : [])])],
    [watch, selected]
  );
  const stream = useEventStream(region, crId, itemIds);

  // ----- one-shot lookups (not live data, so plain fetches) -----
  const realms = useAsync(() => api.realms(region), [region]);
  const itemDetail = useAsync(
    () => (selected ? api.item(region, selected.id, lang) : null),
    [region, selected?.id, lang]
  );
  const selectedDisplayName = useMemo(
    () => (selected ? itemDetail.data?.name ?? selected.name : null),
    [selected, itemDetail.data?.name]
  );
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    q.set("region", region);
    if (crId != null) {
      q.set("cr", String(crId));
    } else {
      q.delete("cr");
    }
    if (selected?.id) {
      q.set("item", String(selected.id));
      q.set("itemName", selectedDisplayName || selected.name || `#${selected.id}`);
    } else {
      q.delete("item");
      q.delete("itemName");
    }
    const suffix = q.toString();
    const next = suffix ? `${window.location.pathname}?${suffix}` : window.location.pathname;
    window.history.replaceState({}, "", next);
  }, [region, crId, selected?.id, selected?.name, selectedDisplayName]);

  useEffect(() => {
    const list = realms.data;
    // only auto-pick from a realm list that actually belongs to the current region
    // (during a region switch, realms.data briefly still holds the old region's list)
    if (!list || list.length === 0 || list[0].region !== region) return;
    if (crId === null || !list.some(r => r.id === crId)) {
      const pick = list.find(r => r.population === "FULL") ?? list[0];
      const id = window.setTimeout(() => setCrId(pick.id), 0);
      return () => window.clearTimeout(id);
    }
  }, [realms.data, crId, region]);

  // ----- derive views from the stream -----
  const tokens = useMemo(() => summarizeTokens(stream.tokens), [stream.tokens]);
  const tokenSeries = stream.tokens[region] ?? [];

  // movers + watchlist work off both feeds: connected-realm gear AND region commodities
  const snapItems = useMemo(
    () => dedupeByItemId([...stream.ahRealm, ...stream.commodities], false),
    [stream.ahRealm, stream.commodities]
  );
  const snapMap = useMemo(() => new Map(snapItems.map(it => [it.itemId, it])), [snapItems]);

  // MoversCard compares the live snapshot against the previous AH regeneration.
  // The server tracks that previous full snapshot per feed — seeded from persisted
  // history, so it's available immediately, no waiting two live AH cycles.
  const prevSnap = useMemo(() => {
    const merged = dedupeByItemId([...stream.prevAhRealm, ...stream.prevCommodities], false);
    return merged.length ? merged : null;
  }, [stream.prevAhRealm, stream.prevCommodities]);

  // Determine, once per frame, where each item id exists so the selected item
  // uses the same source in all widgets (realm first, then commodities fallback).
  const itemSource = useMemo(() => {
    const map = new Map<number, "realm" | "commodities">();
    for (const it of stream.ahRealm) map.set(it.itemId, "realm");
    for (const it of stream.commodities) if (!map.has(it.itemId)) map.set(it.itemId, "commodities");
    return map;
  }, [stream.ahRealm, stream.commodities]);

  // an item lives on either side: connected-realm (gear/BoE) or region commodities
  const history: AhSnapshot[] = selected
    ? (() => {
        const source = itemSource.get(selected.id);
        if (source === "realm" && crId) {
          const realmHist = stream.ah[`${region}:${crId}:${selected.id}`];
          if (realmHist && realmHist.length) return realmHist;
        }
        if (source === "commodities" || source === undefined) {
          const comHist = stream.ah[`${region}:c:${selected.id}`];
          if (comHist && comHist.length) return comHist;
        }
        const fallbackRealm = crId ? stream.ah[`${region}:${crId}:${selected.id}`] : undefined;
        return fallbackRealm ?? stream.ah[`${region}:c:${selected.id}`] ?? [];
      })()
    : [];

  useEffect(() => {
    if (!selected && watch[0]) {
      const id = window.setTimeout(() => setSelected({ id: watch[0].id, name: watch[0].name }), 0);
      return () => window.clearTimeout(id);
    }
  }, [watch, selected]);

  const now = useNow();
  const localClock = useMemo(() => fmtLocalClock(now, userTimeZone), [now, userTimeZone]);
  const live = stream.authConfigured;
  // `booting` = the SSE stream hasn't delivered its first snapshot yet (page just
  // loaded / refreshed, or mid-reconnect). Panels show skeletons instead of empty
  // states until real data arrives.
  const booting = !stream.connected;
  const realm = realms.data?.find(r => r.id === crId);

  const last = history.at(-1);
  const open24 = history.find(h => h.t >= (last?.t ?? 0) - 86400)?.min ?? last?.min;
  const ch24 = last && open24 ? ((last.min - open24) / open24) * 100 : 0;
  const delta24 = last && open24 ? last.min - open24 : 0;
  const spread = last ? Math.max(0, last.median - last.min) : 0;
  const spreadPct = last && last.min > 0 ? (spread / last.min) * 100 : 0;
  const chTone = ch24 >= 0 ? "text-emerald-400" : "text-red-400";
  const marketTitle = t("cards.market", { realm: realm?.name ?? region.toUpperCase() });
  const ahFeeds = [stream.ahRefresh?.realm, stream.ahRefresh?.commodities].filter(Boolean);
  const lastAhCheckAt = ahFeeds.length ? Math.max(...ahFeeds.map(f => f?.fetchedAt ?? 0)) : null;
  const ahNextCheckIn = stream.ahRefresh?.nextAhPollAt ? stream.ahRefresh.nextAhPollAt - now.getTime() : null;

  const conn: { label: string; cls: string; variant: "default" | "destructive" } = !live
    ? { label: t("app.conn.oauthMissing"), cls: "", variant: "destructive" }
    : stream.connected
      ? { label: t("app.conn.live"), cls: "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20", variant: "default" }
      : { label: t("app.conn.reconnecting"), cls: "bg-amber-500/15 text-amber-400 hover:bg-amber-500/20", variant: "default" };

  useEffect(() => {
    document.title = selectedDisplayName ? `${selectedDisplayName} · ${marketTitle}` : marketTitle;
  }, [marketTitle, selectedDisplayName]);

  return (
    <div className="bg-background text-foreground flex h-screen flex-col font-sans">
      <header className="border-b">
        <div className="flex items-center gap-4 px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="text-2xl text-amber-400">⚔</div>
            <div>
              <div className="text-sm font-bold tracking-[0.2em]">AZEROTH TERMINAL</div>
              <div className="text-muted-foreground text-[10px] tracking-widest uppercase">
                {t("app.subtitle")}
              </div>
            </div>
          </div>
          <Separator orientation="vertical" className="!h-8" />
          <AppNav
            active={activeView}
            onChange={setActiveView}
            disabled={auth.status?.linked ? [] : ["profile", "opportunities"]}
          />
          <div className="ml-auto flex items-center gap-3">
            <TokenTicker data={tokens} />
            <Badge
              variant={conn.variant}
              className={conn.cls}
            >
              <Activity className={`mr-1 h-3 w-3 ${live && stream.connected ? "animate-pulse" : ""}`} />
              {conn.label}
            </Badge>
            <div className="text-muted-foreground hidden flex-col items-end font-mono text-[10px] leading-tight md:flex">
              <span>{localClock}</span>
              <span title={userTimeZone}>{userTimeZone}</span>
            </div>
            <div className="text-muted-foreground hidden flex-col items-end font-mono text-[10px] leading-tight lg:flex">
              <span>{t("app.ahNextCheck", { remaining: fmtDuration(ahNextCheckIn) })}</span>
              <span>{t("app.ahLastCheck", { age: lastAhCheckAt ? fmtDuration(now.getTime() - lastAhCheckAt) : "—" })}</span>
            </div>
            <BattleNetButton status={auth.status} onStatusChange={auth.refresh} />
            <LanguageSwitcher />
          </div>
        </div>
        <div className="bg-card/40 flex items-center gap-3 border-t px-4 py-2 text-xs">
          <Server className="text-muted-foreground h-3.5 w-3.5" />
          <Select
            value={region}
            onValueChange={v => {
              const r = v as Region;
              setRegion(r);
              // a realm id is region-scoped — restore the one last used for this region
              // (or null, which lets the auto-pick choose one)
              setCrId(loadCrId(r));
            }}
          >
            <SelectTrigger className="h-7 w-[90px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="us">US</SelectItem>
              <SelectItem value="eu">EU</SelectItem>
              <SelectItem value="kr">KR</SelectItem>
              <SelectItem value="tw">TW</SelectItem>
            </SelectContent>
          </Select>
          <RealmCombobox realms={realms.data} value={crId} onChange={setCrId} />
          {realm && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {t("app.realmBadge", { id: realm.id, status: realm.status, population: realm.population })}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-7"
            onClick={() => {
              realms.refresh();
              itemDetail.refresh();
            }}
          >
            <RefreshCcw className="mr-1 h-3 w-3" /> {t("app.reloadRealms")}
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 p-2">
       {activeView === "dashboard" ? (
       <ResizablePanelGroup ref={rowGroup} direction="vertical" autoSaveId="azeroth:layout:rows" className="gap-2">
        {/* ---- TOP REGION: the 3 resizable columns ---- */}
        <ResizablePanel defaultSize={ROW_LAYOUT[0]} minSize={35}>
         <ResizablePanelGroup ref={colGroup} direction="horizontal" autoSaveId="azeroth:layout:cols" className="gap-2">
          <ResizablePanel defaultSize={COL_LAYOUT[0]} minSize={14}>
        <Card className="h-full min-h-0 gap-0 overflow-hidden p-0">
          <CardHeader className="border-b px-3 py-2">
            <CardTitle className="text-muted-foreground text-[11px] tracking-widest uppercase">{t("cards.watchlist")}</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0">
            {booting ? (
              <ListSkeleton rows={7} />
            ) : (
              <Watchlist
                region={region}
                snapshot={snapMap}
                watch={watch}
                setWatch={setWatch}
                selected={selected?.id ?? null}
                onSelect={(id, name) => setSelected({ id, name })}
              />
            )}
          </CardContent>
        </Card>
          </ResizablePanel>

          <ResizableHandle withHandle onDoubleClick={() => colGroup.current?.setLayout(COL_LAYOUT)} />

          <ResizablePanel defaultSize={COL_LAYOUT[1]} minSize={30}>
        <Card className="h-full min-h-0 gap-0 overflow-hidden p-0">
          <CardHeader className="bg-card/50 border-b px-4 py-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-[180px] flex-1">
                <CardTitle
                  className="truncate text-lg"
                  style={{ color: QUALITY_COLOR[itemDetail.data?.quality?.type ?? "COMMON"] }}
                >
                  {/* prefer the freshly fetched (localized) name; selected.name is the at-click fallback */}
                  {itemDetail.data?.name ?? selectedDisplayName ?? "—"}
                </CardTitle>
                <div className="text-muted-foreground font-mono text-[10px]">
                  {selected ? `#${selected.id}` : ""}
                  {itemDetail.data?.item_subclass?.name ? ` · ${itemDetail.data.item_subclass.name}` : ""}
                  {realm ? ` · ${realm.name} (${region.toUpperCase()})` : ""}
                </div>
              </div>
              <div className="min-w-[132px] font-mono">
                <div className="text-muted-foreground text-[9px] tracking-wider uppercase">{t("chart.priceMin")}</div>
                <div className="text-2xl leading-none font-bold text-amber-400">{last ? fmtGoldShort(last.min) : "—"}</div>
                <div className={`mt-0.5 text-[10px] ${chTone}`}>
                  {last && open24
                    ? `${delta24 >= 0 ? "+" : ""}${delta24.toFixed(2)}g · ${ch24 >= 0 ? "+" : ""}${ch24.toFixed(2)}%`
                    : "—"}
                </div>
              </div>
              <div className="grid min-w-[260px] flex-1 grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-5">
                <MarketMetric label={t("chart.median")} value={last ? fmtGoldShort(last.median) : "—"} />
                <MarketMetric
                  label={t("chart.spread")}
                  value={last ? `${fmtGoldShort(spread)} · ${spreadPct.toFixed(1)}%` : "—"}
                />
                <MarketMetric label={t("chart.stock")} value={fmtCount(last?.total)} />
                <MarketMetric label={t("chart.listings")} value={fmtCount(last?.listings)} />
                <MarketMetric label={t("chart.lastScan")} value={fmtAge(now, last?.t)} />
              </div>
              <div className="ml-auto flex shrink-0 gap-1">
                {TFS.map(t => (
                  <Button
                    key={t}
                    variant={tf === t ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2 font-mono text-[11px]"
                    onClick={() => setTf(t)}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0">
            <div className="relative h-full w-full">
              {booting && <ChartSkeleton />}
              {!booting && !selected && (
                <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
                  {t("app.pickItem")}
                </div>
              )}
              {!booting && selected && history.length > 0 && (
                <ChartErrorBoundary resetKey={`${selected.id}:${tf}:${history.length}`}>
                  <PriceChart points={history} tf={tf} />
                </ChartErrorBoundary>
              )}
              {!booting && selected && history.length === 0 && (
                <div className="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-1 text-sm">
                  <div>{t("app.noSnapshots")}</div>
                  <div className="text-[11px]">
                    {t("app.noSnapshotsHint", { min: Math.round(stream.pollAhSec / 60) })}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
          </ResizablePanel>

          <ResizableHandle withHandle onDoubleClick={() => colGroup.current?.setLayout(COL_LAYOUT)} />

          <ResizablePanel defaultSize={COL_LAYOUT[2]} minSize={18}>
        <div className="grid h-full min-h-0 grid-rows-[auto_1fr_1fr] gap-2">
          <Card className="gap-0 p-0">
            <CardHeader className="border-b px-3 py-2">
              <CardTitle className="text-muted-foreground text-[11px] tracking-widest uppercase">
                {t("cards.marketStats")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {booting ? <StatsSkeleton /> : <MarketStats history={history} item={itemDetail.data} />}
            </CardContent>
          </Card>

          <Card className="min-h-0 gap-0 overflow-hidden p-0">
            <CardHeader className="border-b px-3 py-2">
              <CardTitle className="text-muted-foreground text-[11px] tracking-widest uppercase">
                {t("cards.topMovers")}
              </CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 p-0">
              {booting ? (
                <ListSkeleton rows={8} />
              ) : (
                <MoversCard
                  region={region}
                  snapshot={snapItems.length ? snapItems : null}
                  prevSnapshot={prevSnap}
                  onPick={(id, name) => {
                    if (!watch.some(w => w.id === id)) setWatch([...watch, { id, name, quality: "COMMON" }]);
                    setSelected({ id, name });
                  }}
                />
              )}
            </CardContent>
          </Card>

          <Card className="min-h-0 gap-0 overflow-hidden p-0">
            <CardHeader className="border-b px-3 py-2">
              <CardTitle className="text-muted-foreground text-[11px] tracking-widest uppercase">
                {t("cards.wowToken", { region: region.toUpperCase() })}
              </CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 p-2">
              {booting ? (
                <ChartSkeleton />
              ) : tokenSeries.length > 0 ? (
                <ChartErrorBoundary resetKey={`${region}:${tokenSeries.length}`}>
                  <TokenChart points={tokenSeries} />
                </ChartErrorBoundary>
              ) : (
                <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
                  {t("app.waitingToken")}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
          </ResizablePanel>
         </ResizablePanelGroup>
        </ResizablePanel>

        <ResizableHandle withHandle onDoubleClick={() => rowGroup.current?.setLayout(ROW_LAYOUT)} />

        {/* ---- BOTTOM ROW: full-width MarketTable ---- */}
        <ResizablePanel defaultSize={ROW_LAYOUT[1]} minSize={15}>
        <Card className="h-full min-h-0 gap-0 overflow-hidden p-0">
          <CardHeader className="border-b px-3 py-2">
            <CardTitle className="text-muted-foreground text-[11px] tracking-widest uppercase">
              {marketTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0">
            {booting ? (
              <TableSkeleton rows={12} />
            ) : (
              <MarketTable
                region={region}
                items={snapItems}
                selected={selected?.id ?? null}
                onSelect={(id, name) => setSelected({ id, name })}
                watchedIds={watchedIds}
                onToggleWatch={toggleWatch}
              />
            )}
          </CardContent>
        </Card>
        </ResizablePanel>
       </ResizablePanelGroup>
       ) : activeView === "profile" ? (
         <div className="flex h-full items-center justify-center">
           <Card className="w-full max-w-2xl">
             <CardHeader>
               <CardTitle className="flex items-center gap-2">
                 Profil
                 {auth.status?.battletag && (
                   <Badge variant="outline">{auth.status.battletag}</Badge>
                 )}
               </CardTitle>
             </CardHeader>
             <CardContent>
               <p className="text-muted-foreground text-sm">
                 Personnages, professions et recettes connues.
                 <br />Bientôt disponible.
               </p>
             </CardContent>
           </Card>
         </div>
       ) : activeView === "opportunities" ? (
         <div className="flex h-full items-center justify-center">
           <Card className="w-full max-w-2xl">
             <CardHeader>
               <CardTitle>Opportunités</CardTitle>
             </CardHeader>
             <CardContent>
               <p className="text-muted-foreground text-sm">
                 Crafts rentables, flips AH, alertes de seuil.
                 <br />Bientôt disponible.
               </p>
             </CardContent>
           </Card>
         </div>
       ) : (
         <div className="flex h-full items-center justify-center">
           <Card className="w-full max-w-2xl">
             <CardHeader>
               <CardTitle>Encyclopédie</CardTitle>
             </CardHeader>
             <CardContent>
               <p className="text-muted-foreground text-sm">
                 Recherche dans la base de connaissances WoW (classes, talents, donjons, guides FR).
                 <br />Bientôt disponible.
               </p>
             </CardContent>
           </Card>
         </div>
       )}
      </main>

      <footer className="text-muted-foreground flex items-center justify-between border-t px-4 py-1 font-mono text-[10px]">
        <span>
          {t("app.footer.source", {
            tokenSec: stream.pollTokenSec,
            ahMin: Math.round(stream.pollAhSec / 60),
          })}
        </span>
        <span className={live && stream.connected ? "text-emerald-400" : "text-amber-400"}>
          {!live
            ? t("app.footer.authMissing")
            : stream.connected
              ? t("app.footer.streamConnected")
              : t("app.footer.streamReconnecting")}
        </span>
      </footer>
    </div>
  );
}

export default App;
