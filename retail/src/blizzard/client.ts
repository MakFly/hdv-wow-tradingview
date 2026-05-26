import { config } from "../config"

type HttpError = Error & { status: number; retryAfterMs?: number }

let accessToken = ""
let accessTokenExp = 0
let tokenInflight: Promise<string> | null = null

let bnetRequestActive = 0
const bnetRequestQueue: Array<() => void> = []
let bnetRateLimitUntil = 0

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function parseRetryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get("retry-after")
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, 30_000)
  const at = Date.parse(raw)
  if (Number.isFinite(at)) return Math.max(0, at - Date.now())
  return undefined
}

async function withBnetSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (bnetRequestActive >= config.maxConcurrent) {
    await new Promise<void>((resolve) => bnetRequestQueue.push(resolve))
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

async function getAccessToken(): Promise<string> {
  if (Date.now() < accessTokenExp - 60_000 && accessToken) return accessToken
  if (tokenInflight) return tokenInflight

  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "Missing BNET_CLIENT_ID / BNET_CLIENT_SECRET (check ../azeroth-terminal/.env)"
    )
  }

  const task = (async () => {
    const auth = Buffer.from(
      `${config.clientId}:${config.clientSecret}`
    ).toString("base64")
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
      const e = new Error(
        `oauth ${res.status}: ${txt.slice(0, 200)}`
      ) as HttpError
      e.status = res.status
      throw e
    }
    const j = (await res.json()) as { access_token: string; expires_in: number }
    accessToken = j.access_token
    accessTokenExp = Date.now() + j.expires_in * 1000
    return accessToken
  })()

  tokenInflight = task
  task.finally(() => {
    if (tokenInflight === task) tokenInflight = null
  })
  return tokenInflight
}

export async function bnetFetch(
  path: string,
  namespace: "static" | "dynamic" | "profile" = "static",
  params: Record<string, string> = {}
): Promise<Response> {
  const now = Date.now()
  if (bnetRateLimitUntil > now) await sleep(bnetRateLimitUntil - now)

  const t = await getAccessToken()
  const url = new URL(
    `https://${config.region}.api.blizzard.com${path}`
  )
  url.searchParams.set("namespace", `${namespace}-${config.region}`)
  url.searchParams.set("locale", config.locale)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await withBnetSlot(() =>
    fetch(url, { headers: { Authorization: `Bearer ${t}` } })
  )

  if (!res.ok) {
    const txt = await res.text()
    const e = new Error(
      `bnet ${res.status} ${path}: ${txt.slice(0, 200)}`
    ) as HttpError
    e.status = res.status
    if (res.status === 429) {
      e.retryAfterMs = parseRetryAfterMs(res)
      bnetRateLimitUntil = Date.now() + (e.retryAfterMs ?? 5000)
    }
    throw e
  }

  return res
}

export async function bnetGet<T = unknown>(
  path: string,
  namespace: "static" | "dynamic" | "profile" = "static",
  params: Record<string, string> = {}
): Promise<T> {
  return (await bnetFetch(path, namespace, params)).json() as Promise<T>
}

export async function bnetGetWithRetry<T = unknown>(
  path: string,
  namespace: "static" | "dynamic" | "profile" = "static",
  params: Record<string, string> = {}
): Promise<T> {
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await bnetGet<T>(path, namespace, params)
    } catch (e) {
      const err = e as HttpError
      if (err.status === 429 && attempt < config.maxRetries) {
        const wait = err.retryAfterMs ?? 2000 * attempt
        await sleep(wait)
        continue
      }
      if (err.status === 404 || err.status === 500 || err.status === 502 || err.status === 503) return undefined as T
      throw e
    }
  }
  throw new Error(`bnet: max retries for ${path}`)
}
