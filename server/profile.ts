import { Hono } from "hono"
import { Database } from "bun:sqlite"
import { getUserToken } from "./auth"

type Region = "us" | "eu" | "kr" | "tw"

async function profileFetch(token: string, region: Region, path: string, namespace = "profile") {
  const url = new URL(`https://${region}.api.blizzard.com${path}`)
  url.searchParams.set("namespace", `${namespace}-${region}`)
  url.searchParams.set("locale", "fr_FR")

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const txt = await res.text()
    throw Object.assign(new Error(`profile ${res.status}: ${txt.slice(0, 200)}`), {
      status: res.status,
    })
  }

  return res.json()
}

export function createProfileRoutes(db: Database) {
  const profile = new Hono()

  profile.use("*", async (c, next) => {
    const token = await getUserToken(db)
    if (!token) {
      return c.json(
        { error: "not_linked", message: "Connecte-toi d'abord via /auth/login" },
        401
      )
    }
    c.set("userToken" as never, token as never)
    await next()
  })

  profile.get("/characters", async (c) => {
    const token = c.get("userToken" as never) as string
    const region = (c.req.query("region") || "eu") as Region

    const data = (await profileFetch(token, region, "/profile/user/wow")) as {
      wow_accounts?: Array<{
        characters?: Array<{
          id: number
          name: string
          realm: { slug: string; name: string }
          playable_class: { name: string }
          playable_race: { name: string }
          level: number
          faction: { type: string; name: string }
        }>
      }>
    }

    const characters = (data.wow_accounts ?? [])
      .flatMap((a) => a.characters ?? [])
      .sort((a, b) => b.level - a.level)

    return c.json({ count: characters.length, characters })
  })

  profile.get("/character/:realm/:name", async (c) => {
    const token = c.get("userToken" as never) as string
    const region = (c.req.query("region") || "eu") as Region
    const realm = c.req.param("realm").toLowerCase()
    const name = c.req.param("name").toLowerCase()

    const data = await profileFetch(
      token,
      region,
      `/profile/wow/character/${realm}/${name}`
    )

    return c.json(data)
  })

  profile.get("/character/:realm/:name/professions", async (c) => {
    const token = c.get("userToken" as never) as string
    const region = (c.req.query("region") || "eu") as Region
    const realm = c.req.param("realm").toLowerCase()
    const name = c.req.param("name").toLowerCase()

    const data = (await profileFetch(
      token,
      region,
      `/profile/wow/character/${realm}/${name}/professions`
    )) as {
      primaries?: Array<{
        profession: { name: string; id: number }
        tiers?: Array<{
          tier: { name: string }
          known_recipes?: Array<{ id: number; name: string }>
        }>
      }>
      secondaries?: Array<{
        profession: { name: string; id: number }
        tiers?: Array<{
          tier: { name: string }
          known_recipes?: Array<{ id: number; name: string }>
        }>
      }>
    }

    const primaries = (data.primaries ?? []).map((p) => ({
      name: p.profession.name,
      id: p.profession.id,
      recipes: (p.tiers ?? []).flatMap((t) =>
        (t.known_recipes ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          tier: t.tier.name,
        }))
      ),
    }))

    const secondaries = (data.secondaries ?? []).map((p) => ({
      name: p.profession.name,
      id: p.profession.id,
      recipes: (p.tiers ?? []).flatMap((t) =>
        (t.known_recipes ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          tier: t.tier.name,
        }))
      ),
    }))

    return c.json({ primaries, secondaries })
  })

  profile.get("/character/:realm/:name/equipment", async (c) => {
    const token = c.get("userToken" as never) as string
    const region = (c.req.query("region") || "eu") as Region
    const realm = c.req.param("realm").toLowerCase()
    const name = c.req.param("name").toLowerCase()

    const data = (await profileFetch(
      token,
      region,
      `/profile/wow/character/${realm}/${name}/equipment`
    )) as {
      equipped_items?: Array<{
        slot: { type: string; name: string }
        item: { id: number }
        name: string
        quality: { type: string; name: string }
        level: { value: number }
      }>
    }

    return c.json({
      items: (data.equipped_items ?? []).map((i) => ({
        slot: i.slot.name,
        id: i.item.id,
        name: i.name,
        quality: i.quality.name,
        ilvl: i.level.value,
      })),
    })
  })

  return profile
}
