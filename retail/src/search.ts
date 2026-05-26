import { getDb } from "./db"

export type SearchResult = {
  type: string
  id: number
  name: string
  description?: string
  extra?: Record<string, unknown>
}

export function search(query: string, limit = 20): SearchResult[] {
  const db = getDb()
  const results: SearchResult[] = []
  const ftsQuery = query.replace(/[^\w\sàâäéèêëïîôùûüçœæ]/gi, "").trim()
  if (!ftsQuery) return results

  const ftsParam = ftsQuery
    .split(/\s+/)
    .map((w) => `${w}*`)
    .join(" ")

  const tables: Array<{
    fts: string
    source: string
    type: string
    cols: string[]
  }> = [
    { fts: "fts_classes", source: "classes", type: "class", cols: ["name"] },
    { fts: "fts_specs", source: "specs", type: "spec", cols: ["name", "description"] },
    { fts: "fts_talents", source: "talents", type: "talent", cols: ["name", "description"] },
    { fts: "fts_spells", source: "spells", type: "spell", cols: ["name", "description"] },
    { fts: "fts_dungeons", source: "dungeons", type: "dungeon", cols: ["name", "description"] },
    { fts: "fts_achievements", source: "achievements", type: "achievement", cols: ["name", "description"] },
    { fts: "fts_recipes", source: "recipes", type: "recipe", cols: ["name", "description"] },
    { fts: "fts_guides", source: "guides", type: "guide", cols: ["title", "content_md"] },
  ]

  for (const t of tables) {
    try {
      const nameCol = t.type === "guide" ? "title" : "name"
      const descCol = t.type === "guide" ? "content_md" : "description"

      const rows = db
        .query(
          `SELECT s.*, rank FROM ${t.fts} f
           JOIN ${t.source} s ON s.${t.source === "guides" ? "id" : "id"} = f.rowid
           WHERE ${t.fts} MATCH ?
           ORDER BY rank
           LIMIT ?`
        )
        .all(ftsParam, limit) as Array<Record<string, unknown>>

      for (const row of rows) {
        results.push({
          type: t.type,
          id: row.id as number,
          name: (row[nameCol] as string) ?? "",
          description: row[descCol] as string | undefined,
          extra: row,
        })
      }
    } catch {
      // FTS table might be empty
    }
  }

  results.sort((a, b) => {
    const aRank = (a.extra?.rank as number) ?? 0
    const bRank = (b.extra?.rank as number) ?? 0
    return aRank - bRank
  })

  return results.slice(0, limit)
}

export function getClassInfo(className: string, specName?: string) {
  const db = getDb()

  const cls = db
    .query("SELECT * FROM classes WHERE LOWER(name) LIKE ?")
    .get(`%${className.toLowerCase()}%`) as Record<string, unknown> | null

  if (!cls) return null

  const specs = db
    .query("SELECT * FROM specs WHERE class_id = ?")
    .all(cls.id as number) as Array<Record<string, unknown>>

  let talents: Array<Record<string, unknown>> = []
  if (specName) {
    const spec = specs.find((s) =>
      (s.name as string).toLowerCase().includes(specName.toLowerCase())
    )
    if (spec) {
      talents = db
        .query("SELECT * FROM talents WHERE spec_id = ? ORDER BY tier, col")
        .all(spec.id as number) as Array<Record<string, unknown>>
    }
  }

  return { class: cls, specs, talents }
}

export function getDungeonInfo(name: string) {
  const db = getDb()

  const dungeon = db
    .query("SELECT * FROM dungeons WHERE LOWER(name) LIKE ?")
    .get(`%${name.toLowerCase()}%`) as Record<string, unknown> | null

  if (!dungeon) return null

  const encounters = db
    .query("SELECT * FROM encounters WHERE dungeon_id = ?")
    .all(dungeon.id as number) as Array<Record<string, unknown>>

  const guides = db
    .query(
      "SELECT id, title, source, url FROM guides WHERE LOWER(title) LIKE ? OR LOWER(content_md) LIKE ?"
    )
    .all(
      `%${name.toLowerCase()}%`,
      `%${name.toLowerCase()}%`
    ) as Array<Record<string, unknown>>

  return { dungeon, encounters, guides }
}

export function getMplusMeta() {
  const db = getDb()
  const dungeons = db.query("SELECT * FROM m_plus_dungeons").all() as Array<
    Record<string, unknown>
  >
  const snapshots = db
    .query(
      "SELECT * FROM meta_snapshots WHERE category = 'm+' ORDER BY captured_at DESC LIMIT 1"
    )
    .get() as Record<string, unknown> | null

  return { dungeons, latestMeta: snapshots }
}
