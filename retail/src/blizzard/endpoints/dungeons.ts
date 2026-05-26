import { bnetGetWithRetry } from "../client"
import { upsertMany } from "../../db"

type InstanceIndex = {
  instances: Array<{ id: number; name: string; key: { href: string } }>
}

type InstanceDetail = {
  id: number
  name: string
  map?: { name: string }
  category: { type: string }
  expansion?: { name: string }
  description?: string
  minimum_level?: number
  encounters?: Array<{ id: number; name: string; key: { href: string } }>
}

type EncounterDetail = {
  id: number
  name: string
  description?: string
  instance: { id: number }
}

type MythicKeystoneIndex = {
  current_leaderboards?: { href: string }
  seasons: Array<{ id: number; key: { href: string } }>
}

type MythicKeystoneDungeonIndex = {
  dungeons: Array<{ id: number; name: string; key: { href: string } }>
}

export async function ingestDungeons() {
  console.log("⏳ Ingesting dungeons & raids...")

  const index = await bnetGetWithRetry<InstanceIndex>(
    "/data/wow/journal-instance/index"
  )
  if (!index?.instances) return

  const dungeonRows: Record<string, unknown>[] = []
  const encounterRows: Record<string, unknown>[] = []

  for (const inst of index.instances) {
    const detail = await bnetGetWithRetry<InstanceDetail>(
      `/data/wow/journal-instance/${inst.id}`
    )
    if (!detail) continue

    dungeonRows.push({
      id: detail.id,
      name: detail.name,
      instance_type: detail.category?.type ?? null,
      min_level: detail.minimum_level ?? null,
      description: detail.description ?? null,
      expansion: detail.expansion?.name ?? null,
    })

    if (detail.encounters) {
      for (const enc of detail.encounters) {
        const encDetail = await bnetGetWithRetry<EncounterDetail>(
          `/data/wow/journal-encounter/${enc.id}`
        )
        if (!encDetail) continue

        encounterRows.push({
          id: encDetail.id,
          dungeon_id: detail.id,
          name: encDetail.name,
          description: encDetail.description ?? null,
        })
      }
    }
  }

  upsertMany("dungeons", dungeonRows)
  upsertMany("encounters", encounterRows)
  console.log(
    `✓ ${dungeonRows.length} instances, ${encounterRows.length} encounters`
  )
}

export async function ingestMythicKeystone() {
  console.log("⏳ Ingesting M+ dungeons...")

  const dungeonIndex = await bnetGetWithRetry<MythicKeystoneDungeonIndex>(
    "/data/wow/mythic-keystone/dungeon/index",
    "dynamic"
  )
  if (!dungeonIndex?.dungeons) return

  const seasonList = await bnetGetWithRetry<{ seasons?: Array<{ id: number }> }>(
    "/data/wow/mythic-keystone/season/index",
    "dynamic"
  )
  const currentSeasonId = seasonList?.seasons?.length
    ? seasonList.seasons[seasonList.seasons.length - 1].id
    : null

  const rows: Record<string, unknown>[] = dungeonIndex.dungeons.map((d) => ({
    id: d.id,
    dungeon_id: d.id,
    name: d.name,
    season_id: currentSeasonId,
  }))

  upsertMany("m_plus_dungeons", rows)
  console.log(`✓ ${rows.length} M+ dungeons (season ${currentSeasonId})`)
}
