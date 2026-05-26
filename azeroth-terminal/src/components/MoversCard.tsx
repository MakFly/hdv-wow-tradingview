import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { normalizeLang } from "@/lib/i18n";
import { api, fmtGoldShort, type AhSnapshotRow, type Region } from "@/lib/api";

type Mover = { itemId: number; name: string; price: number; change: number; listings: number };

// Movers-card noise filters — see the compute block below for the rationale.
const MIN_LISTINGS = 5; // min auctions on BOTH snapshots (market depth)
const MIN_PRICE = 1; // gold floor — penny commodities make % meaningless
const MAX_ABS_CHANGE = 500; // % cap — beyond this it's a thin-market artifact

export function MoversCard({
  region,
  snapshot,
  prevSnapshot,
  onPick,
}: {
  region: Region;
  snapshot: AhSnapshotRow[] | null;
  prevSnapshot: AhSnapshotRow[] | null;
  onPick: (id: number, name: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = normalizeLang(i18n.language);
  const [names, setNames] = useState<Record<number, string>>({});
  // names are locale-specific — track which region:lang the cache belongs to
  const namesKey = useRef(`${region}:${lang}`);

  // Compute top movers
  const [top, bot] = (() => {
    if (!snapshot || !prevSnapshot) return [[], []] as [Mover[], Mover[]];
    const prev = new Map(prevSnapshot.map(p => [p.itemId, p]));
    const movers: Mover[] = [];
    for (const cur of snapshot) {
      // Need depth on BOTH ends: a thin market (a few cheap auctions) swings
      // wildly when one listing sells out — that's noise, not a price move.
      if (cur.listings < MIN_LISTINGS) continue;
      const p = prev.get(cur.itemId);
      if (!p || p.listings < MIN_LISTINGS) continue;
      // Compare on the MEDIAN, not `min`: `min` is the single cheapest auction,
      // so a 0.05g listing selling out (next cheapest 4900g) reads as +9.8M%.
      // Also skip penny items — tiny prices make % meaningless.
      if (p.median < MIN_PRICE || cur.median < MIN_PRICE) continue;
      const ch = ((cur.median - p.median) / p.median) * 100;
      // Backstop: past the filters above a real AH move is rarely > a few ×;
      // anything bigger is still a thin-market data artifact, so drop it.
      if (!isFinite(ch) || Math.abs(ch) > MAX_ABS_CHANGE) continue;
      movers.push({ itemId: cur.itemId, name: names[cur.itemId] ?? `#${cur.itemId}`, price: cur.median, change: ch, listings: cur.listings });
    }
    const sorted = movers.sort((a, b) => b.change - a.change);
    return [sorted.slice(0, 6), sorted.slice(-6).reverse()];
  })();

  // Lazy-load item names for top 12 movers (avoids hammering). On a region or
  // language switch the cache is dropped so names re-resolve in the new locale.
  useEffect(() => {
    let alive = true;
    (async () => {
      const key = `${region}:${lang}`;
      let base = names;
      if (namesKey.current !== key) {
        namesKey.current = key;
        base = {};
        setNames({});
      }
      const need = [...top, ...bot].filter(m => !base[m.itemId]).slice(0, 12);
      for (const m of need) {
        try {
          const it = await api.item(region, m.itemId, lang);
          if (!alive) return;
          setNames(n => ({ ...n, [m.itemId]: it.name }));
        } catch { /* ignore */ }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, prevSnapshot, region, lang]);

  const row = (m: Mover) => (
    <div
      key={m.itemId}
      onClick={() => onPick(m.itemId, names[m.itemId] ?? `#${m.itemId}`)}
      className="hover:bg-accent/40 grid cursor-pointer grid-cols-[1fr_auto_auto] items-center gap-2 border-b px-2 py-1 font-mono text-[11px]"
    >
      <span className="truncate">{names[m.itemId] ?? `#${m.itemId}`}</span>
      <span>{fmtGoldShort(m.price)}</span>
      <span className={m.change >= 0 ? "text-emerald-400" : "text-red-400"}>
        {m.change >= 0 ? "+" : ""}{m.change.toFixed(1)}%
      </span>
    </div>
  );

  return (
    <ScrollArea className="h-full">
      <div className="text-emerald-400 px-2 pt-1 text-[10px] tracking-wider">{t("movers.gainers")}</div>
      {top.length === 0 && <div className="text-muted-foreground p-2 text-[11px]">{t("movers.waiting")}</div>}
      {top.map(row)}
      <div className="text-red-400 px-2 pt-2 text-[10px] tracking-wider">{t("movers.losers")}</div>
      {bot.map(row)}
    </ScrollArea>
  );
}
