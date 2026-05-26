import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { normalizeLang } from "@/lib/i18n";
import { useItemNames } from "@/lib/hooks";
import { api, fmtGoldShort, QUALITY_COLOR, type AhSnapshotRow, type ItemSearchResult, type Region } from "@/lib/api";

type SnapMap = Map<number, AhSnapshotRow>;

export type WatchItem = { id: number; name: string; quality: string };

export function Watchlist({
  region,
  snapshot,
  watch,
  setWatch,
  selected,
  onSelect,
}: {
  region: Region;
  snapshot: SnapMap | null;
  watch: WatchItem[];
  setWatch: (w: WatchItem[]) => void;
  selected: number | null;
  onSelect: (id: number, name: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = normalizeLang(i18n.language);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const tRef = useRef<number | null>(null);

  useEffect(() => {
    if (tRef.current) window.clearTimeout(tRef.current);
    const query = q.trim();
    if (!query) {
      tRef.current = window.setTimeout(() => {
        setResults([]);
        setSearching(false);
      }, 0);
      return;
    }

    tRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.search(region, query, lang);
        setResults(r.results);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [q, region, lang]);

  // re-localize watchlist names: the stored name was frozen at add-time, so
  // resolve each item for the current language and fall back to what was stored
  const { names: localized, request } = useItemNames(region, lang);
  const watchIdsKey = watch.map(w => w.id).join(",");
  useEffect(() => {
    if (watchIdsKey) request(watchIdsKey.split(",").map(Number));
  }, [watchIdsKey, request]);

  const rows = useMemo(() => watch.map(w => ({
    ...w,
    name: localized[w.id]?.name ?? w.name,
    quality: localized[w.id]?.quality ?? w.quality,
    snap: snapshot?.get(w.id) ?? null,
  })), [watch, snapshot, localized]);

  const add = (it: ItemSearchResult) => {
    if (watch.some(w => w.id === it.id)) return;
    setWatch([...watch, { id: it.id, name: it.name, quality: it.quality }]);
    onSelect(it.id, it.name);
    setQ("");
    setResults([]);
  };

  const remove = (id: number) => setWatch(watch.filter(w => w.id !== id));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-2">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2 h-3.5 w-3.5" />
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t("watchlist.searchPlaceholder")}
            className="h-8 pl-7 font-mono text-xs"
          />
        </div>
        {results.length > 0 && (
          <div className="bg-popover mt-1 max-h-56 overflow-auto rounded border">
            {results.map(r => (
              <button
                key={r.id}
                onClick={() => add(r)}
                className="hover:bg-accent flex w-full items-center justify-between px-2 py-1.5 text-left text-xs"
              >
                <span style={{ color: QUALITY_COLOR[r.quality] ?? "#fff" }}>{r.name}</span>
                <span className="text-muted-foreground font-mono">#{r.id}</span>
              </button>
            ))}
          </div>
        )}
        {searching && <div className="text-muted-foreground mt-1 text-[10px]">{t("watchlist.searching")}</div>}
      </div>

      <ScrollArea className="flex-1">
        {rows.length === 0 && (
          <div className="text-muted-foreground p-3 text-center text-xs">
            {t("watchlist.empty")}
          </div>
        )}
        {rows.map(r => {
          const active = r.id === selected;
          return (
            <div
              key={r.id}
              onClick={() => onSelect(r.id, r.name)}
              className={`group hover:bg-accent/40 grid cursor-pointer grid-cols-[1fr_auto] gap-1 border-b px-2 py-2 ${
                active ? "bg-accent/60 border-l-2 border-l-amber-400" : ""
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold" style={{ color: QUALITY_COLOR[r.quality] ?? "#fff" }}>
                  {r.name}
                </div>
                <div className="text-muted-foreground font-mono text-[10px]">#{r.id} · {r.quality.toLowerCase()}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xs">{r.snap ? fmtGoldShort(r.snap.min) : "—"}</div>
                <div className="text-muted-foreground font-mono text-[10px]">
                  {r.snap ? t("watchlist.lots", { n: r.snap.listings }) : ""}
                  <button
                    onClick={e => { e.stopPropagation(); remove(r.id); }}
                    className="hover:text-destructive ml-1 opacity-0 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </ScrollArea>
    </div>
  );
}
