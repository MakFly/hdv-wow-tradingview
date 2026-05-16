import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Badge } from "./ui/badge"
import { Skeleton } from "./ui/skeleton"
import { ScrollText } from "lucide-react"

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
  const [characters, setCharacters] = useState<Character[] | null>(null)
  const [selectedChar, setSelectedChar] = useState<Character | null>(null)
  const [professions, setProfessions] = useState<ProfessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [profsLoading, setProfsLoading] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(`${API}/api/me/characters?region=eu`)
        if (!res.ok) return
        const data = await res.json()
        setCharacters(data.characters)
        if (data.characters?.length > 0) {
          setSelectedChar(data.characters[0])
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
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  if (!characters || characters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">Aucun personnage trouvé. Vérifie ta connexion Battle.net.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-3 sm:p-4 lg:flex-row">
      {/* Character list */}
      <Card className="shrink-0 lg:w-80">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Personnages ({characters.length})</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[60vh] space-y-1 overflow-auto p-3 pt-0 lg:max-h-none">
          {characters.slice(0, 20).map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedChar(c)}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                selectedChar?.id === c.id
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.name}</div>
                <div className="text-muted-foreground truncate text-xs">
                  {c.playable_race?.name} {c.playable_class?.name}
                </div>
              </div>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {c.level}
              </Badge>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* Character detail + professions */}
      <div className="min-w-0 flex-1 space-y-4">
        {selectedChar && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                {selectedChar.name}
                <Badge variant="secondary" className="text-xs">
                  {selectedChar.playable_class?.name}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  Niv. {selectedChar.level}
                </Badge>
              </CardTitle>
              <p className="text-muted-foreground text-xs">
                {selectedChar.playable_race?.name} · {selectedChar.realm?.name} · {selectedChar.faction?.name}
              </p>
            </CardHeader>
          </Card>
        )}

        {profsLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : professions && (
          <div className="grid gap-4 sm:grid-cols-2">
            {professions.primaries.map((p) => (
              <Card key={p.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ScrollText className="h-4 w-4 text-amber-400" />
                    {p.name}
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      {p.recipes.length} recettes
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="max-h-48 overflow-auto">
                  <ul className="space-y-0.5">
                    {p.recipes.slice(0, 30).map((r) => (
                      <li key={r.id} className="text-muted-foreground truncate text-xs">
                        {r.name}
                        <span className="text-muted-foreground/50 ml-1">({r.tier})</span>
                      </li>
                    ))}
                    {p.recipes.length > 30 && (
                      <li className="text-muted-foreground/60 text-xs">
                        … +{p.recipes.length - 30} autres
                      </li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            ))}
            {professions.secondaries.map((p) => (
              <Card key={p.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ScrollText className="h-4 w-4 text-blue-400" />
                    {p.name}
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      {p.recipes.length} recettes
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="max-h-48 overflow-auto">
                  <ul className="space-y-0.5">
                    {p.recipes.slice(0, 20).map((r) => (
                      <li key={r.id} className="text-muted-foreground truncate text-xs">
                        {r.name}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
