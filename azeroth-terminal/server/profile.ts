import { Hono } from "hono"
import { Database } from "bun:sqlite"
import { getUserToken } from "./auth"

type Region = "us" | "eu" | "kr" | "tw"

const CLIENT_ID = process.env.BNET_CLIENT_ID ?? ""
const CLIENT_SECRET = process.env.BNET_CLIENT_SECRET ?? ""

let staticToken = ""
let staticTokenExp = 0

async function getStaticToken(): Promise<string> {
  if (Date.now() < staticTokenExp - 60_000 && staticToken) return staticToken
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  })
  if (!res.ok) throw new Error(`static oauth failed: ${res.status}`)
  const j = (await res.json()) as { access_token: string; expires_in: number }
  staticToken = j.access_token
  staticTokenExp = Date.now() + j.expires_in * 1000
  return staticToken
}

async function staticFetch(region: Region, path: string): Promise<unknown> {
  const token = await getStaticToken()
  const url = new URL(`https://${region}.api.blizzard.com${path}`)
  url.searchParams.set("namespace", `static-${region}`)
  url.searchParams.set("locale", "fr_FR")
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  return res.json()
}

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
          tier: { id: number; name: string }
          known_recipes?: Array<{ id: number; name: string }>
        }>
      }>
      secondaries?: Array<{
        profession: { name: string; id: number }
        tiers?: Array<{
          tier: { id: number; name: string }
          known_recipes?: Array<{ id: number; name: string }>
        }>
      }>
    }

    type SkillTierFR = {
      id: number
      name: string
      recipes?: Array<{ id: number; name: string }>
    }

    async function getLocalizedProfession(profId: number, tiers: Array<{ tier: { id: number; name: string }; known_recipes?: Array<{ id: number; name: string }> }>) {
      const frTierNames = new Map<number, string>()
      const frRecipeNames = new Map<number, string>()

      const profDetail = (await staticFetch(region, `/data/wow/profession/${profId}`)) as {
        name?: string
        skill_tiers?: Array<{ id: number; name: string; key: { href: string } }>
      } | null

      const profNameFR = profDetail?.name ?? null

      for (const tier of tiers) {
        const tierData = (await staticFetch(region, `/data/wow/profession/${profId}/skill-tier/${tier.tier.id}`)) as SkillTierFR | null
        if (tierData) {
          frTierNames.set(tier.tier.id, tierData.name)
          if (tierData.recipes) {
            for (const r of tierData.recipes) {
              frRecipeNames.set(r.id, r.name)
            }
          }
        }
      }

      return { profNameFR, frTierNames, frRecipeNames }
    }

    async function mapProfession(p: { profession: { name: string; id: number }; tiers?: Array<{ tier: { id: number; name: string }; known_recipes?: Array<{ id: number; name: string }> }> }) {
      const tiers = p.tiers ?? []
      const { profNameFR, frTierNames, frRecipeNames } = await getLocalizedProfession(p.profession.id, tiers)

      return {
        name: profNameFR ?? p.profession.name,
        id: p.profession.id,
        recipes: tiers.flatMap((t) =>
          (t.known_recipes ?? []).map((r) => ({
            id: r.id,
            name: frRecipeNames.get(r.id) ?? r.name,
            tier: frTierNames.get(t.tier.id) ?? t.tier.name,
          }))
        ),
      }
    }

    const primaries = await Promise.all((data.primaries ?? []).map(mapProfession))
    const secondaries = await Promise.all((data.secondaries ?? []).map(mapProfession))

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
        item: { id: number; media?: { key?: { href: string } } }
        name: string
        quality: { type: string; name: string }
        level: { value: number }
        media?: { id: number; key?: { href: string } }
        enchantments?: Array<{ display_string: string; enchantment_id?: number }>
        sockets?: Array<{ item?: { id: number; name: string }; display_string?: string }>
        set?: { item_set: { name: string } }
        stats?: Array<{ type: { type: string; name: string }; value: number }>
        spells?: Array<{ description: string }>
      }>
    }

    return c.json({
      items: (data.equipped_items ?? []).map((i) => ({
        slot_type: i.slot.type,
        slot: i.slot.name,
        id: i.item.id,
        name: i.name,
        quality: i.quality.type,
        quality_name: i.quality.name,
        ilvl: i.level.value,
        icon: `https://wow.zamimg.com/images/wow/icons/large/${i.item.id}.jpg`,
        enchant: i.enchantments?.[0]?.display_string ?? null,
        gems: i.sockets?.map((s) => s.item?.name ?? s.display_string).filter(Boolean) ?? [],
        stats: i.stats?.map((s) => ({ type: s.type.name, value: s.value })) ?? [],
        set_name: i.set?.item_set?.name ?? null,
        effects: i.spells?.map((s) => s.description) ?? [],
      })),
    })
  })

  profile.get("/character/:realm/:name/media", async (c) => {
    const token = c.get("userToken" as never) as string
    const region = (c.req.query("region") || "eu") as Region
    const realm = c.req.param("realm").toLowerCase()
    const name = c.req.param("name").toLowerCase()

    const data = (await profileFetch(
      token,
      region,
      `/profile/wow/character/${realm}/${name}/character-media`
    )) as {
      assets?: Array<{ key: string; value: string }>
    }

    const render = data.assets?.find((a) => a.key === "main")?.value
      ?? data.assets?.find((a) => a.key === "main-raw")?.value
      ?? null
    const avatar = data.assets?.find((a) => a.key === "avatar")?.value ?? null
    const inset = data.assets?.find((a) => a.key === "inset")?.value ?? null

    return c.json({ render, avatar, inset })
  })

  profile.get("/character/:realm/:name/stats", async (c) => {
    const token = c.get("userToken" as never) as string
    const region = (c.req.query("region") || "eu") as Region
    const realm = c.req.param("realm").toLowerCase()
    const name = c.req.param("name").toLowerCase()

    const data = (await profileFetch(
      token,
      region,
      `/profile/wow/character/${realm}/${name}/statistics`
    )) as Record<string, unknown>

    return c.json(data)
  })

  return profile
}
