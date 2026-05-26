import { existsSync } from "node:fs"
import { resolve } from "node:path"

const ENV_PATH = resolve(import.meta.dir, "../../azeroth-terminal/.env")

if (existsSync(ENV_PATH)) {
  const lines = await Bun.file(ENV_PATH).text()
  for (const line of lines.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq)
    const val = trimmed.slice(eq + 1)
    if (!process.env[key]) process.env[key] = val
  }
}

export const config = {
  clientId: process.env.BNET_CLIENT_ID ?? "",
  clientSecret: process.env.BNET_CLIENT_SECRET ?? "",
  region: "eu" as const,
  locale: "fr_FR",
  dbPath: resolve(import.meta.dir, "../data/knowledge.db"),
  maxConcurrent: 8,
  maxRetries: 3,
} as const
