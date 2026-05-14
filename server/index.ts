import { Hono } from "hono"
import {
  type ItemSnapshot,
  type Region,
  createStorage,
} from "./storage"

/**
 * Azeroth Terminal — Blizzard Battle.net API proxy (SSE push, zero client polling)
 *
 * The browser opens ONE persistent EventSource on /api/stream?clientId=<uuid> and
 * keeps it open for the whole page lifetime — it never reconnects for UI changes.
 * When the user switches region / realm / watchlist, the client sends a single
 * POST /api/subscribe (a command, not a poll); the server updates that client's
 * filter and pushes a fresh `snapshot` event down the SAME open stream.
 *
 * Blizzard's Game Data API is request/response only (no push), so this proxy polls
 * Blizzard internally — slowly, since the data is not real-time:
 *   - WoW Token: changes every few minutes
 *   - Auction House: regenerated ~hourly; response carries Last-Modified, so most
 *     AH polls are cheap no-ops (we skip ingest when it hasn't changed).
 */

const PORT = Number(process.env.PORT ?? 8788)
const CLIENT_ID = process.env.BNET_CLIENT_ID ?? ""
const CLIENT_SECRET = process.env.BNET_CLIENT_SECRET ?? ""
const POLL_TOKEN_SEC = Number(process.env.POLL_TOKEN_SEC ?? 300)
const POLL_AH_SEC = Number(process.env.POLL_AH_SEC ?? 900)
// On (re)connect / subscribe, only hit Blizzard for AH if our snapshot is older
// than this; otherwise serve what's already in memory and DB.
const AH_REFRESH_STALE_MS = 600_000 // 10 min

const REGIONS = ["us", "eu", "kr", "tw"] as const

const DEFAULT_LOCALE: Record<Region, string> = {
  us: "en_US",
  eu: "en_GB",
  kr: "ko_KR",
  tw: "zh_TW",
}

const REGION_LOCALES: Record<Region, Record<string, string>> = {
  us: { en: "en_US", es: "es_MX", pt: "pt_BR" },
  eu: { en: "en_GB", fr: "fr_FR", de: "de_DE", es: "es_ES", it: "it_IT", ru: "ru_RU", pt: "pt_PT" },
  kr: { ko: "ko_KR" },
  tw: { zh: "zh_TW" },
}

function resolveLocale(region: Region, lang?: string | null): string {
  return (lang && REGION_LOCALES[region]?.[lang]) || DEFAULT_LOCALE[region]
}

const storage = createStorage()

type TokenPoint = { t: number; price: number }

type AhItemSnapshot = ItemSnapshot
const ITEM_CACHE_TTL_MS = 1000 * 60 * 60 * 24 // 24h

type Subscription = { region: Region; crId: number | null; items: Set<number> }
type AhRefreshFeed = { key: string; fetchedAt: number | null; lastModified: string | null }
type AhRefreshStatus = {
  serverNow: number
  nextAhPollAt: number | null
  pollAhSec: number
  staleMs: number
  realm: AhRefreshFeed | null
  commodities: AhRefreshFeed
}

type SSEClient = {
  id: number
  clientId: string
  region: Region
  crId: number | null
  items: Set<number>
  send: (event: string, data: unknown) => void
  close: () => void
} 

type HttpError = Error & { status: number; retryAfterMs?: number }
type CachedItem = {
  payload: ItemDetailPayload
  expiresAt: number
}
type ItemDetailPayload = {
  id: number
  name: string
  quality: { type: string; name: string }
  item_class: { name: string }
  item_subclass: { name: string }
  purchase_price?: number
  sell_price?: number
  icon?: string
}

const SEARCH_COOLDOWN_MS = 60_000
type CachedSearch = { results: { results: Array<{ id: number; name: string; quality: string }> }; expiresAt: number }
const MAX_CONCURRENT_ITEM_FETCHES = 3
const MAX_CONCURRENT_BNET_REQUESTS = 8
const MAX_RATE_LIMIT_RETRIES = 3

const searchInFlight = new Map<
  string,
  Promise<{ results: Array<{ id: number; name: string; quality: string }> }>
>()

let itemFetchActive = 0
const itemFetchQueue: Array<() => void> = []

let bnetRequestActive = 0
const bnetRequestQueue: Array<() => void> = []
let bnetRateLimitUntil = 0

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function parseRetryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get("retry-after")
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000)

  const at = Date.parse(raw)
  if (Number.isFinite(at)) return Math.max(0, at - Date.now())
  return undefined
}

async function withBnetSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (bnetRequestActive >= MAX_CONCURRENT_BNET_REQUESTS) {
    await new Promise<void>(resolve => bnetRequestQueue.push(resolve))
  }

  bnetRequestActive++
  try {
    return await fn()
  } finally {
    bnetRequestActive--
    const next = bnetRequestQueue.shift()
    if (next) next()
  }
}

async function withItemSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (itemFetchActive >= MAX_CONCURRENT_ITEM_FETCHES) {
    await new Promise<void>(resolve => itemFetchQueue.push(resolve))
  }

  itemFetchActive++
  try {
    return await fn()
  } finally {
    itemFetchActive--
    const next = itemFetchQueue.shift()
    if (next) next()
  }
}

let clientSeq = 0
// keyed by stable clientId so an EventSource auto-reconnect replaces, not duplicates
const clients = new Map<string, SSEClient>()
// last known subscription per clientId — lets a reconnect restore state instantly,
// and lets a /api/subscribe that races ahead of the stream still take effect
const lastSub = new Map<string, Subscription>()

function broadcast(event: string, data: unknown, filter?: (c: SSEClient) => boolean) {
  for (const c of clients.values()) {
    if (!filter || filter(c)) c.send(event, data)
  }
}

function metaToRefreshFeed(key: string): AhRefreshFeed {
  const meta = storage.getAhMeta(key)
  return {
    key,
    fetchedAt: meta?.fetchedAt ?? null,
    lastModified: meta?.lastModified ?? null,
  }
}

let nextAhPollAt: number | null = CLIENT_ID && CLIENT_SECRET ? Date.now() + POLL_AH_SEC * 1000 : null

function buildAhRefreshStatus(sub: Pick<Subscription, "region" | "crId">): AhRefreshStatus {
  return {
    serverNow: Date.now(),
    nextAhPollAt,
    pollAhSec: POLL_AH_SEC,
    staleMs: AH_REFRESH_STALE_MS,
    realm: sub.crId ? metaToRefreshFeed(`${sub.region}:${sub.crId}`) : null,
    commodities: metaToRefreshFeed(`${sub.region}:c`),
  }
}

function pushAhRefresh(filter?: (c: SSEClient) => boolean) {
  for (const c of clients.values()) {
    if (!filter || filter(c)) c.send("ah-refresh", buildAhRefreshStatus(c))
  }
}

// --------------------------- OAuth ----------------------------------------

let accessToken = ""
let accessTokenExp = 0
let tokenInflight: Promise<string> | null = null

async function getAccessToken(): Promise<string> {
  if (Date.now() < accessTokenExp - 60_000 && accessToken) return accessToken
  if (tokenInflight) return tokenInflight
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing BNET_CLIENT_ID / BNET_CLIENT_SECRET (see .env.example)")
  }
  const task = (async () => {
    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")
    const res = await withBnetSlot(() =>
      fetch("https://oauth.battle.net/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      })
    )
    if (!res.ok) {
      const txt = await res.text()
      const e = new Error(`oauth ${res.status}: ${txt.slice(0, 200)}`) as HttpError
      e.status = res.status
      throw e
    }
    const j = (await res.json()) as { access_token: string; expires_in: number }
    if (!j?.access_token || !Number.isFinite(j.expires_in) || j.expires_in <= 0) {
      throw new Error("oauth malformed response: missing access token")
    }
    accessToken = j.access_token
    accessTokenExp = Date.now() + j.expires_in * 1000
    return accessToken
  })()
  tokenInflight = task
  // Ensure a failed token refresh never poisons future calls with a dead promise.
  task.finally(() => {
    if (tokenInflight === task) tokenInflight = null
  })

  return tokenInflight
}

// --------------------------- Blizzard API wrappers -------------------------

/** Raw Blizzard GET — returns the Response so callers can read headers (Last-Modified). */
async function bnetFetch(
  region: Region,
  path: string,
  namespace: string,
  params: Record<string, string> = {},
  locale?: string
): Promise<Response> {
  const now = Date.now()
  if (bnetRateLimitUntil > now) await sleep(bnetRateLimitUntil - now)

  const t = await getAccessToken()
  const url = new URL(`https://${region}.api.blizzard.com${path}`)
  url.searchParams.set("namespace", `${namespace}-${region}`)
  url.searchParams.set("locale", locale ?? DEFAULT_LOCALE[region])
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await withBnetSlot(async () =>
    fetch(url, {
      headers: { Authorization: `Bearer ${t}` },
    })
  )
  if (!res.ok) {
    const txt = await res.text()
    const e: HttpError = new Error(`bnet ${res.status} ${path}: ${txt.slice(0, 200)}`) as HttpError
    e.status = res.status
    if (res.status === 429) {
      e.retryAfterMs = parseRetryAfterMs(res)
    }
    throw e
  }

  return res
}

async function bnetGet(
  region: Region,
  path: string,
  namespace: string,
  params: Record<string, string> = {},
  locale?: string
) {
  return (await bnetFetch(region, path, namespace, params, locale)).json()
}

function isRateLimitError(e: unknown): e is HttpError {
  return !!(e && typeof e === "object" && "status" in e && (e as HttpError).status === 429)
}

async function withRetry<T>(fn: () => Promise<T>, attempt = 1, maxAttempts = MAX_RATE_LIMIT_RETRIES): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const shouldRetry = isRateLimitError(e) && attempt < maxAttempts
    if (!shouldRetry) throw e

    const baseBackoff = 250 * 2 ** (attempt - 1)
    const retryAfter = (e as HttpError).retryAfterMs
    const waitMs = Math.min(30_000, Math.max(250, retryAfter ?? baseBackoff) + Math.floor(Math.random() * 150))
    bnetRateLimitUntil = Math.max(bnetRateLimitUntil, Date.now() + waitMs)
    await sleep(waitMs)
    return withRetry(fn, attempt + 1, maxAttempts)
  }
}

function getNumericErrStatus(e: unknown): number | null {
  if (!e || typeof e !== "object") return null
  if ("status" in e && Number.isFinite(Number((e as HttpError).status))) return Number((e as HttpError).status)
  return null
}

async function fetchTokenPrice(region: Region): Promise<TokenPoint> {
  const j = (await bnetGet(region, "/data/wow/token/index", "dynamic")) as {
    price: number
    last_updated_timestamp: number
  }
  return { t: j.last_updated_timestamp, price: Math.round(j.price / 10_000) }
}

type RawAuction = {
  id: number
  item: { id: number; modifiers?: unknown[]; bonus_lists?: number[] }
  buyout?: number
  unit_price?: number
  bid?: number
  quantity: number
  time_left: string
}

async function fetchAuctions(
  region: Region,
  connectedRealmId: number
): Promise<{ auctions: RawAuction[]; lastModified: string | null }> {
  const res = await bnetFetch(region, `/data/wow/connected-realm/${connectedRealmId}/auctions`, "dynamic")
  const lastModified = res.headers.get("last-modified")
  const j = (await res.json()) as { auctions?: RawAuction[] }
  return { auctions: j.auctions ?? [], lastModified }
}

async function fetchCommodities(
  region: Region
): Promise<{ auctions: RawAuction[]; lastModified: string | null }> {
  const res = await bnetFetch(region, "/data/wow/auctions/commodities", "dynamic")
  const lastModified = res.headers.get("last-modified")
  const j = (await res.json()) as { auctions?: RawAuction[] }
  return { auctions: j.auctions ?? [], lastModified }
}

async function fetchConnectedRealms(region: Region) {
  return bnetGet(region, "/data/wow/connected-realm/index", "dynamic") as Promise<{
    connected_realms: Array<{ href: string }>
  }>
}

async function fetchConnectedRealm(region: Region, id: number) {
  return bnetGet(region, `/data/wow/connected-realm/${id}`, "dynamic") as Promise<{
    id: number
    realms: Array<{ id: number; name: string; slug: string }>
    status: { type: string }
    population: { type: string }
  }>
}

async function searchItems(region: Region, q: string, locale = "en_US", page = 1) {
  return bnetGet(region, "/data/wow/search/item", "static", {
    [`name.${locale}`]: q,
    orderby: "id",
    _page: String(page),
  }) as Promise<{
    results: Array<{
      data: { id: number; name: Record<string, string>; quality: { type: string }; level?: number }
    }>
  }>
}

async function fetchItem(region: Region, itemId: number, locale?: string) {
  return bnetGet(region, `/data/wow/item/${itemId}`, "static", {}, locale) as Promise<{
    id: number
    name: string
    quality: { type: string; name: string }
    item_class: { name: string }
    item_subclass: { name: string }
    purchase_price: number
    sell_price: number
  }>
}

async function fetchItemMedia(region: Region, itemId: number) {
  return bnetGet(region, `/data/wow/media/item/${itemId}`, "static") as Promise<{
    assets: Array<{ key: string; value: string }>
  }>
}

// --------------------------- ingest + push --------------------------------

function summarizeAuctions(
  auctions: { item: { id: number }; buyout?: number; unit_price?: number; quantity: number }[]
): Map<number, ItemSnapshot> {
  const byItem = new Map<number, number[]>()
  const counts = new Map<number, { listings: number; total: number }>()
  for (const a of auctions) {
    const price = a.unit_price ?? (a.buyout != null && a.quantity ? a.buyout / a.quantity : a.buyout)
    if (!price || !isFinite(price)) continue
    const arr = byItem.get(a.item.id) ?? []
    arr.push(price)
    byItem.set(a.item.id, arr)
    const c = counts.get(a.item.id) ?? { listings: 0, total: 0 }
    c.listings += 1
    c.total += a.quantity
    counts.set(a.item.id, c)
  }

  const out = new Map<number, ItemSnapshot>()
  const now = Math.floor(Date.now() / 1000)

  for (const [id, prices] of byItem) {
    prices.sort((a, b) => a - b)
    const min = prices[0] / 10_000
    const median = prices[Math.floor(prices.length / 2)] / 10_000
    const c = counts.get(id)!
    out.set(id, { t: now, min, median, total: c.total, listings: c.listings })
  }
  return out
}

function recordTokenPoint(region: Region, p: TokenPoint) {
  if (storage.appendTokenPoint(region, p)) {
    broadcast("token", { region, point: p })
  }
}

/** Record a full realm AH summary into the store and push deltas to clients. */
function ingestAh(region: Region, crId: number, snaps: Map<number, ItemSnapshot>) {
  const insertedItemIds = storage.appendAhSnapshots(region, crId, snaps)
  for (const itemId of insertedItemIds) {
    const key = `${region}:${crId}:${itemId}`
    const snap = snaps.get(itemId)
    if (!snap) continue
    broadcast("ah", { key, snapshot: snap }, c => c.region === region && c.crId === crId && c.items.has(itemId))
  }

  const feed = storage.getLatestAndPreviousFeed(region, crId)
  broadcast(
    "ah-realm",
    { region, crId, items: feed.latest, prev: feed.prev },
    c => c.region === region && c.crId === crId
  )
}

/** Record a region-wide commodities summary and push deltas to clients in that region. */
function ingestCommodities(region: Region, snaps: Map<number, ItemSnapshot>) {
  const insertedItemIds = storage.appendAhSnapshots(region, null, snaps)
  for (const itemId of insertedItemIds) {
    const key = `${region}:c:${itemId}`
    const snap = snaps.get(itemId)
    if (!snap) continue
    broadcast("ah", { key, snapshot: snap }, c => c.region === region && c.items.has(itemId))
  }

  const feed = storage.getLatestAndPreviousFeed(region, null)
  broadcast(
    "commodities",
    { region, items: feed.latest, prev: feed.prev },
    c => c.region === region
  )
}

// --------------------------- Pollers --------------------------------------

const subscribedAh = new Map<string, { region: Region; crId: number }>()
const subscribedCommodities = new Set<Region>()

/** Fetch a realm's AH and ingest it — skip when Last-Modified is unchanged. */
async function fetchAndIngestAh(
  region: Region,
  crId: number
): Promise<"updated" | "unchanged" | "error"> {
  const key = `${region}:${crId}`
  try {
    const { auctions, lastModified } = await withRetry(() => fetchAuctions(region, crId))
    const prev = storage.getAhMeta(key)
    if (prev && lastModified && prev.lastModified === lastModified) {
      storage.setAhMeta(key, lastModified, Date.now())
      pushAhRefresh(c => c.region === region && c.crId === crId)
      return "unchanged"
    }
    ingestAh(region, crId, summarizeAuctions(auctions))
    storage.setAhMeta(key, lastModified ?? null, Date.now())
    pushAhRefresh(c => c.region === region && c.crId === crId)
    return "updated"
  } catch (e) {
    console.error(`[ah ${key}]`, (e as Error).message)
    pushAhRefresh(c => c.region === region && c.crId === crId)
    return "error"
  }
}

/** Register a realm for periodic AH polling; warm it now if we have nothing fresh. */
function ensureSubscribed(region: Region, crId: number) {
  const key = `${region}:${crId}`
  if (!subscribedAh.has(key)) {
    subscribedAh.set(key, { region, crId })
    fetchAndIngestAh(region, crId)
    return
  }

  const meta = storage.getAhMeta(key)
  if (!meta || Date.now() - meta.fetchedAt >= AH_REFRESH_STALE_MS) {
    fetchAndIngestAh(region, crId)
  }
}

/** Fetch a region's commodities and ingest — skipped when Last-Modified is unchanged. */
async function fetchAndIngestCommodities(region: Region): Promise<"updated" | "unchanged" | "error"> {
  const key = `${region}:c`
  try {
    const { auctions, lastModified } = await withRetry(() => fetchCommodities(region))
    const prev = storage.getAhMeta(key)
    if (prev && lastModified && prev.lastModified === lastModified) {
      storage.setAhMeta(key, lastModified, Date.now())
      pushAhRefresh(c => c.region === region)
      return "unchanged"
    }
    ingestCommodities(region, summarizeAuctions(auctions))
    storage.setAhMeta(key, lastModified ?? null, Date.now())
    pushAhRefresh(c => c.region === region)
    return "updated"
  } catch (e) {
    console.error(`[commodities ${region}]`, (e as Error).message)
    pushAhRefresh(c => c.region === region)
    return "error"
  }
}

/** Register a region for periodic commodities polling; warm it now if stale. */
function ensureCommodities(region: Region) {
  if (!subscribedCommodities.has(region)) {
    subscribedCommodities.add(region)
    fetchAndIngestCommodities(region)
    return
  }
  const meta = storage.getAhMeta(`${region}:c`)
  if (!meta || Date.now() - meta.fetchedAt >= AH_REFRESH_STALE_MS) {
    fetchAndIngestCommodities(region)
  }
}

async function pollTokens() {
  for (const r of REGIONS) {
    try {
      recordTokenPoint(r, await withRetry(() => fetchTokenPrice(r)))
    } catch (e) {
      console.error(`[token ${r}]`, (e as Error).message)
    }
  }
}

async function pollAh() {
  nextAhPollAt = Date.now() + POLL_AH_SEC * 1000
  pushAhRefresh()
  for (const { region, crId } of subscribedAh.values()) {
    const r = await fetchAndIngestAh(region, crId)
    if (r === "unchanged") console.log(`[ah ${region}:${crId}] unchanged (Last-Modified)`)
  }
  for (const region of subscribedCommodities) {
    const r = await fetchAndIngestCommodities(region)
    if (r === "unchanged") console.log(`[commodities ${region}] unchanged (Last-Modified)`)
  }
}

if (CLIENT_ID && CLIENT_SECRET) {
  pollTokens().catch(() => {})
  setInterval(() => pollTokens().catch(() => {}), POLL_TOKEN_SEC * 1000)
  setInterval(() => pollAh().catch(() => {}), POLL_AH_SEC * 1000)
  console.log(`[bnet] OAuth configured; poll tokens ${POLL_TOKEN_SEC}s / AH ${POLL_AH_SEC}s → pushed to clients via SSE`)
} else {
  console.warn("[bnet] BNET_CLIENT_ID / BNET_CLIENT_SECRET not set — stream reports authConfigured:false")
}

// --------------------------- HTTP server ----------------------------------

const app = new Hono()

const realmCache = new Map<string, unknown>()
const itemCache = new Map<string, CachedItem>()
const itemInFlight = new Map<string, Promise<ItemDetailPayload>>()
const searchCache = new Map<string, CachedSearch>()
/** Full current state pushed to a client on connect and after every subscribe. */
function buildSnapshot(sub: Subscription) {
  const tokens: Record<string, TokenPoint[]> = {}
  for (const r of REGIONS) tokens[r] = storage.getTokens(r)

  const ah: Record<string, AhItemSnapshot[]> = {}
  for (const id of sub.items) {
    if (sub.crId) {
      const realmKey = `${sub.region}:${sub.crId}:${id}`
      const rows = storage.getAhHistory(sub.region, sub.crId, id)
      if (rows.length) ah[realmKey] = rows
    }
    const comKey = `${sub.region}:c:${id}`
    const comRows = storage.getAhHistory(sub.region, null, id)
    if (comRows.length) ah[comKey] = comRows
  }

  const ahFeed = sub.crId ? storage.getLatestAndPreviousFeed(sub.region, sub.crId) : { latest: [], prev: [] }
  const comFeed = storage.getLatestAndPreviousFeed(sub.region, null)

  return {
    authConfigured: !!(CLIENT_ID && CLIENT_SECRET),
    time: Date.now(),
    pollTokenSec: POLL_TOKEN_SEC,
    pollAhSec: POLL_AH_SEC,
    ahRefresh: buildAhRefreshStatus(sub),
    tokens,
    ah,
    ahRealm: ahFeed.latest,
    prevAhRealm: ahFeed.prev,
    commodities: comFeed.latest,
    prevCommodities: comFeed.prev,
  }
}

const DEFAULT_SUB: Subscription = { region: "us", crId: null, items: new Set() }

app.get("/api/health", c => c.json({ ok: true, authConfigured: !!(CLIENT_ID && CLIENT_SECRET), clients: clients.size }))

app.get("/api/stream", async c => {
  const clientId = c.req.query("clientId") || ""
  if (!clientId) return c.json({ error: "missing clientId" }, 400)

  const stale = clients.get(clientId)
  if (stale) {
    clients.delete(clientId)
    stale.close()
  }

  const restored = lastSub.get(clientId)
  const sub: Subscription = restored
    ? { region: restored.region, crId: restored.crId, items: new Set(restored.items) }
    : { region: DEFAULT_SUB.region, crId: DEFAULT_SUB.crId, items: new Set() }

  const snapshot = buildSnapshot(sub)

  let self: SSEClient | undefined
  const enc = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // closed
        }
      }

      const ka = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ka ${Date.now()}\n\n`))
        } catch {
          // closed
        }
      }, 15_000)

      self = {
        id: ++clientSeq,
        clientId,
        region: sub.region,
        crId: sub.crId,
        items: sub.items,
        send,
        close: () => {
          clearInterval(ka)
          try {
            controller.close()
          } catch {
            // already closed
          }
        },
      }

      clients.set(clientId, self)
      send("snapshot", snapshot)

      if (restored) {
        ensureCommodities(restored.region)
        if (restored.crId) ensureSubscribed(restored.region, restored.crId)
      }

      console.log(
        `[sse] +#${self.id} ${clientId.slice(0, 8)} ${sub.region} cr#${sub.crId ?? "-"} items=${sub.items.size} (${clients.size} live)`
      )
    },
    cancel() {
      if (self && clients.get(clientId) === self) {
        clients.delete(clientId)
        self.close()
        setTimeout(() => {
          if (!clients.has(clientId)) lastSub.delete(clientId)
        }, 60_000)
        console.log(`[sse] -#${self.id} ${clientId.slice(0, 8)} (${clients.size} live)`)
      }
    },
  })

  c.req.raw.signal?.addEventListener("abort", () => {
    if (self && clients.get(clientId) === self) {
      clients.delete(clientId)
      self.close()
      console.log(`[sse] -#${self.id} ${clientId.slice(0, 8)} (abort, ${clients.size} live)`)
    }
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
      "x-accel-buffering": "no",
    },
  })
})

app.post("/api/subscribe", async c => {
  const body = (await c.req.json()) as {
    clientId?: string
    region?: Region
    crId?: number | null
    items?: number[]
  }

  if (!body.clientId) return c.json({ error: "missing clientId" }, 400)

  const sub: Subscription = {
    region: (body.region || "us") as Region,
    crId: body.crId ?? null,
    items: new Set((body.items ?? []).map(Number).filter(Boolean)),
  }

  lastSub.set(body.clientId, sub)
  const client = clients.get(body.clientId)
  if (client) {
    client.region = sub.region
    client.crId = sub.crId
    client.items = sub.items
    client.send("snapshot", buildSnapshot(sub))
  }

  ensureCommodities(sub.region)
  if (sub.crId) ensureSubscribed(sub.region, sub.crId)

  console.log(
    `[sse] ~#${client?.id ?? "?"} ${body.clientId.slice(0, 8)} sub ${sub.region} cr#${sub.crId ?? "-"} items=${sub.items.size}`
  )

  return c.json({ ok: true, applied: !!client }, 202)
})

const CHUNK = 25

app.get("/api/realms", async c => {
  const region = (c.req.query("region") || "us") as Region
  const cacheKey = `realms:${region}`
  const cached = realmCache.get(cacheKey) as { t: number; data: unknown } | undefined
  if (cached && Date.now() - cached.t < 3_600_000) return c.json(cached.data)

  const idx = await withRetry(() => fetchConnectedRealms(region))
  const ids = idx.connected_realms
    .map(r => Number(r.href.match(/connected-realm\/(\d+)/)?.[1]))
    .filter(Boolean)
    .slice(0, 500)

  const details: Array<Awaited<ReturnType<typeof fetchConnectedRealm>> | null> = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = await Promise.all(ids.slice(i, i + CHUNK).map(id => fetchConnectedRealm(region, id).catch(() => null)))
    details.push(...batch)
  }

  const data = details
    .filter((d): d is NonNullable<typeof d> => !!d)
    .map(d => ({
      id: d.id,
      name: d.realms.map(r => r.name).join(" / "),
      slug: d.realms[0]?.slug,
      status: d.status?.type,
      population: d.population?.type,
      region,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  realmCache.set(cacheKey, { t: Date.now(), data })
  return c.json(data)
})

app.get("/api/items/search", async c => {
  const region = (c.req.query("region") || "us") as Region
  const q = c.req.query("q") || ""
  if (!q) return c.json({ results: [] })

  const locale = resolveLocale(region, c.req.query("lang"))
  const cacheKey = `${region}:${locale}:${q.trim().toLowerCase()}`
  const cached = searchCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return c.json(cached.results)

  const inFlight = searchInFlight.get(cacheKey)
  if (inFlight) return c.json(await inFlight)

  const task = (async () => {
    const r = await withRetry(() => searchItems(region, q, locale))
  const results = (r.results ?? []).slice(0, 30).map(x => ({
    id: x.data.id,
    name: x.data.name?.[locale] ?? x.data.name?.en_US ?? `#${x.data.id}`,
    quality: x.data.quality?.type ?? "COMMON",
  }))
  const out = { results }
  searchCache.set(cacheKey, { results: out, expiresAt: Date.now() + SEARCH_COOLDOWN_MS })
  return out
  })()

  searchInFlight.set(cacheKey, task)
  try {
    const out = await task
    return c.json(out)
  } catch (e) {
    if (getNumericErrStatus(e) === 429) {
      return c.json({ error: "rate_limited" }, 429)
    }
    throw e
  } finally {
    if (searchInFlight.get(cacheKey) === task) searchInFlight.delete(cacheKey)
  }
})

app.get("/api/item/:id", async c => {
  const id = Number(c.req.param("id"))
  const region = (c.req.query("region") || "us") as Region
  const locale = resolveLocale(region, c.req.query("lang"))

  if (!Number.isInteger(id)) return c.json({ error: "invalid item id" }, 400)

  const cacheKey = `${region}:${locale}:${id}`
  const now = Date.now()
  const cached = itemCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return c.json(cached.payload)

  const flight = itemInFlight.get(cacheKey)
  if (flight) return c.json(await flight)

  const task = (async () => {
    const [item, media] = await withRetry(() =>
      withItemSlot(() => Promise.all([fetchItem(region, id, locale), fetchItemMedia(region, id).catch(() => null)]))
    )
    const icon = media?.assets.find(a => a.key === "icon")?.value
    return { ...item, icon } as ItemDetailPayload
  })()

  itemInFlight.set(cacheKey, task)
  try {
    const payload = await task
    itemCache.set(cacheKey, { payload, expiresAt: now + ITEM_CACHE_TTL_MS })
    return c.json(payload)
  } catch (e) {
    const status = getNumericErrStatus(e)
    if (cached && status === 429) {
      return c.json(cached.payload)
    }
    if (status === 429) {
      return c.json({ error: "rate_limited" }, 429)
    }
    throw e
  } finally {
    if (itemInFlight.get(cacheKey) === task) itemInFlight.delete(cacheKey)
  }
})

app.get("/api", c =>
  c.json({
    service: "azeroth-terminal-proxy",
    mode: "SSE push — one persistent stream per client, never polled",
    stream: "/api/stream?clientId=<uuid>",
    subscribe: "POST /api/subscribe { clientId, region, crId, items }",
    onDemand: [
      "/api/health",
      "/api/realms?region=us",
      "/api/items/search?region=us&q=ore",
      "/api/item/{id}?region=us",
    ],
  })
)

app.get("/", c =>
  c.json({
    service: "azeroth-terminal-proxy",
    mode: "SSE push — one persistent stream per client, never polled",
    stream: "/api/stream?clientId=<uuid>",
    subscribe: "POST /api/subscribe { clientId, region, crId, items }",
    onDemand: [
      "/api/health",
      "/api/realms?region=us",
      "/api/items/search?region=us&q=ore",
      "/api/item/{id}?region=us",
    ],
  })
)

app.notFound((c) => c.json({ error: "not found" }, 404))

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255,
  fetch: app.fetch,
})

console.log(`[bnet proxy] SSE stream @ http://localhost:${server.port}/api/stream`)
