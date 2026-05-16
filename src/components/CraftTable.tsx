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

export type CraftOpportunity = {
  recipe_id: number
  recipe_name: string
  crafted_item_id: number
  crafted_item_name: string
  crafted_quantity: number
  craft_cost: number
  sell_price: number
  profit: number
  margin: number
  reagents: Array<{
    item_id: number
    item_name: string
    quantity: number
    unit_price: number
    total_price: number
  }>
}

function fmtGold(gold: number): string {
  if (!isFinite(gold)) return "—"
  return gold.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + "g"
}

type SortKey = "recipe_name" | "crafted_item_name" | "craft_cost" | "sell_price" | "profit" | "margin"
type SortDir = "asc" | "desc"

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />
  return dir === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3" />
    : <ArrowDown className="ml-1 inline h-3 w-3" />
}

function ReagentTooltip({ reagents }: { reagents: CraftOpportunity["reagents"] }) {
  const lines = reagents.map(
    (r) => `${r.item_name} ×${r.quantity} — ${fmtGold(r.unit_price)}/u (${fmtGold(r.total_price)})`
  )
  return lines.join("\n")
}

export function CraftTable({ crafts }: { crafts: CraftOpportunity[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("profit")
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
    const copy = [...crafts]
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
  }, [crafts, sortKey, sortDir])

  if (crafts.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-8 text-sm">
        Aucun craft rentable trouvé avec ces filtres.
      </div>
    )
  }

  const columns: Array<{ key: SortKey; label: string; align?: string }> = [
    { key: "recipe_name", label: "Recette" },
    { key: "crafted_item_name", label: "Item crafté" },
    { key: "craft_cost", label: "Coût mats", align: "text-right" },
    { key: "sell_price", label: "Prix vente", align: "text-right" },
    { key: "profit", label: "Profit", align: "text-right" },
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
            {sorted.map((craft) => (
              <TableRow key={craft.recipe_id}>
                <TableCell className="text-xs">{craft.recipe_name}</TableCell>
                <TableCell>
                  <a
                    href={`https://www.wowhead.com/fr/item=${craft.crafted_item_id}`}
                    data-wowhead={`item=${craft.crafted_item_id}&domain=fr`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-amber-400 underline-offset-2 hover:underline"
                  >
                    {craft.crafted_item_name}
                    {craft.crafted_quantity > 1 && (
                      <span className="text-muted-foreground ml-1">×{craft.crafted_quantity}</span>
                    )}
                  </a>
                </TableCell>
                <TableCell
                  className="text-right font-mono text-xs"
                  title={ReagentTooltip({ reagents: craft.reagents })}
                >
                  <span className="cursor-help border-b border-dotted border-muted-foreground">
                    {fmtGold(craft.craft_cost)}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {fmtGold(craft.sell_price)}
                </TableCell>
                <TableCell
                  className={`text-right font-mono text-xs font-semibold ${
                    craft.profit > 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {craft.profit > 0 ? "+" : ""}
                  {fmtGold(craft.profit)}
                </TableCell>
                <TableCell
                  className={`text-right font-mono text-xs ${
                    craft.margin > 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {craft.margin.toFixed(1)}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2 sm:hidden">
        {sorted.map((craft) => (
          <div
            key={craft.recipe_id}
            className="border-border bg-card rounded-lg border p-3"
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <a
                  href={`https://www.wowhead.com/fr/item=${craft.crafted_item_id}`}
                  data-wowhead={`item=${craft.crafted_item_id}&domain=fr`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-amber-400"
                >
                  {craft.crafted_item_name}
                </a>
                <div className="text-muted-foreground text-[11px]">{craft.recipe_name}</div>
              </div>
              <span
                className={`shrink-0 text-sm font-bold ${
                  craft.profit > 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {craft.profit > 0 ? "+" : ""}
                {fmtGold(craft.profit)}
              </span>
            </div>
            <div className="text-muted-foreground grid grid-cols-3 gap-1 text-[11px]">
              <div>
                <span className="block text-[9px] uppercase">Coût</span>
                <span className="font-mono">{fmtGold(craft.craft_cost)}</span>
              </div>
              <div>
                <span className="block text-[9px] uppercase">Vente</span>
                <span className="font-mono">{fmtGold(craft.sell_price)}</span>
              </div>
              <div>
                <span className="block text-[9px] uppercase">Marge</span>
                <span
                  className={`font-mono ${craft.margin > 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {craft.margin.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
