import { bnetGetWithRetry } from "../client"
import { upsertMany } from "../../db"

type AchievementCategoryIndex = {
  categories: Array<{ id: number; name: string; key: { href: string } }>
}

type AchievementCategory = {
  id: number
  name: string
  achievements?: Array<{ id: number; name: string; key: { href: string } }>
  subcategories?: Array<{ id: number; name: string; key: { href: string } }>
}

type AchievementDetail = {
  id: number
  name: string
  description?: string
  points?: number
  category?: { name: string }
}

export async function ingestAchievements() {
  console.log("⏳ Ingesting achievements...")

  const catIndex = await bnetGetWithRetry<AchievementCategoryIndex>(
    "/data/wow/achievement-category/index"
  )
  if (!catIndex?.categories) return

  const rows: Record<string, unknown>[] = []
  const seen = new Set<number>()

  for (const cat of catIndex.categories) {
    const catDetail = await bnetGetWithRetry<AchievementCategory>(
      `/data/wow/achievement-category/${cat.id}`
    )
    if (!catDetail) continue

    const achievIds: number[] = []
    if (catDetail.achievements) {
      achievIds.push(...catDetail.achievements.map((a) => a.id))
    }

    for (const id of achievIds) {
      if (seen.has(id)) continue
      seen.add(id)

      const detail = await bnetGetWithRetry<AchievementDetail>(
        `/data/wow/achievement/${id}`
      )
      if (!detail || !detail.name) continue

      rows.push({
        id: detail.id,
        name: detail.name,
        description: detail.description ?? null,
        points: detail.points ?? 0,
        category: detail.category?.name ?? cat.name,
      })
    }

    if (rows.length >= 500) {
      upsertMany("achievements", rows.splice(0))
    }
  }

  if (rows.length > 0) {
    upsertMany("achievements", rows)
  }
  console.log(`✓ ${seen.size} achievements`)
}
