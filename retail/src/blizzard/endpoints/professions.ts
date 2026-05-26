import { bnetGetWithRetry } from "../client"
import { getDb, upsertMany } from "../../db"

type ProfessionIndex = {
  professions: Array<{ id: number; name: string; key: { href: string } }>
}

type ProfessionDetail = {
  id: number
  name: string
  type?: { type: string; name: string }
  skill_tiers?: Array<{ id: number; name: string; key: { href: string } }>
}

type SkillTier = {
  id: number
  name: string
  categories?: Array<{
    name: string
    recipes?: Array<{ id: number; name: string; key: { href: string } }>
  }>
}

type RecipeDetail = {
  id: number
  name: string
  description?: string
  crafted_item?: { id: number; name: string }
  crafted_quantity?: { value: number }
  reagents?: Array<{
    reagent: { id: number; name: string }
    quantity: number
  }>
}

export async function ingestProfessions() {
  console.log("⏳ Ingesting professions & recipes...")

  const index = await bnetGetWithRetry<ProfessionIndex>("/data/wow/profession/index")
  if (!index?.professions) return

  const profRows: Record<string, unknown>[] = []
  const recipeRows: Record<string, unknown>[] = []
  const reagentRows: Array<{ recipe_id: number; item_id: number; item_name: string; quantity: number }> = []

  for (const prof of index.professions) {
    const detail = await bnetGetWithRetry<ProfessionDetail>(`/data/wow/profession/${prof.id}`)
    if (!detail) continue

    profRows.push({
      id: detail.id,
      name: detail.name,
      type: detail.type?.type ?? null,
    })

    if (!detail.skill_tiers) continue

    for (const tier of detail.skill_tiers) {
      const tierDetail = await bnetGetWithRetry<SkillTier>(
        `/data/wow/profession/${prof.id}/skill-tier/${tier.id}`
      )
      if (!tierDetail?.categories) continue

      const allRecipes = tierDetail.categories.flatMap((cat) => cat.recipes ?? [])
      if (allRecipes.length === 0) continue

      // Batch fetch recipes 20 at a time
      for (let i = 0; i < allRecipes.length; i += 20) {
        const batch = allRecipes.slice(i, i + 20)
        const results = await Promise.allSettled(
          batch.map((r) => bnetGetWithRetry<RecipeDetail>(`/data/wow/recipe/${r.id}`))
        )

        for (const result of results) {
          if (result.status !== "fulfilled" || !result.value) continue
          const recipe = result.value
          if (!recipe.name) continue

          recipeRows.push({
            id: recipe.id,
            profession_id: prof.id,
            name: recipe.name,
            description: recipe.description ?? null,
            crafted_item_id: recipe.crafted_item?.id ?? null,
            crafted_item_name: recipe.crafted_item?.name ?? null,
            crafted_quantity: recipe.crafted_quantity?.value ?? 1,
            skill_tier: tier.name,
          })

          if (recipe.reagents) {
            for (const r of recipe.reagents) {
              if (!r.reagent?.id || !r.reagent?.name) continue
              reagentRows.push({
                recipe_id: recipe.id,
                item_id: r.reagent.id,
                item_name: r.reagent.name,
                quantity: r.quantity,
              })
            }
          }
        }
      }
    }
  }

  upsertMany("professions", profRows)
  upsertMany("recipes", recipeRows)

  // Insert reagents with composite unique key
  const db = getDb()
  const stmt = db.query(
    `INSERT INTO recipe_reagents (recipe_id, item_id, item_name, quantity)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(recipe_id, item_id) DO UPDATE SET
       item_name = excluded.item_name,
       quantity = excluded.quantity`
  )
  const tx = db.transaction(() => {
    for (const r of reagentRows) {
      stmt.run(r.recipe_id, r.item_id, r.item_name, r.quantity)
    }
  })
  tx()

  console.log(`✓ ${profRows.length} professions, ${recipeRows.length} recipes, ${reagentRows.length} reagents`)
}
