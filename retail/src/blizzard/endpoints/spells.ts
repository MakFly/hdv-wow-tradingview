import { bnetGetWithRetry } from "../client"
import { getDb, upsertMany } from "../../db"

type SpellDetail = {
  id: number
  name: string
  description?: string
  cooldown?: string
  range?: string
  cast_time?: string
  power_cost?: string
}

export async function ingestSpells() {
  console.log("⏳ Ingesting spells from talent references...")

  const db = getDb()
  const talents = db
    .query("SELECT id FROM talents")
    .all() as Array<{ id: number }>

  const spellRows: Record<string, unknown>[] = []
  const batchSize = 50
  let fetched = 0

  for (let i = 0; i < talents.length; i += batchSize) {
    const batch = talents.slice(i, i + batchSize)
    const results = await Promise.allSettled(
      batch.map((t) =>
        bnetGetWithRetry<SpellDetail>(`/data/wow/spell/${t.id}`)
      )
    )

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        const s = result.value
        spellRows.push({
          id: s.id,
          name: s.name,
          description: s.description ?? null,
          cooldown: s.cooldown ?? null,
          range: s.range ?? null,
          cast_time: s.cast_time ?? null,
          power_cost: s.power_cost ?? null,
        })
        fetched++
      }
    }

    if (spellRows.length >= 200) {
      upsertMany("spells", spellRows.splice(0))
    }
  }

  if (spellRows.length > 0) {
    upsertMany("spells", spellRows)
  }
  console.log(`✓ ${fetched} spells`)
}
