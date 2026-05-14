import { existsSync, mkdirSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { Database } from "bun:sqlite"

export type Region = "us" | "eu" | "kr" | "tw"

type TokenPoint = { t: number; price: number }
export type ItemSnapshot = {
  t: number
  min: number
  median: number
  total: number
  listings: number
}
export type AhSnapshotRow = ItemSnapshot & { itemId: number }

type FeedKind = "realm" | "commodities"
type AhMeta = { lastModified: string | null; fetchedAt: number }

export interface StorageRepo {
  init(): void
  close(): void
  getTokens(region: Region): TokenPoint[]
  appendTokenPoint(region: Region, point: TokenPoint): boolean
  getAhHistory(region: Region, crId: number | null, itemId: number): ItemSnapshot[]
  appendAhSnapshots(region: Region, crId: number | null, rows: Map<number, ItemSnapshot>): number[]
  getLatestAndPreviousFeed(region: Region, crId: number | null): { latest: AhSnapshotRow[]; prev: AhSnapshotRow[] }
  getAhMeta(key: string): AhMeta | null
  setAhMeta(key: string, lastModified: string | null, fetchedAt: number): void
}

const COMMODITIES_CR_ID = -1
const SNAPSHOT_HISTORY_PER_ITEM = 600

function toFeed(crId: number | null): { kind: FeedKind; crId: number } {
  return {
    kind: crId === null ? "commodities" : "realm",
    crId: crId === null ? COMMODITIES_CR_ID : crId,
  }
}

function ensureDataDir(p: string) {
  const dir = dirname(p)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

type Migration = { version: number; name: string; sql?: string; run?: (db: Database) => void }
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "init_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS token_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        region TEXT NOT NULL,
        t INTEGER NOT NULL,
        price INTEGER NOT NULL,
        UNIQUE(region, t)
      );

      CREATE INDEX IF NOT EXISTS idx_token_points_region_t
        ON token_points(region, t);

      CREATE TABLE IF NOT EXISTS ah_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK(kind IN ("realm", "commodities")),
        region TEXT NOT NULL,
        cr_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        t INTEGER NOT NULL,
        min REAL NOT NULL,
        median REAL NOT NULL,
        total INTEGER NOT NULL,
        listings INTEGER NOT NULL,
        UNIQUE(kind, region, cr_id, item_id, t)
      );

      CREATE INDEX IF NOT EXISTS idx_ah_snapshots_feed_item_t
        ON ah_snapshots(kind, region, cr_id, item_id, t);

      CREATE INDEX IF NOT EXISTS idx_ah_snapshots_feed_t
        ON ah_snapshots(kind, region, cr_id, t);

      CREATE TABLE IF NOT EXISTS ah_meta (
        key TEXT PRIMARY KEY,
        last_modified TEXT,
        fetched_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS __migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "add_listings_to_ah_snapshots",
    run: db => {
      const hasListings = db
        .query("PRAGMA table_info(ah_snapshots)")
        .all()
        .some((r: Record<string, unknown>) => r.name === "listings")

      if (hasListings) return

      db.exec(`
        PRAGMA foreign_keys = OFF;

        ALTER TABLE ah_snapshots RENAME TO ah_snapshots_v1;

        CREATE TABLE ah_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL CHECK(kind IN ("realm", "commodities")),
          region TEXT NOT NULL,
          cr_id INTEGER NOT NULL,
          item_id INTEGER NOT NULL,
          t INTEGER NOT NULL,
          min REAL NOT NULL,
          median REAL NOT NULL,
          total INTEGER NOT NULL,
          listings INTEGER NOT NULL DEFAULT 0,
          UNIQUE(kind, region, cr_id, item_id, t)
        );

        INSERT INTO ah_snapshots (kind, region, cr_id, item_id, t, min, median, total, listings)
          SELECT kind, region, cr_id, item_id, t, min, median, total, 0
          FROM ah_snapshots_v1;

        CREATE INDEX IF NOT EXISTS idx_ah_snapshots_feed_item_t
          ON ah_snapshots(kind, region, cr_id, item_id, t);

        CREATE INDEX IF NOT EXISTS idx_ah_snapshots_feed_t
          ON ah_snapshots(kind, region, cr_id, t);

        DROP TABLE ah_snapshots_v1;
        PRAGMA foreign_keys = ON;
      `)
    },
  },
]

class SqliteStorage implements StorageRepo {
  private db: Database

  private tokenInsert = () => this.db.prepare(`
    INSERT INTO token_points (region, t, price)
    VALUES (?, ?, ?)
    ON CONFLICT(region, t) DO NOTHING;
  `)

  private tokenPrune = () =>
    this.db.prepare(`
      DELETE FROM token_points
      WHERE region = ?
        AND t < ?;
    `)

  private tokensByRegion = () =>
    this.db.prepare(`
      SELECT t, price
      FROM token_points
      WHERE region = ?
      ORDER BY t ASC;
    `)

  private ahInsert = () =>
    this.db.prepare(`
      INSERT INTO ah_snapshots (kind, region, cr_id, item_id, t, min, median, total, listings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kind, region, cr_id, item_id, t) DO NOTHING;
    `)

  private ahPruneByItem = () =>
    this.db.prepare(`
      DELETE FROM ah_snapshots
      WHERE kind = ?
        AND region = ?
        AND cr_id = ?
        AND item_id = ?
        AND id NOT IN (
          SELECT id
          FROM ah_snapshots
          WHERE kind = ?
            AND region = ?
            AND cr_id = ?
            AND item_id = ?
          ORDER BY t DESC, id DESC
          LIMIT ${SNAPSHOT_HISTORY_PER_ITEM}
        );
    `)

  private ahHistory = () =>
    this.db.prepare(`
      SELECT t, min, median, total, listings
      FROM ah_snapshots
      WHERE kind = ?
        AND region = ?
        AND cr_id = ?
        AND item_id = ?
      ORDER BY t ASC;
    `)

  private ahFeedTimestamps = () =>
    this.db.prepare(`
      SELECT DISTINCT t
      FROM ah_snapshots
      WHERE kind = ?
        AND region = ?
        AND cr_id = ?
      ORDER BY t DESC
      LIMIT 2;
    `)

  private ahFeedRows = () =>
    this.db.prepare(`
      SELECT item_id as itemId, t, min, median, total, listings
      FROM ah_snapshots
      WHERE kind = ?
        AND region = ?
        AND cr_id = ?
        AND t = ?
      ORDER BY item_id ASC;
    `)

  private ahMetaGet = () => this.db.prepare(`SELECT last_modified, fetched_at FROM ah_meta WHERE key = ?;`)
  private ahMetaSet = () => this.db.prepare(`INSERT OR REPLACE INTO ah_meta (key, last_modified, fetched_at) VALUES (?, ?, ?);`)
  private migrationGet = () => this.db.prepare(`SELECT MAX(version) as v FROM __migrations;`)
  private migrationSet = () => this.db.prepare(`INSERT INTO __migrations (version, name, applied_at) VALUES (?, ?, ?);`)

  constructor(path: string) {
    ensureDataDir(path)
    this.db = new Database(path, { create: true })
  }

  init() {
    this.db.exec("PRAGMA journal_mode = WAL;")
    this.db.exec("PRAGMA synchronous = NORMAL;")

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS __migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `)

    const row = this.migrationGet().get() as { v: number | null } | null
    const current = row?.v ? Number(row.v) : 0
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue
      this.db.exec("BEGIN;")
      try {
        if (m.sql) this.db.exec(m.sql)
        m.run?.(this.db)
        this.migrationSet().run(m.version, m.name, Date.now())
        this.db.exec("COMMIT;")
      } catch (e) {
        this.db.exec("ROLLBACK;")
        throw e
      }
    }
  }

  close() {
    this.db.close()
  }

  getTokens(region: Region): TokenPoint[] {
    return this.tokensByRegion().all(region).map(row => ({
      t: Number(row.t),
      price: Number(row.price),
    })) as TokenPoint[]
  }

  appendTokenPoint(region: Region, point: TokenPoint): boolean {
    const { t, price } = point
    const inserted = this.tokenInsert().run(region, t, price).changes > 0
    if (inserted) {
      const cutoff = Date.now() - 90 * 86400_000
      this.tokenPrune().run(region, cutoff)
    }
    return inserted
  }

  getAhHistory(region: Region, crId: number | null, itemId: number): ItemSnapshot[] {
    const { kind, crId: normalized } = toFeed(crId)
    return this.ahHistory().all(kind, region, normalized, itemId).map(row => ({
      t: Number(row.t),
      min: Number(row.min),
      median: Number(row.median),
      total: Number(row.total),
      listings: Number(row.listings),
    })) as ItemSnapshot[]
  }

  appendAhSnapshots(region: Region, crId: number | null, rows: Map<number, ItemSnapshot>): number[] {
    const { kind, crId: normalized } = toFeed(crId)
    const insertedItemIds: number[] = []

    const insert = this.ahInsert()
    const prune = this.ahPruneByItem()

    for (const [itemId, snap] of rows.entries()) {
      const info = insert.run(
        kind,
        region,
        normalized,
        itemId,
        snap.t,
        snap.min,
        snap.median,
        snap.total,
        snap.listings
      )
      if (info.changes > 0) {
        insertedItemIds.push(itemId)
      }
      prune.run(kind, region, normalized, itemId, kind, region, normalized, itemId)
    }

    return insertedItemIds
  }

  getLatestAndPreviousFeed(region: Region, crId: number | null): { latest: AhSnapshotRow[]; prev: AhSnapshotRow[] } {
    const { kind, crId: normalized } = toFeed(crId)
    const times = this.ahFeedTimestamps().all(kind, region, normalized) as Array<{ t: number }>
    if (!times.length) {
      return { latest: [], prev: [] }
    }

    const latestTs = Number(times[0].t)
    const prevTs = times[1] ? Number(times[1].t) : null

    const latest = this.ahFeedRows().all(kind, region, normalized, latestTs).map(row => ({
      itemId: Number(row.itemId),
      t: Number(row.t),
      min: Number(row.min),
      median: Number(row.median),
      total: Number(row.total),
      listings: Number(row.listings),
    })) as AhSnapshotRow[]

    const prev = prevTs
      ? (this.ahFeedRows().all(kind, region, normalized, prevTs).map(row => ({
          itemId: Number(row.itemId),
          t: Number(row.t),
          min: Number(row.min),
          median: Number(row.median),
          total: Number(row.total),
          listings: Number(row.listings),
        })) as AhSnapshotRow[])
      : []

    return { latest, prev }
  }

  getAhMeta(key: string): AhMeta | null {
    const row = this.ahMetaGet().get(key) as { last_modified: string | null; fetched_at: number } | null
    if (!row) return null
    return { lastModified: row.last_modified, fetchedAt: Number(row.fetched_at) }
  }

  setAhMeta(key: string, lastModified: string | null, fetchedAt: number): void {
    this.ahMetaSet().run(key, lastModified, fetchedAt)
  }
}

class MissingPostgresAdapter implements StorageRepo {
  init() {
    throw new Error(
      "PostgreSQL migration mode requested (DB_PROVIDER=postgres) but no adapter is installed yet."
    )
  }

  close() {
    return
  }

  getTokens(): TokenPoint[] {
    return []
  }

  appendTokenPoint(): boolean {
    return false
  }

  getAhHistory(): ItemSnapshot[] {
    return []
  }

  appendAhSnapshots(): number[] {
    return []
  }

  getLatestAndPreviousFeed(): { latest: AhSnapshotRow[]; prev: AhSnapshotRow[] } {
    return { latest: [], prev: [] }
  }

  getAhMeta(): AhMeta | null {
    return null
  }

  setAhMeta(): void {
    return
  }
}

function createStorageSqlite(path: string): StorageRepo {
  const dbPath = path || "./.data/azeroth-terminal.sqlite"
  const resolved = isAbsolute(dbPath) ? dbPath : join(import.meta.dir, "..", dbPath)
  const repo = new SqliteStorage(resolved)
  repo.init()
  return repo
}

export function createStorage(): StorageRepo {
  const provider = process.env.DB_PROVIDER ?? "sqlite"
  const sqlitePath = process.env.SQLITE_PATH || "./.data/azeroth-terminal.sqlite"

  if (provider === "sqlite") {
    return createStorageSqlite(sqlitePath)
  }

  if (provider === "postgres") {
    return new MissingPostgresAdapter()
  }

  throw new Error(`Unsupported DB_PROVIDER="${provider}"; use "sqlite" or "postgres".`)
}
