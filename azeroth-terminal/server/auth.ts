import { Hono } from "hono"
import { Database } from "bun:sqlite"

const CLIENT_ID = process.env.BNET_CLIENT_ID ?? ""
const CLIENT_SECRET = process.env.BNET_CLIENT_SECRET ?? ""
const REDIRECT_URI = "http://localhost:8788/auth/callback"
const FRONTEND_URL = "http://localhost:5173"
const SCOPES = "wow.profile"

type UserToken = {
  access_token: string
  refresh_token: string | null
  expires_at: number
  battletag: string
}

let cachedToken: UserToken | null = null

export function initAuthSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at INTEGER NOT NULL,
      battletag TEXT NOT NULL
    )
  `)
}

function loadToken(db: Database): UserToken | null {
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) return cachedToken
  const row = db
    .query("SELECT access_token, refresh_token, expires_at, battletag FROM user_tokens WHERE id = 1")
    .get() as UserToken | null
  if (row) cachedToken = row
  return row
}

function saveToken(db: Database, token: UserToken) {
  db.query(`
    INSERT INTO user_tokens (id, access_token, refresh_token, expires_at, battletag)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      battletag = excluded.battletag
  `).run(token.access_token, token.refresh_token, token.expires_at, token.battletag)
  cachedToken = token
}

async function refreshAccessToken(db: Database): Promise<UserToken | null> {
  const current = loadToken(db)
  if (!current?.refresh_token) return null

  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refresh_token,
      scope: SCOPES,
    }),
  })

  if (!res.ok) return null

  const j = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }

  const updated: UserToken = {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? current.refresh_token,
    expires_at: Date.now() + j.expires_in * 1000,
    battletag: current.battletag,
  }

  saveToken(db, updated)
  return updated
}

export async function getUserToken(db: Database): Promise<string | null> {
  const token = loadToken(db)
  if (!token) return null

  if (token.expires_at > Date.now() + 60_000) return token.access_token

  const refreshed = await refreshAccessToken(db)
  return refreshed?.access_token ?? null
}

export function createAuthRoutes(db: Database) {
  const auth = new Hono()

  auth.get("/url", (c) => {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPES,
      state: crypto.randomUUID(),
    })
    return c.json({ url: `https://oauth.battle.net/authorize?${params}` })
  })

  auth.get("/callback", (c) => {
    return c.html(`<!DOCTYPE html><html><body><script>
const code = new URLSearchParams(location.search).get('code');
if (code) window.location.href = '${FRONTEND_URL}/auth/callback?code=' + code;
else document.body.textContent = 'Error: no code';
</script></body></html>`)
  })

  auth.post("/exchange", async (c) => {
    const body = await c.req.json<{ code: string }>()
    const code = body?.code
    if (!code) return c.json({ error: "missing code" }, 400)

    const authHeader = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")

    const tokenRes = await fetch("https://oauth.battle.net/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
      }),
    })

    if (!tokenRes.ok) {
      const txt = await tokenRes.text()
      return c.json({ error: "token_exchange_failed", detail: txt.slice(0, 300) }, 500)
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
      scope: string
    }

    const userRes = await fetch("https://oauth.battle.net/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const userInfo = userRes.ok
      ? ((await userRes.json()) as { battletag?: string })
      : { battletag: "unknown" }

    const token: UserToken = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? null,
      expires_at: Date.now() + tokenData.expires_in * 1000,
      battletag: userInfo.battletag ?? "unknown",
    }

    saveToken(db, token)

    return c.json({ ok: true, battletag: token.battletag, expires_at: token.expires_at })
  })

  auth.get("/status", (c) => {
    const token = loadToken(db)
    if (!token) return c.json({ linked: false })
    return c.json({
      linked: true,
      battletag: token.battletag,
      expires_at: token.expires_at,
      expired: token.expires_at < Date.now(),
    })
  })

  auth.post("/logout", (c) => {
    db.query("DELETE FROM user_tokens WHERE id = 1").run()
    cachedToken = null
    return c.json({ ok: true })
  })

  return auth
}
