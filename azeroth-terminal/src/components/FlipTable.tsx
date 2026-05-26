import { useState, useMemo } from "react"
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"

export type FlipOpportunity = {
  item_id: number
  item_name: string
  current_price: number
  median_price: number
  profit_potential: number
  margin: number
}

function fmtGold(gold: number): string {
  if (!isFinite(gold)) return "—"
  if (gold < 1) return (gold * 100).toFixed(0) + "a"
  if (gold < 100) return gold.toFixed(1) + "g"
  return Math.round(gold).toLocaleString("fr-FR") + "g"
}

type SortKey = "item_name" | "current_price" | "median_price" | "profit_potential" | "margin"
type SortDir = "asc" | "desc"

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />
  return dir === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3" />
    : <ArrowDown className="ml-1 inline h-3 w-3" />
}

export function FlipTable({ flips }: { flips: FlipOpportunity[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("profit_potential")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const sorted = useMemo(() => {
    const copy = [...flips]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      const an = av as number
      const bn = bv as number
      return sortDir === "asc" ? an - bn : bn - an
    })
    return copy
  }, [flips, sortKey, sortDir])

  if (flips.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-8 text-sm">
        Aucun flip détecté actuellement.
      </div>
    )
  }

  const columns: Array<{ key: SortKey; label: string; align?: string }> = [
    { key: "item_name", label: "Item" },
    { key: "current_price", label: "Prix actuel", align: "text-right" },
    { key: "median_price", label: "Prix médian 24h", align: "text-right" },
    { key: "profit_potential", label: "Profit potentiel", align: "text-right" },
    { key: "margin", label: "Marge %", align: "text-right" },
  ]

  return (
    <>
      {/* Desktop table */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.align}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 text-xs font-medium hover:bg-transparent"
                    onClick={() => toggleSort(col.key)}
                  >
                    {col.label}
                    <SortIcon active={sortKey === col.key} dir={sortDir} />
                  </Button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((flip) => (
              <TableRow key={flip.item_id}>
                <TableCell>
                  <a
                    href={`https://www.wowhead.com/fr/item=${flip.item_id}`}
                    data-wowhead={`item=${flip.item_id}&domain=fr`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-amber-400 underline-offset-2 hover:underline"
                  >
                    {flip.item_name}
                  </a>
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {fmtGold(flip.current_price)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {fmtGold(flip.median_price)}
                </TableCell>
                <TableCell
                  className={`text-right font-mono text-xs font-semibold ${
                    flip.profit_potential > 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {flip.profit_potential > 0 ? "+" : ""}
                  {fmtGold(flip.profit_potential)}
                </TableCell>
                <TableCell
                  className={`text-right font-mono text-xs ${
                    flip.margin > 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {flip.margin.toFixed(1)}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2 sm:hidden">
        {sorted.map((flip) => (
          <div
            key={flip.item_id}
            className="border-border bg-card rounded-lg border p-3"
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <a
                href={`https://www.wowhead.com/fr/item=${flip.item_id}`}
                data-wowhead={`item=${flip.item_id}&domain=fr`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-amber-400"
              >
                {flip.item_name}
              </a>
              <span
                className={`shrink-0 text-sm font-bold ${
                  flip.profit_potential > 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {flip.profit_potential > 0 ? "+" : ""}
                {fmtGold(flip.profit_potential)}
              </span>
            </div>
            <div className="text-muted-foreground grid grid-cols-3 gap-1 text-[11px]">
              <div>
                <span className="block text-[9px] uppercase">Actuel</span>
                <span className="font-mono">{fmtGold(flip.current_price)}</span>
              </div>
              <div>
                <span className="block text-[9px] uppercase">Médian</span>
                <span className="font-mono">{fmtGold(flip.median_price)}</span>
              </div>
              <div>
                <span className="block text-[9px] uppercase">Marge</span>
                <span
                  className={`font-mono ${flip.margin > 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {flip.margin.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
