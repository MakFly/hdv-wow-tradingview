import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

type SummaryProps = {
  bestCraft: { name: string; profit: number } | null
  bestFlip: { name: string; profit: number } | null
  avgMargin: number | null
}

function fmtGold(gold: number): string {
  if (!isFinite(gold)) return "—"
  return gold.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + "g"
}

export function OpportunitySummary({ bestCraft, bestFlip, avgMargin }: SummaryProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {/* Meilleur craft */}
      <Card className="gap-0 p-0">
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-muted-foreground text-xs tracking-widest uppercase">
            Meilleur craft
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {bestCraft ? (
            <div className="flex flex-col gap-1">
              <span className="text-2xl font-bold text-emerald-400">
                +{fmtGold(bestCraft.profit)}
              </span>
              <span className="text-muted-foreground truncate text-sm">
                {bestCraft.name}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">Aucune donnée</span>
          )}
          <Badge variant="outline" className="mt-2 text-[10px]">
            Profit net
          </Badge>
        </CardContent>
      </Card>

      {/* Meilleur flip */}
      <Card className="gap-0 p-0">
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-muted-foreground text-xs tracking-widest uppercase">
            Meilleur flip
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {bestFlip ? (
            <div className="flex flex-col gap-1">
              <span className="text-2xl font-bold text-emerald-400">
                +{fmtGold(bestFlip.profit)}
              </span>
              <span className="text-muted-foreground truncate text-sm">
                {bestFlip.name}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">Aucune donnée</span>
          )}
          <Badge variant="outline" className="mt-2 text-[10px]">
            Potentiel
          </Badge>
        </CardContent>
      </Card>

      {/* Marge moyenne */}
      <Card className="gap-0 p-0 sm:col-span-2 lg:col-span-1">
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-muted-foreground text-xs tracking-widest uppercase">
            Marge moyenne
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {avgMargin !== null ? (
            <div className="flex flex-col gap-1">
              <span className="text-2xl font-bold text-emerald-400">
                {avgMargin.toFixed(1)}%
              </span>
              <span className="text-muted-foreground text-sm">
                Sur tous les crafts rentables
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">Aucune donnée</span>
          )}
          <Badge variant="outline" className="mt-2 text-[10px]">
            Marge nette
          </Badge>
        </CardContent>
      </Card>
    </div>
  )
}
