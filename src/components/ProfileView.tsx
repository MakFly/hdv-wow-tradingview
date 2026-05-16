import { useEffect, useState, useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Badge } from "./ui/badge"
import { Skeleton } from "./ui/skeleton"
import { ScrollText, ChevronRight } from "lucide-react"
import { CharacterSheet } from "./CharacterSheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs"

const API = import.meta.env.VITE_API_URL || ""

type Character = {
  id: number
  name: string
  realm: { slug: string; name: string }
  playable_class: { name: string }
  playable_race: { name: string }
  level: number
  faction: { type: string; name: string }
}

type Profession = {
  name: string
  id: number
  recipes: Array<{ id: number; name: string; tier: string }>
}

type ProfessionData = {
  primaries: Profession[]
  secondaries: Profession[]
}

export function ProfileView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [characters, setCharacters] = useState<Character[] | null>(null)
  const [selectedChar, setSelectedChar] = useState<Character | null>(null)
  const [professions, setProfessions] = useState<ProfessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [profsLoading, setProfsLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [activeTab, setActiveTab] = useState("equipement")

  const selectChar = useCallback((char: Character) => {
    setSwitching(true)
    setSelectedChar(char)
    setProfessions(null)
    setSearchParams({ realm: char.realm.slug, char: char.name }, { replace: true })
    setTimeout(() => setSwitching(false), 50)
  }, [setSearchParams])

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(`${API}/api/me/characters?region=eu`)
        if (!res.ok) return
        const data = await res.json()
        setCharacters(data.characters)

        const urlRealm = searchParams.get("realm")
        const urlChar = searchParams.get("char")
        const match = urlRealm && urlChar
          ? data.characters?.find((c: Character) =>
              c.realm.slug === urlRealm && c.name.toLowerCase() === urlChar.toLowerCase()
            )
          : null

        const initial = match ?? data.characters?.[0]
        if (initial) {
          setSelectedChar(initial)
          setSearchParams({ realm: initial.realm.slug, char: initial.name }, { replace: true })
        }
      } catch {
        setCharacters([])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!selectedChar) return
    setProfsLoading(true)
    ;(async () => {
      try {
        const res = await fetch(
          `${API}/api/me/character/${selectedChar.realm.slug}/${encodeURIComponent(selectedChar.name.toLowerCase())}/professions?region=eu`
        )
        if (res.ok) {
          setProfessions(await res.json())
        }
      } catch {
        setProfessions(null)
      } finally {
        setProfsLoading(false)
      }
    })()
  }, [selectedChar])

  if (loading) {
    return (
      <div className="grid gap-4 p-4 lg:grid-cols-[280px_1fr]">
        <Skeleton className="h-[400px]" />
        <Skeleton className="h-[400px]" />
      </div>
    )
  }

  if (!characters || characters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">
              Aucun personnage trouvé. Connecte-toi via Battle.net.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-2 sm:p-3 lg:flex-row lg:p-4">
      {/* Liste des personnages */}
      <Card className="shrink-0 lg:w-72 xl:w-80">
        <CardHeader className="px-3 py-2 sm:px-4 sm:py-3">
          <CardTitle className="text-xs sm:text-sm">
            Personnages
            <Badge variant="secondary" className="ml-2 text-[10px]">{characters.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-[200px] space-y-0.5 overflow-auto px-2 pb-3 pt-0 lg:max-h-[calc(100vh-180px)]">
          {characters.slice(0, 25).map((c) => (
            <button
              key={c.id}
              onClick={() => selectChar(c)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors min-h-[44px] ${
                selectedChar?.id === c.id
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium sm:text-sm">{c.name}</div>
                <div className="text-muted-foreground truncate text-[10px] sm:text-xs">
                  {c.playable_class?.name} · {c.realm?.name}
                </div>
              </div>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {c.level}
              </Badge>
              {selectedChar?.id === c.id && (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
            </button>
          ))}
        </CardContent>
      </Card>

      {/* Fiche personnage */}
      <div className="min-w-0 flex-1 overflow-auto">
        {selectedChar && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
            <TabsList className="h-9">
              <TabsTrigger value="equipement" className="text-xs">Équipement</TabsTrigger>
              <TabsTrigger value="professions" className="text-xs">Professions</TabsTrigger>
            </TabsList>

            <TabsContent value="equipement" className="mt-0">
              {switching ? (
                <div className="space-y-3 rounded-xl bg-gradient-to-b from-slate-900 via-slate-950 to-black p-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-14 w-14 rounded-full bg-white/5" />
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-40 bg-white/5" />
                      <Skeleton className="h-3 w-28 bg-white/5" />
                    </div>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-[1fr_200px_1fr]">
                    <div className="space-y-2">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-[52px] bg-white/5" />
                      ))}
                    </div>
                    <Skeleton className="hidden h-[450px] bg-white/5 lg:block" />
                    <div className="space-y-2">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-[52px] bg-white/5" />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <CharacterSheet
                  key={`${selectedChar.realm.slug}-${selectedChar.name}`}
                  realm={selectedChar.realm.slug}
                  name={selectedChar.name}
                  className={selectedChar.playable_class?.name}
                  level={selectedChar.level}
                  race={selectedChar.playable_race?.name}
                  faction={selectedChar.faction?.name}
                />
              )}
            </TabsContent>

            <TabsContent value="professions" className="mt-0">
              {profsLoading || switching ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Skeleton className="h-48" />
                  <Skeleton className="h-48" />
                </div>
              ) : professions ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {professions.primaries.map((p) => (
                    <Card key={p.id} className="overflow-hidden">
                      <CardHeader className="bg-amber-500/5 pb-2 pt-3 px-4">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <ScrollText className="h-4 w-4 text-amber-400" />
                          {p.name}
                          <Badge variant="outline" className="ml-auto text-[10px]">
                            {p.recipes.length} recettes
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="max-h-60 overflow-auto p-3">
                        <ul className="space-y-0.5">
                          {p.recipes.map((r) => (
                            <li key={r.id} className="text-muted-foreground truncate text-xs">
                              {r.name}
                              <span className="text-muted-foreground/40 ml-1">({r.tier})</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  ))}
                  {professions.secondaries.filter((p) => p.recipes.length > 0).map((p) => (
                    <Card key={p.id}>
                      <CardHeader className="bg-blue-500/5 pb-2 pt-3 px-4">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <ScrollText className="h-4 w-4 text-blue-400" />
                          {p.name}
                          <Badge variant="outline" className="ml-auto text-[10px]">
                            {p.recipes.length}
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="max-h-48 overflow-auto p-3">
                        <ul className="space-y-0.5">
                          {p.recipes.map((r) => (
                            <li key={r.id} className="text-muted-foreground truncate text-xs">
                              {r.name}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center">
                    <p className="text-muted-foreground text-sm">Aucune profession trouvée.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
