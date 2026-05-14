import { useTranslation } from "react-i18next";
import type { AhSnapshot, ItemDetail } from "@/lib/api";
import { fmtGoldShort } from "@/lib/api";

export function MarketStats({
  history,
  item,
}: {
  history: AhSnapshot[];
  item: ItemDetail | null;
}) {
  const { t } = useTranslation();
  const formatCount = (n: number) => Math.round(n).toLocaleString();
  if (history.length === 0) {
    return <div className="text-muted-foreground p-3 text-xs">{t("stats.empty")}</div>;
  }
  const last = history[history.length - 1];
  const dayCutoff = last.t - 86400;
  const day = history.filter(h => h.t >= dayCutoff);
  const open = day[0]?.min ?? last.min;
  const high = Math.max(...day.map(h => h.min));
  const low = Math.min(...day.map(h => h.min));
  const stock24Delta = (day.at(-1)?.total ?? 0) - (day.at(0)?.total ?? 0);
  const ch = open > 0 ? ((last.min - open) / open) * 100 : 0;
  const spread = Math.max(0, last.median - last.min);
  const spreadPct = last.min > 0 ? (spread / last.min) * 100 : 0;

  const rows: { key: string; label: string; value: string; accent?: boolean }[] = [
    { key: "open24", label: t("stats.open24"), value: fmtGoldShort(open) },
    { key: "high24", label: t("stats.high24"), value: fmtGoldShort(high) },
    { key: "low24", label: t("stats.low24"), value: fmtGoldShort(low) },
    { key: "delta24", label: t("stats.delta24"), value: `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%`, accent: true },
    { key: "listings", label: t("stats.listings"), value: String(last.listings) },
    { key: "stock", label: t("stats.stock"), value: String(last.total) },
    { key: "stock24", label: t("stats.stock24"), value: `${stock24Delta >= 0 ? "+" : ""}${formatCount(stock24Delta)}` },
    { key: "median", label: t("stats.median"), value: fmtGoldShort(last.median) },
    { key: "spread", label: t("stats.spread"), value: `${fmtGoldShort(spread)} · ${spreadPct.toFixed(1)}%` },
    {
      key: "vendor",
      label: t("stats.vendor"),
      value: item?.sell_price ? `${Math.floor((item.sell_price ?? 0) / 10000)}g` : "—",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-3 font-mono text-xs">
      {rows.map(({ key, label, value, accent }) => (
        <div key={key} className="flex justify-between">
          <span className="text-muted-foreground">{label}</span>
          <span className={accent ? (ch >= 0 ? "text-emerald-400" : "text-red-400") : ""}>{value}</span>
        </div>
      ))}
    </div>
  );
}
