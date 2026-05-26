import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useItemNames } from "@/lib/hooks";
import { normalizeLang } from "@/lib/i18n";
import type { WatchItem } from "@/components/Watchlist";
import { fmtGoldShort, QUALITY_COLOR, type AhSnapshotRow, type Region } from "@/lib/api";

type SortKey = "name" | "min" | "median" | "listings" | "total";

const ROW_H = 28; // px — fixed row height drives the virtual window math
const OVERSCAN = 12; // rows rendered above/below the viewport, hides scroll jank
const COLS = "grid-cols-[28px_1fr_96px_96px_72px_104px]";

/**
 * The whole auction house in one table — every item the proxy streamed for the
 * selected realm (`ahRealm`) plus the region commodities (`commodities`).
 *
 * It can be 10k–30k rows, so the list is virtualized: a full-height spacer sets
 * the scrollbar, and only the rows inside the viewport (+overscan) are mounted.
 * Item names aren't in the AH feed — they're resolved lazily, but only for the
 * rows currently on screen, via the shared `useItemNames` resolver.
 */
export function MarketTable({
  region,
  items,
  selected,
  onSelect,
  watchedIds,
  onToggleWatch,
}: {
  region: Region;
  items: AhSnapshotRow[];
  selected: number | null;
  onSelect: (id: number, name: string) => void;
  watchedIds: Set<number>;
  onToggleWatch: (item: WatchItem) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = normalizeLang(i18n.language);
  const { names, request } = useItemNames(region, lang);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("listings");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(360);

  // filter (by resolved name, falling back to raw id) then sort
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // Keep first-seen row per item id. Rows are delivered as realm snapshot
    // first, then commodities; this preserves the same precedence as the main
    // app's merged list.
    const deduped = new Map<number, AhSnapshotRow>();
    for (const it of items) {
      if (!deduped.has(it.itemId)) deduped.set(it.itemId, it);
    }
    const uniqueItems = [...deduped.values()];

    const filtered = needle
      ? uniqueItems.filter(it => {
          const nm = names[it.itemId]?.name;
          return nm ? nm.toLowerCase().includes(needle) : String(it.itemId).includes(needle);
        })
      : uniqueItems;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortKey === "name") {
        const an = names[a.itemId]?.name ?? `#${a.itemId}`;
        const bn = names[b.itemId]?.name ?? `#${b.itemId}`;
        return an.localeCompare(bn) * sortDir;
      }
      return ((a[sortKey] as number) - (b[sortKey] as number)) * sortDir;
    });
    return sorted;
  }, [items, q, names, sortKey, sortDir]);

  // virtual window
  const total = rows.length;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(total, first + Math.ceil(viewH / ROW_H) + OVERSCAN * 2);
  const slice = rows.slice(first, last);

  // keep the viewport height in sync with layout changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // resolve names only for the rows currently rendered
  const sliceIds = slice.map(r => r.itemId).join(",");
  useEffect(() => {
    if (sliceIds) request(sliceIds.split(",").map(Number));
  }, [sliceIds, request]);

  const sort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? 1 : -1);
    }
  };
  // a render helper, not a component — keeps sort state in this one closure
  const th = (k: SortKey, label: string, align?: "right") => (
    <button
      onClick={() => sort(k)}
      className={`hover:text-foreground uppercase tracking-wider ${align === "right" ? "text-right" : "text-left"} ${
        sortKey === k ? "text-amber-400" : "text-muted-foreground"
      }`}
    >
      {label}
      {sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : ""}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b p-2">
        <div className="relative max-w-xs flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-2 left-2 h-3.5 w-3.5" />
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t("market.filterPlaceholder")}
            className="h-7 pl-7 font-mono text-xs"
          />
        </div>
        <span className="text-muted-foreground ml-auto font-mono text-[10px]">
          {t("market.count", { n: total.toLocaleString(), all: items.length.toLocaleString() })}
        </span>
      </div>

      <div className={`grid ${COLS} gap-2 border-b px-3 py-1 font-mono text-[10px]`}>
        <span />
        {th("name", t("market.col.item"))}
        {th("min", t("market.col.min"), "right")}
        {th("median", t("market.col.median"), "right")}
        {th("listings", t("market.col.lots"), "right")}
        {th("total", t("market.col.stock"), "right")}
      </div>

      <div ref={scrollRef} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-auto">
        {total === 0 ? (
          <div className="text-muted-foreground p-4 text-center text-xs">{t("market.empty")}</div>
        ) : (
          <div style={{ height: total * ROW_H, position: "relative" }}>
            {slice.map((it, i) => {
              const idx = first + i;
              const meta = names[it.itemId];
              const nm = meta?.name ?? `#${it.itemId}`;
              const active = it.itemId === selected;
              const watched = watchedIds.has(it.itemId);
              return (
                <div
                  key={it.itemId}
                  onClick={() => onSelect(it.itemId, nm)}
                  style={{ position: "absolute", top: idx * ROW_H, height: ROW_H, left: 0, right: 0 }}
                  className={`grid ${COLS} hover:bg-accent/40 cursor-pointer items-center gap-2 border-b px-3 font-mono text-[11px] ${
                    active ? "bg-accent/60 border-l-2 border-l-amber-400 pl-[10px]" : ""
                  }`}
                >
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onToggleWatch({ id: it.itemId, name: nm, quality: meta?.quality ?? "COMMON" });
                    }}
                    title={t(watched ? "market.unwatch" : "market.watch")}
                    className={`flex h-full items-center ${
                      watched ? "text-amber-400" : "text-muted-foreground/40 hover:text-amber-400"
                    }`}
                  >
                    <Star className="h-3.5 w-3.5" fill={watched ? "currentColor" : "none"} />
                  </button>
                  <span className="truncate" style={{ color: QUALITY_COLOR[meta?.quality ?? "COMMON"] ?? "#fff" }}>
                    {nm}
                  </span>
                  <span className="text-right">{fmtGoldShort(it.min)}</span>
                  <span className="text-muted-foreground text-right">{fmtGoldShort(it.median)}</span>
                  <span className="text-right">{it.listings}</span>
                  <span className="text-muted-foreground text-right">{it.total.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
