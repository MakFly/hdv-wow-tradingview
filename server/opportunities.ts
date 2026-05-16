import { Hono } from "hono"
import { Database } from "bun:sqlite"
import { resolve } from "node:path"
import { existsSync } from "node:fs"
import { getUserToken } from "./auth"
import type { StorageRepo } from "./storage"

const RETAIL_DB_PATH = resolve(import.meta.dir, "../../retail/data/knowledge.db")

type Region = "us" | "eu" | "kr" | "tw"

export function createOpportunitiesRoutes(storage: StorageRepo, mainDb: Database) {
  const app = new Hono()

  // Open retail knowledge DB (read-only)
  let retailDb: Database | null = null
  function getRetailDb(): Database | null {
    if (retailDb) return retailDb
    if (!existsSync(RETAIL_DB_PATH)) return null
    retailDb = new Database(RETAIL_DB_PATH, { readonly: true })
    return retailDb
  }

  // --- GET /opportunities ---
  // Calculates craft profitability for a character's known recipes
  app.get("/opportunities", async (c) => {
    const token = await getUserToken(mainDb)
    if (!token) return c.json({ error: "not_linked" }, 401)

    const region = (c.req.query("region") || "eu") as Region
    const realm = c.req.query("realm") || ""
    const char = c.req.query("char") || ""
    const professionFilter = c.req.query("profession") || "all"
    const minProfit = Number(c.req.query("minProfit") || "0")

    if (!realm || !char) return c.json({ error: "missing realm or char" }, 400)

    const rDb = getRetailDb()
    if (!rDb) return c.json({ error: "retail_db_not_found", message: "Run 'bun run cli ingest blizzard' in retail/ first" }, 503)

    // 1. Fetch known recipes from profile API
    const profileUrl = `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(char.toLowerCase())}/professions`
    const profileRes = await fetch(`${profileUrl}?namespace=profile-${region}&locale=fr_FR`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!profileRes.ok) return c.json({ error: "profile_fetch_failed" }, 502)

    const profileData = (await profileRes.json()) as {
      primaries?: Array<{ profession: { id: number; name: string }; tiers?: Array<{ known_recipes?: Array<{ id: number }> }> }>
      secondaries?: Array<{ profession: { id: number; name: string }; tiers?: Array<{ known_recipes?: Array<{ id: number }> }> }>
    }

    // Collect all known recipe IDs (filtered by profession if needed)
    const allProfs = [...(profileData.primaries ?? []), ...(profileData.secondaries ?? [])]
    const filteredProfs = professionFilter === "all"
      ? allProfs
      : allProfs.filter(p => String(p.profession.id) === professionFilter)

    const knownRecipeIds: number[] = []
    for (const prof of filteredProfs) {
      for (const tier of prof.tiers ?? []) {
        for (const recipe of tier.known_recipes ?? []) {
          knownRecipeIds.push(recipe.id)
        }
      }
    }

    if (knownRecipeIds.length === 0) return c.json({ crafts: [], professions: allProfs.map(p => ({ id: p.profession.id, name: p.profession.name })) })

    // 2. Lookup recipes + reagents in retail DB
    const recipeStmt = rDb.query("SELECT id, name, crafted_item_id, crafted_item_name, crafted_quantity FROM recipes WHERE id = ?")
    const reagentStmt = rDb.query("SELECT item_id, item_name, quantity FROM recipe_reagents WHERE recipe_id = ?")

    // 3. Get current AH prices (from storage — latest snapshots)
    const { latest: realmItems } = storage.getLatestAndPreviousFeed(region, Number(c.req.query("crId")) || null)
    const { latest: commodityItems } = storage.getLatestAndPreviousFeed(region, null)

    // Build price lookup maps
    const priceMap = new Map<number, number>()
    for (const row of commodityItems) {
      priceMap.set(row.itemId, row.min)
    }
    for (const row of realmItems) {
      if (!priceMap.has(row.itemId)) {
        priceMap.set(row.itemId, row.min)
      }
    }

    // 4. Calculate profitability
    type CraftOpportunity = {
      recipe_id: number
      recipe_name: string
      crafted_item_id: number
      crafted_item_name: string
      crafted_quantity: number
      craft_cost: number
      sell_price: number
      profit: number
      margin: number
      reagents: Array<{ item_id: number; item_name: string; quantity: number; unit_price: number; total_price: number }>
    }

    const crafts: CraftOpportunity[] = []

    for (const recipeId of knownRecipeIds) {
      const recipe = recipeStmt.get(recipeId) as { id: number; name: string; crafted_item_id: number | null; crafted_item_name: string | null; crafted_quantity: number } | null
      if (!recipe || !recipe.crafted_item_id) continue

      const reagents = reagentStmt.all(recipeId) as Array<{ item_id: number; item_name: string; quantity: number }>
      if (reagents.length === 0) continue

      // Calculate craft cost
      let craftCost = 0
      let missingPrice = false
      const reagentDetails: CraftOpportunity["reagents"] = []

      for (const r of reagents) {
        const price = priceMap.get(r.item_id)
        if (price == null) {
          missingPrice = true
          break
        }
        const totalPrice = price * r.quantity
        craftCost += totalPrice
        reagentDetails.push({
          item_id: r.item_id,
          item_name: r.item_name,
          quantity: r.quantity,
          unit_price: price,
          total_price: totalPrice,
        })
      }

      if (missingPrice) continue

      // Get sell price
      const sellPrice = priceMap.get(recipe.crafted_item_id)
      if (!sellPrice) continue

      const totalSell = sellPrice * recipe.crafted_quantity
      const profit = totalSell - craftCost
      const margin = craftCost > 0 ? (profit / craftCost) * 100 : 0

      if (profit >= minProfit) {
        crafts.push({
          recipe_id: recipe.id,
          recipe_name: recipe.name,
          crafted_item_id: recipe.crafted_item_id,
          crafted_item_name: recipe.crafted_item_name ?? `Item #${recipe.crafted_item_id}`,
          crafted_quantity: recipe.crafted_quantity,
          craft_cost: Math.round(craftCost),
          sell_price: Math.round(totalSell),
          profit: Math.round(profit),
          margin: Math.round(margin * 10) / 10,
          reagents: reagentDetails,
        })
      }
    }

    crafts.sort((a, b) => b.profit - a.profit)

    return c.json({
      crafts: crafts.slice(0, 100),
      total: crafts.length,
      professions: allProfs.map(p => ({ id: p.profession.id, name: p.profession.name })),
    })
  })

  // --- GET /flips ---
  // Detect undervalued items (current price < 70% of 24h median)
  app.get("/flips", (c) => {
    const region = (c.req.query("region") || "eu") as Region
    const crId = c.req.query("crId") ? Number(c.req.query("crId")) : null
    const threshold = Number(c.req.query("threshold") || "0.70")

    const { latest, prev } = storage.getLatestAndPreviousFeed(region, crId)
    const { latest: commLatest, prev: commPrev } = storage.getLatestAndPreviousFeed(region, null)

    // Combine both feeds
    const allLatest = [...commLatest, ...latest]
    const allPrev = [...commPrev, ...prev]

    // Build median from previous snapshots
    const prevMedian = new Map<number, number>()
    for (const row of allPrev) {
      prevMedian.set(row.itemId, row.median)
    }

    type FlipOpportunity = {
      item_id: number
      current_price: number
      median_price: number
      profit_potential: number
      margin: number
    }

    const flips: FlipOpportunity[] = []

    for (const row of allLatest) {
      const median = prevMedian.get(row.itemId)
      if (!median || median <= 0) continue

      if (row.min < median * threshold) {
        const profitPotential = median - row.min
        flips.push({
          item_id: row.itemId,
          current_price: Math.round(row.min),
          median_price: Math.round(median),
          profit_potential: Math.round(profitPotential),
          margin: Math.round(((profitPotential) / row.min) * 100 * 10) / 10,
        })
      }
    }

    flips.sort((a, b) => b.profit_potential - a.profit_potential)
    return c.json({ flips: flips.slice(0, 50), total: flips.length })
  })

  // --- Alerts CRUD ---
  app.get("/alerts", (c) => {
    const rows = mainDb.query("SELECT * FROM alerts WHERE active = 1 ORDER BY created_at DESC").all()
    return c.json({ alerts: rows })
  })

  app.post("/alerts", async (c) => {
    const body = await c.req.json<{
      type: string
      item_id?: number
      recipe_id?: number
      label: string
      threshold: number
      direction: string
    }>()

    if (!body.label || !body.threshold || !body.direction) {
      return c.json({ error: "missing fields" }, 400)
    }

    mainDb.query(
      `INSERT INTO alerts (type, item_id, recipe_id, label, threshold, direction, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      body.type || "price",
      body.item_id ?? null,
      body.recipe_id ?? null,
      body.label,
      body.threshold,
      body.direction,
      Date.now()
    )

    return c.json({ ok: true })
  })

  app.delete("/alerts/:id", (c) => {
    const id = Number(c.req.param("id"))
    mainDb.query("DELETE FROM alerts WHERE id = ?").run(id)
    return c.json({ ok: true })
  })

  app.post("/alerts/:id/toggle", (c) => {
    const id = Number(c.req.param("id"))
    mainDb.query("UPDATE alerts SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?").run(id)
    return c.json({ ok: true })
  })

  return app
}
