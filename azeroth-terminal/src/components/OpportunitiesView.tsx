import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { RefreshCcw, Filter, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { OpportunitySummary } from "./OpportunitySummary"
import { CraftTable, type CraftOpportunity } from "./CraftTable"
import { FlipTable, type FlipOpportunity } from "./FlipTable"
import { AlertsPanel, type Alert } from "./AlertsPanel"

const API = import.meta.env.VITE_API_URL || ""

type Character = {
  id: number
  name: string
  realm: { slug: string; name: string }
}

type Profession = {
  id: number
  name: string
}

export function OpportunitiesView() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Characters & professions
  const [characters, setCharacters] = useState<Character[]>([])
  const [professions, setProfessions] = useState<Profession[]>([])
  const [selectedChar, setSelectedChar] = useState<Character | null>(null)
  const [professionFilter, setProfessionFilter] = useState("all")
  const [minProfit, setMinProfit] = useState(0)

  // Data
  const [crafts, setCrafts] = useState<CraftOpportunity[]>([])
  const [flips, setFlips] = useState<FlipOpportunity[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])

  // Loading states
  const [loadingCrafts, setLoadingCrafts] = useState(false)
  const [loadingFlips, setLoadingFlips] = useState(false)
  const [loadingAlerts, setLoadingAlerts] = useState(false)
  const [alertsCollapsed, setAlertsCollapsed] = useState(false)

  // Load characters on mount
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(`${API}/api/me/characters?region=eu`)
        if (!res.ok) return
        const data = await res.json()
        const chars: Character[] = data.characters ?? []
        setCharacters(chars)

        // Pick from URL or first character
        const urlRealm = searchParams.get("realm")
        const urlChar = searchParams.get("char")
        const match = chars.find(
          (c) => c.realm.slug === urlRealm && c.name.toLowerCase() === urlChar?.toLowerCase()
        )
        setSelectedChar(match ?? chars[0] ?? null)
      } catch {
        /* ignore */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load professions when char changes
  useEffect(() => {
    if (!selectedChar) return
    ;(async () => {
      try {
        const res = await fetch(
          `${API}/api/me/character/${selectedChar.realm.slug}/${encodeURIComponent(selectedChar.name.toLowerCase())}/professions?region=eu`
        )
        if (!res.ok) return
        const data = await res.json()
        const profs: Profession[] = [
          ...(data.primaries ?? []),
          ...(data.secondaries ?? []),
        ].map((p: { id: number; name: string }) => ({ id: p.id, name: p.name }))
        setProfessions(profs)
      } catch {
        setProfessions([])
      }
    })()
  }, [selectedChar])

  // Update URL when char changes
  useEffect(() => {
    if (!selectedChar) return
    setSearchParams(
      { realm: selectedChar.realm.slug, char: selectedChar.name },
      { replace: true }
    )
  }, [selectedChar, setSearchParams])

  // Find crId for the selected character's realm
  const [crId, setCrId] = useState<number | null>(null)
  useEffect(() => {
    if (!selectedChar) return
    ;(async () => {
      try {
        const res = await fetch(`${API}/api/realms?region=eu`)
        if (!res.ok) return
        const realms: Array<{ id: number; slug: string }> = await res.json()
        const match = realms.find((r) => r.slug === selectedChar.realm.slug)
        setCrId(match?.id ?? null)
      } catch {
        setCrId(null)
      }
    })()
  }, [selectedChar])

  // Fetch crafts
  const fetchCrafts = useCallback(async () => {
    if (!selectedChar || crId === null) return
    setLoadingCrafts(true)
    try {
      const params = new URLSearchParams({
        realm: selectedChar.realm.slug,
        char: selectedChar.name,
        region: "eu",
        minProfit: String(minProfit),
        crId: String(crId),
      })
      if (professionFilter !== "all") params.set("profession", professionFilter)
      const res = await fetch(`${API}/api/opportunities?${params}`)
      if (res.ok) {
        const data = await res.json()
        setCrafts(data.crafts ?? data ?? [])
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingCrafts(false)
    }
  }, [selectedChar, crId, professionFilter, minProfit])

  // Fetch flips
  const fetchFlips = useCallback(async () => {
    if (crId === null) return
    setLoadingFlips(true)
    try {
      const params = new URLSearchParams({
        region: "eu",
        crId: String(crId),
      })
      const res = await fetch(`${API}/api/flips?${params}`)
      if (res.ok) {
        const data = await res.json()
        setFlips(data.flips ?? data ?? [])
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingFlips(false)
    }
  }, [crId])

  // Fetch alerts
  const fetchAlerts = useCallback(async () => {
    setLoadingAlerts(true)
    try {
      const res = await fetch(`${API}/api/alerts`)
      if (res.ok) {
        const data = await res.json()
        setAlerts(data.alerts ?? data ?? [])
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingAlerts(false)
    }
  }, [])

  // Load data on mount + when filters change
  useEffect(() => {
    fetchCrafts()
  }, [fetchCrafts])

  useEffect(() => {
    fetchFlips()
  }, [fetchFlips])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const refreshAll = () => {
    fetchCrafts()
    fetchFlips()
    fetchAlerts()
  }

  // Summary KPIs
  const summary = useMemo(() => {
    const profitableCrafts = crafts.filter((c) => c.profit > 0)
    const bestCraft = profitableCrafts.length
      ? profitableCrafts.reduce((a, b) => (a.profit > b.profit ? a : b))
      : null
    const bestFlip = flips.length
      ? flips.reduce((a, b) => (a.profit_potential > b.profit_potential ? a : b))
      : null
    const avgMargin =
      profitableCrafts.length > 0
        ? profitableCrafts.reduce((sum, c) => sum + c.margin, 0) / profitableCrafts.length
        : null

    return {
      bestCraft: bestCraft ? { name: bestCraft.crafted_item_name, profit: bestCraft.profit } : null,
      bestFlip: bestFlip ? { name: bestFlip.item_name, profit: bestFlip.profit_potential } : null,
      avgMargin,
    }
  }, [crafts, flips])

  const isLoading = loadingCrafts || loadingFlips

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-1 sm:p-2">
      {/* Toolbar */}
      <div className="bg-card/40 flex flex-wrap items-center gap-2 rounded-lg border p-3 sm:gap-3">
        <Filter className="text-muted-foreground h-4 w-4 shrink-0" />

        {/* Character selector */}
        {characters.length > 0 && (
          <Select
            value={selectedChar ? `${selectedChar.realm.slug}:${selectedChar.name}` : ""}
            onValueChange={(v) => {
              const [realm, name] = v.split(":")
              const char = characters.find((c) => c.realm.slug === realm && c.name === name)
              if (char) setSelectedChar(char)
            }}
          >
            <SelectTrigger className="h-8 w-full text-xs sm:w-[200px]">
              <SelectValue placeholder="Personnage" />
            </SelectTrigger>
            <SelectContent>
              {characters.map((c) => (
                <SelectItem key={`${c.realm.slug}:${c.name}`} value={`${c.realm.slug}:${c.name}`}>
                  {c.name} — {c.realm.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Profession filter */}
        <Select value={professionFilter} onValueChange={setProfessionFilter}>
          <SelectTrigger className="h-8 w-full text-xs sm:w-[160px]">
            <SelectValue placeholder="Profession" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes professions</SelectItem>
            {professions.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Min profit */}
        <div className="flex items-center gap-1">
          <Input
            type="number"
            placeholder="Profit min"
            value={minProfit || ""}
            onChange={(e) => setMinProfit(Number(e.target.value) || 0)}
            className="h-8 w-full text-xs sm:w-[120px]"
          />
          <span className="text-muted-foreground text-xs">g</span>
        </div>

        {/* Refresh */}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 gap-1"
          onClick={refreshAll}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCcw className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">Actualiser</span>
        </Button>
      </div>

      {/* Summary cards */}
      <OpportunitySummary
        bestCraft={summary.bestCraft}
        bestFlip={summary.bestFlip}
        avgMargin={summary.avgMargin}
      />

      {/* Alerts panel - collapsible on mobile */}
      <div className="lg:block">
        <div className="flex items-center gap-2 lg:hidden">
          <Button
            variant="ghost"
            size="sm"
            className="mb-1 h-7 text-xs"
            onClick={() => setAlertsCollapsed(!alertsCollapsed)}
          >
            {alertsCollapsed ? "Afficher les alertes" : "Masquer les alertes"}
          </Button>
        </div>
        <div className={alertsCollapsed ? "hidden lg:block" : ""}>
          {loadingAlerts ? (
            <Card className="gap-0 p-0">
              <CardContent className="flex items-center justify-center py-6">
                <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
              </CardContent>
            </Card>
          ) : (
            <AlertsPanel alerts={alerts} onRefresh={fetchAlerts} />
          )}
        </div>
      </div>

      <Separator />

      {/* Craft table */}
      <Card className="gap-0 p-0">
        <CardHeader className="border-b px-4 py-3">
          <CardTitle className="text-muted-foreground text-xs tracking-widest uppercase">
            Crafts rentables
            {crafts.length > 0 && (
              <span className="text-foreground ml-2 font-mono text-[11px]">
                ({crafts.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-2">
          {loadingCrafts ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : (
            <CraftTable crafts={crafts} />
          )}
        </CardContent>
      </Card>

      {/* Flip table */}
      <Card className="gap-0 p-0">
        <CardHeader className="border-b px-4 py-3">
          <CardTitle className="text-muted-foreground text-xs tracking-widest uppercase">
            Flips AH
            {flips.length > 0 && (
              <span className="text-foreground ml-2 font-mono text-[11px]">
                ({flips.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-2">
          {loadingFlips ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : (
            <FlipTable flips={flips} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
