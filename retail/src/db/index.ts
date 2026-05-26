import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { config } from "../config"

let db: Database | null = null

export function getDb(): Database {
  if (db) return db

  const dir = dirname(config.dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  db = new Database(config.dbPath, { create: true })
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")

  runMigrations(db)
  return db
}

function runMigrations(database: Database) {
  const migrationsDir = resolve(import.meta.dir, "migrations")
  const schemaFile = resolve(migrationsDir, "001-schema.sql")

  if (!existsSync(schemaFile)) {
    throw new Error(`Migration file not found: ${schemaFile}`)
  }

  const hasTable = database
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='__migrations'")
    .get()

  if (!hasTable) {
    const sql = readFileSync(schemaFile, "utf-8")
    database.exec(sql)
    database
      .query("INSERT INTO __migrations (version, name, applied_at) VALUES (?, ?, ?)")
      .run(1, "001-schema", Date.now())
  }

  const latest = database
    .query("SELECT MAX(version) as v FROM __migrations")
    .get() as { v: number } | null

  const currentVersion = latest?.v ?? 0

  if (currentVersion < 1) {
    const sql = readFileSync(schemaFile, "utf-8")
    database.exec(sql)
    database
      .query("INSERT INTO __migrations (version, name, applied_at) VALUES (?, ?, ?)")
      .run(1, "001-schema", Date.now())
  }

  if (currentVersion < 2) {
    const sql2 = readFileSync(resolve(migrationsDir, "002-recipes.sql"), "utf-8")
    database.exec(sql2)
    database
      .query("INSERT INTO __migrations (version, name, applied_at) VALUES (?, ?, ?)")
      .run(2, "002-recipes", Date.now())
  }
}

export function closeDb() {
  if (db) {
    db.close()
    db = null
  }
}

export function upsert(
  table: string,
  data: Record<string, unknown>,
  conflictCol = "id"
) {
  const db = getDb()
  const cols = Object.keys(data)
  const placeholders = cols.map(() => "?").join(", ")
  const updates = cols
    .filter((c) => c !== conflictCol)
    .map((c) => `${c} = excluded.${c}`)
    .join(", ")

  const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})
    ON CONFLICT(${conflictCol}) DO UPDATE SET ${updates}`

  db.query(sql).run(...(Object.values(data) as (string | number | null | bigint | boolean | Uint8Array)[]))
}

export function upsertMany(
  table: string,
  rows: Record<string, unknown>[],
  conflictCol = "id"
) {
  const database = getDb()
  const tx = database.transaction(() => {
    for (const row of rows) {
      upsert(table, row, conflictCol)
    }
  })
  tx()
}
