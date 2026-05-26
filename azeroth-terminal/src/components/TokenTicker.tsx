import { TrendingDown, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { TokenSummary } from "@/lib/api";
import { fmtGoldShort } from "@/lib/api";

export function TokenTicker({ data }: { data: TokenSummary | null }) {
  const { t: tr } = useTranslation();
  if (!data) {
    return <div className="text-muted-foreground text-xs font-mono">{tr("ticker.loading")}</div>;
  }
  const regions: Array<keyof TokenSummary> = ["us", "eu", "kr", "tw"];
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
      {regions.map(r => {
        const t = data[r];
        if (!t.current) return (
          <Badge key={r} variant="outline" className="opacity-50">{r.toUpperCase()} —</Badge>
        );
        const up = (t.ch24h ?? 0) >= 0;
        return (
          <div key={r} className="flex items-center gap-1.5 rounded border border-border/60 bg-card/60 px-2 py-1">
            <span className="text-muted-foreground text-[10px] tracking-widest">{tr("ticker.label", { region: r.toUpperCase() })}</span>
            <span className="font-semibold">{fmtGoldShort(t.current.price)}</span>
            {t.ch24h !== null && (
              <span className={up ? "text-emerald-400" : "text-red-400"}>
                {up ? <TrendingUp className="inline h-3 w-3" /> : <TrendingDown className="inline h-3 w-3" />}
                {Math.abs(t.ch24h).toFixed(2)}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
