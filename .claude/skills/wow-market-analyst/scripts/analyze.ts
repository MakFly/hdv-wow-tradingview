/**
 * wow-market-analyst — auction-house & WoW Token market analysis.
 *
 * Reads the dashboard's persisted history (`.data/ah-history.json`,
 * `.data/token-history.json`), computes four analyses — flips/arbitrage,
 * trend/momentum signals, WoW Token timing, liquidity/volatility risk — resolves
 * item/realm names via the local `:8788` proxy (best-effort), and emits a single
 * structured JSON object (or markdown with `--format markdown`).
 *
 * Advisory only: the Blizzard API is read-only, so this never trades — it tells
 * the user WHAT to buy / sell / flip; they execute it in-game.
 *
 * Run from the project root (app/azeroth-terminal):
 *   bun .claude/skills/wow-market-analyst/scripts/analyze.ts --region us --scope commodities
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveItemNames, resolveRealmName } from "./resolve-names.ts";

// --------------------------------------------------------------------------
// types
// --------------------------------------------------------------------------

type Region = "us" | "eu" | "kr" | "tw";
type Scope = "commodities" | "realm";
type Confidence = "high" | "medium" | "low";

/** One AH snapshot — `t` in unix SECONDS, prices in GOLD (see references/data-schema.md). */
type AhSnapshot = { t: number; min: number; median: number; total: number; listings: number };
/** One WoW Token point — `t` in unix MILLISECONDS, `price` in GOLD. */
type TokenPoint = { t: number; price: number };

// --------------------------------------------------------------------------
// arg parsing
// --------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags.add(key);
    else {
      args[key] = next;
      i++;
    }
  }
  return { args, flags };
}

function fail(msg: string): never {
  process.stderr.write(`wow-market-analyst: ${msg}\n`);
  process.exit(1);
}

// `.data` sits at the project root, four levels above this script's dir —
// resolving from import.meta.dir makes the default cwd-independent.
const DEFAULT_DATA_DIR = join(import.meta.dir, "../../../../.data");

const { args, flags } = parseArgs(Bun.argv.slice(2));

const region = (args.region ?? "") as Region;
if (!["us", "eu", "kr", "tw"].includes(region)) fail("--region is required (us|eu|kr|tw)");

const scope = (args.scope ?? "commodities") as Scope;
if (scope !== "commodities" && scope !== "realm") fail("--scope must be commodities|realm");

const realmId = args.realm ? Number(args.realm) : null;
if (scope === "realm" && (realmId == null || !Number.isFinite(realmId)))
  fail("--realm <connectedRealmId> is required when --scope realm");

const analyses = new Set(
  (args.analyses ?? "flip,trend,token,risk").split(",").map(s => s.trim()).filter(Boolean)
);
const top = Math.max(1, Number(args.top ?? 15));
const minListings = Math.max(0, Number(args["min-listings"] ?? 5));
// price floor (gold) for flips & trends — a "300%" move on a 0.04g penny
// commodity is pure noise, not a trade. Risk is depth-sorted so it isn't gated.
const minPrice = Math.max(0, Number(args["min-price"] ?? 1));
// default 2: the live .data history is thin (often ~2 snapshots/item), so a
// higher gate would filter out nearly everything. Items below 6 snapshots are
// still flagged `low` confidence and never get a strong BUY/SELL signal.
const minSnapshots = Math.max(1, Number(args["min-snapshots"] ?? 2));
const itemFilter = args.item ? new Set(args.item.split(",").map(Number)) : null;
const dataDir = args["data-dir"] ?? DEFAULT_DATA_DIR;
const apiBase = (args["api-base"] ?? "http://localhost:8788").replace(/\/$/, "");
const noApi = flags.has("no-api");
const format = (args.format ?? "json") as "json" | "markdown";

const needAh = analyses.has("flip") || analyses.has("trend") || analyses.has("risk");
const needToken = analyses.has("token");

// --------------------------------------------------------------------------
// small stats helpers
// --------------------------------------------------------------------------

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
};
const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const round = (x: number, d = 0) => {
  const p = 10 ** d;
  return Math.round(x * p) / p;
};
/** Least-squares slope of y vs x. */
function slope(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Confidence from snapshot count. Below `minSnapshots` an item is excluded upstream. */
function itemConfidence(snaps: number): Confidence {
  if (snaps >= 10) return "high";
  if (snaps >= 6) return "medium";
  return "low"; // 3–5
}

// --------------------------------------------------------------------------
// load data
// --------------------------------------------------------------------------

const ahPath = join(dataDir, "ah-history.json");
const tokenPath = join(dataDir, "token-history.json");

if (needAh && !existsSync(ahPath))
  fail(`missing ${ahPath} — run the dashboard backend once to populate .data/`);
if (needToken && !existsSync(tokenPath))
  fail(`missing ${tokenPath} — run the dashboard backend once to populate .data/`);

// AH history, filtered to scope immediately so we never materialise all 123k keys.
const byItem = new Map<number, AhSnapshot[]>();
let ahKeysInScope = 0;
let freshestT = 0; // unix seconds

if (needAh) {
  const ah = JSON.parse(readFileSync(ahPath, "utf8")) as Record<string, AhSnapshot[]>;
  const prefix = scope === "commodities" ? `${region}:c:` : `${region}:${realmId}:`;
  for (const key in ah) {
    if (!key.startsWith(prefix)) continue;
    ahKeysInScope++;
    const itemId = Number(key.slice(prefix.length));
    if (!Number.isFinite(itemId)) continue;
    if (itemFilter && !itemFilter.has(itemId)) continue;
    const snaps = ah[key];
    if (!Array.isArray(snaps) || snaps.length === 0) continue;
    const sorted = snaps.slice().sort((a, b) => a.t - b.t);
    byItem.set(itemId, sorted);
    const lastT = sorted[sorted.length - 1].t;
    if (lastT > freshestT) freshestT = lastT;
  }
}

// WoW Token series for the region (t in milliseconds).
let tokenSeries: TokenPoint[] = [];
if (needToken) {
  const tok = JSON.parse(readFileSync(tokenPath, "utf8")) as Record<string, TokenPoint[]>;
  tokenSeries = (tok[region] ?? []).slice().sort((a, b) => a.t - b.t);
}

// --------------------------------------------------------------------------
// analysis 1 — flip / arbitrage
// --------------------------------------------------------------------------

type FlipRow = {
  itemId: number;
  name: string;
  minNow: number;
  medianNow: number;
  recentHigh: number;
  edgePct: number;
  estMarginGold: number;
  listings: number;
  total: number;
  score: number;
  confidence: Confidence;
};

function computeFlips(): FlipRow[] {
  const rows: FlipRow[] = [];
  for (const [itemId, snaps] of byItem) {
    if (snaps.length < minSnapshots) continue;
    const last = snaps[snaps.length - 1];
    if (last.listings < minListings) continue;
    if (last.total < 2 * last.listings) continue; // filters single-stack fake liquidity
    if (last.min < minPrice || last.median <= 0) continue;

    const recentHigh = Math.max(...snaps.map(s => s.min));
    const discVsMedian = (last.median - last.min) / last.median;
    const discVsHigh = recentHigh > 0 ? (recentHigh - last.min) / recentHigh : 0;
    const edge = Math.max(discVsMedian, discVsHigh);
    if (edge < 0.15) continue; // need ≥15% headroom

    const estMargin = edge * last.min;
    const liquidity = last.listings * Math.log1p(last.total);
    const score = estMargin * liquidity;

    rows.push({
      itemId,
      name: `#${itemId}`,
      minNow: round(last.min, 2),
      medianNow: round(last.median, 2),
      recentHigh: round(recentHigh, 2),
      edgePct: round(edge * 100, 1),
      estMarginGold: round(estMargin, 2),
      listings: last.listings,
      total: last.total,
      score: round(score, 1),
      confidence: itemConfidence(snaps.length),
    });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, top);
}

// --------------------------------------------------------------------------
// analysis 2 — trend / momentum
// --------------------------------------------------------------------------

type TrendRow = {
  itemId: number;
  name: string;
  lastMin: number;
  slopePerHour: number;
  pctChangePct: number;
  support: number;
  resistance: number;
  signal: "BUY" | "SELL" | "NEUTRAL";
  confidence: Confidence;
};

function computeTrends(): TrendRow[] {
  const rows: TrendRow[] = [];
  for (const [itemId, snaps] of byItem) {
    if (snaps.length < minSnapshots) continue;
    const last = snaps[snaps.length - 1];
    if (last.min < minPrice) continue; // % moves on penny items are noise
    const mins = snaps.map(s => s.min);

    // Robust trend: median of the first half vs median of the last half. A single
    // garbage snapshot (e.g. one 1-copper listing) can't blow the ratio up the way
    // a raw first-vs-last would (it produced "+34,000,000%" on real data).
    const halfIdx = Math.max(1, Math.floor(snaps.length / 2));
    const baseline = median(mins.slice(0, halfIdx));
    const recent = median(mins.slice(-halfIdx));
    if (baseline <= 0) continue;
    const pctChange = (recent - baseline) / baseline;

    const slopePerHour = slope(
      snaps.map(s => s.t / 3600), // seconds → hours
      mins
    );

    // 24h support/resistance, mirroring MarketStats; fall back to the full series
    const dayCut = last.t - 86400;
    const day = snaps.filter(s => s.t >= dayCut);
    const win = day.length > 0 ? day : snaps;
    const support = Math.min(...win.map(s => s.min));
    const resistance = Math.max(...win.map(s => s.min));

    const conf = itemConfidence(snaps.length);
    let signal: TrendRow["signal"] = "NEUTRAL";
    // a strong BUY/SELL needs ≥6 snapshots (medium/high confidence) AND a plausible
    // move: 8%–300%. Beyond 300% the thin series has a bad anchor, not a real trend.
    const plausible = Math.abs(pctChange) >= 0.08 && Math.abs(pctChange) <= 3;
    if (conf !== "low" && plausible) {
      if (pctChange <= -0.08 && last.min <= support * 1.05) signal = "BUY";
      else if (pctChange >= 0.08 && last.min >= resistance * 0.95) signal = "SELL";
    }

    rows.push({
      itemId,
      name: `#${itemId}`,
      lastMin: round(last.min, 2),
      slopePerHour: round(slopePerHour, 4),
      pctChangePct: round(pctChange * 100, 1),
      support: round(support, 2),
      resistance: round(resistance, 2),
      signal,
      confidence: conf,
    });
  }
  // actionable rows first, then by magnitude of move
  return rows
    .sort((a, b) => {
      const aw = a.signal === "NEUTRAL" ? 0 : 1;
      const bw = b.signal === "NEUTRAL" ? 0 : 1;
      if (aw !== bw) return bw - aw;
      return Math.abs(b.pctChangePct) - Math.abs(a.pctChangePct);
    })
    .slice(0, top);
}

// --------------------------------------------------------------------------
// analysis 3 — WoW Token timing
// --------------------------------------------------------------------------

type TokenResult = {
  region: Region;
  current: number;
  ma: number;
  lo: number;
  hi: number;
  percentilePct: number;
  trendPct: number;
  windowDays: number;
  // token price is the GOLD cost of one token: cheap (low) → spend gold on game
  // time; expensive (high) → convert a token to gold.
  recommendation: "BUY TOKEN WITH GOLD" | "SELL TOKEN FOR GOLD" | "HOLD";
  confidence: Confidence;
} | null;

function computeToken(): TokenResult {
  if (tokenSeries.length < 2) return null;
  const prices = tokenSeries.map(p => p.price);
  const current = prices[prices.length - 1];
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const ma = mean(prices);
  const percentile = hi === lo ? 0.5 : (current - lo) / (hi - lo);
  const first = tokenSeries[0];
  const trend = first.price > 0 ? (current - first.price) / first.price : 0;
  const windowDays = (tokenSeries[tokenSeries.length - 1].t - first.t) / 86_400_000; // t in ms

  let recommendation: NonNullable<TokenResult>["recommendation"] = "HOLD";
  if (percentile <= 0.3 && current < ma) recommendation = "BUY TOKEN WITH GOLD";
  else if (percentile >= 0.7 && current > ma) recommendation = "SELL TOKEN FOR GOLD";

  const confidence: Confidence = windowDays >= 7 ? "high" : windowDays >= 3 ? "medium" : "low";

  return {
    region,
    current: round(current, 0),
    ma: round(ma, 0),
    lo: round(lo, 0),
    hi: round(hi, 0),
    percentilePct: round(percentile * 100, 1),
    trendPct: round(trend * 100, 1),
    windowDays: round(windowDays, 2),
    recommendation,
    confidence,
  };
}

// --------------------------------------------------------------------------
// analysis 4 — liquidity & volatility (risk)
// --------------------------------------------------------------------------

type RiskRow = {
  itemId: number;
  name: string;
  cvPct: number;
  depth: number;
  stockTurns: number;
  spreadPct: number;
  riskScore: number;
  riskBand: "low" | "med" | "high";
  suggestedListGold: number;
  note: string;
  confidence: Confidence;
};

function computeRisk(): RiskRow[] {
  const rows: RiskRow[] = [];
  for (const [itemId, snaps] of byItem) {
    if (snaps.length < minSnapshots) continue;
    const last = snaps[snaps.length - 1];
    if (last.min <= 0 || last.median <= 0) continue;

    const mins = snaps.map(s => s.min);
    const m = mean(mins);
    const cv = m > 0 ? stdev(mins) / m : 0; // coefficient of variation = volatility
    const depth = last.listings;
    const stockTurns = last.listings > 0 ? last.total / last.listings : 0;
    const spread = (last.median - last.min) / last.median;

    const riskScore = clamp(
      100 *
        (0.5 * Math.min(cv / 0.4, 1) +
          0.3 * (1 - Math.min(depth / 30, 1)) +
          0.2 * Math.min(Math.max(spread, 0) / 0.3, 1))
    );
    const riskBand: RiskRow["riskBand"] =
      riskScore >= 66 ? "high" : riskScore >= 33 ? "med" : "low";

    // undercut by ~0.5% — see references/methodology.md. For >=1g items the
    // undercut floor is 1g; for sub-1g commodities undercut by 5% instead so the
    // suggestion doesn't collapse to 0.
    const undercut = last.min >= 1 ? Math.max(1, Math.round(last.min * 0.005)) : last.min * 0.05;
    const suggestedList = Math.max(0, last.min - undercut);
    const note = spread < 0.02 ? "thin spread — undercut war likely" : "";

    rows.push({
      itemId,
      name: `#${itemId}`,
      cvPct: round(cv * 100, 1),
      depth,
      stockTurns: round(stockTurns, 1),
      spreadPct: round(spread * 100, 1),
      riskScore: round(riskScore, 0),
      riskBand,
      suggestedListGold: round(suggestedList, 2),
      note,
      confidence: itemConfidence(snaps.length),
    });
  }
  // deepest (most tradeable) markets first — sorting by riskScore ascending would
  // just surface degenerate cv=0 items (no observed variance on 2 thin snapshots,
  // which is missing data, not genuine safety).
  return rows.sort((a, b) => b.depth - a.depth).slice(0, top);
}

// --------------------------------------------------------------------------
// run analyses
// --------------------------------------------------------------------------

const flips = analyses.has("flip") ? computeFlips() : [];
const trends = analyses.has("trend") ? computeTrends() : [];
const token = analyses.has("token") ? computeToken() : null;
const risk = analyses.has("risk") ? computeRisk() : [];

// --------------------------------------------------------------------------
// name resolution (best-effort against :8788)
// --------------------------------------------------------------------------

const idSet = new Set<number>();
for (const r of flips) idSet.add(r.itemId);
for (const r of trends) idSet.add(r.itemId);
for (const r of risk) idSet.add(r.itemId);
const ids = [...idSet];

let apiAvailable = false;
let realmName: string | null = null;

if (!noApi) {
  if (ids.length > 0) {
    const resolved = await resolveItemNames(apiBase, region, ids);
    apiAvailable = resolved.apiAvailable;
    for (const r of flips) r.name = resolved.names.get(r.itemId) ?? `#${r.itemId}`;
    for (const r of trends) r.name = resolved.names.get(r.itemId) ?? `#${r.itemId}`;
    for (const r of risk) r.name = resolved.names.get(r.itemId) ?? `#${r.itemId}`;
  }
  if (scope === "realm" && realmId != null) {
    realmName = await resolveRealmName(apiBase, region, realmId);
  }
}

// --------------------------------------------------------------------------
// warnings + meta
// --------------------------------------------------------------------------

const warnings: string[] = [];

if (needAh && byItem.size === 0) {
  warnings.push(
    `no items in scope for region ${region} (${scope === "realm" ? `realm ${realmId} — only realms subscribed in the dashboard have data` : "commodities"})`
  );
} else if (needAh) {
  const avgSnaps = mean([...byItem.values()].map(s => s.length));
  if (avgSnaps < 8)
    warnings.push(
      `ah-history is thin (avg ${round(avgSnaps, 1)} snapshots/item) — item signals are low-confidence`
    );
}

if (needToken) {
  if (tokenSeries.length < 2) warnings.push(`no WoW Token history for region ${region}`);
  else {
    const wd = (tokenSeries[tokenSeries.length - 1].t - tokenSeries[0].t) / 86_400_000;
    if (wd < 3)
      warnings.push(`token history window is short (${round(wd, 1)}d) — token timing is low-confidence`);
  }
}

if (!noApi && !apiAvailable && ids.length > 0)
  warnings.push(`proxy at ${apiBase} unreachable — item names shown as #itemId`);
if (noApi && ids.length > 0) warnings.push(`--no-api set — item names shown as #itemId`);

const nowSec = Date.now() / 1000;
const meta = {
  region,
  scope,
  realmId: realmId ?? null,
  realmName,
  generatedAt: new Date().toISOString(),
  apiAvailable,
  analyses: [...analyses],
  ahKeysInScope,
  itemsAnalyzed: byItem.size,
  ahFileAgeHours: freshestT > 0 ? round((nowSec - freshestT) / 3600, 1) : null,
  tokenWindowDays:
    tokenSeries.length > 1
      ? round((tokenSeries[tokenSeries.length - 1].t - tokenSeries[0].t) / 86_400_000, 2)
      : null,
};

// --------------------------------------------------------------------------
// output
// --------------------------------------------------------------------------

type Result = {
  meta: typeof meta;
  warnings: string[];
  flips?: FlipRow[];
  trends?: TrendRow[];
  token?: TokenResult;
  risk?: RiskRow[];
};

const result: Result = { meta, warnings };
if (analyses.has("flip")) result.flips = flips;
if (analyses.has("trend")) result.trends = trends;
if (analyses.has("token")) result.token = token;
if (analyses.has("risk")) result.risk = risk;

function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map(r => `| ${r.join(" | ")} |`).join("\n");
  return [head, sep, body].join("\n");
}

function toMarkdown(r: Result): string {
  const L: string[] = [];
  const m = r.meta;
  const scopeLabel =
    m.scope === "realm" ? ` · ${m.realmName ?? `realm ${m.realmId}`}` : " · commodities";
  L.push(`# WoW Market Analysis — ${m.region.toUpperCase()}${scopeLabel}`);
  L.push(
    `_${m.generatedAt} · ${m.itemsAnalyzed}/${m.ahKeysInScope} items · AH age ${
      m.ahFileAgeHours ?? "?"
    }h · token window ${m.tokenWindowDays ?? "?"}d · names ${
      m.apiAvailable ? "resolved" : "unavailable (#id)"
    }_`
  );
  if (r.warnings.length) L.push("", r.warnings.map(w => `> ⚠ ${w}`).join("\n"));

  if (r.flips) {
    L.push("", "## Flips / arbitrage");
    L.push(
      r.flips.length
        ? table(
            ["item", "min", "median", "recentHigh", "edge%", "est.margin", "listings", "stock", "conf"],
            r.flips.map(f => [
              f.name,
              f.minNow,
              f.medianNow,
              f.recentHigh,
              f.edgePct,
              f.estMarginGold,
              f.listings,
              f.total,
              f.confidence,
            ])
          )
        : "_no qualifying flips in scope._"
    );
  }
  if (r.trends) {
    L.push("", "## Trend / momentum");
    L.push(
      r.trends.length
        ? table(
            ["item", "min", "Δ%", "slope/h", "support", "resistance", "signal", "conf"],
            r.trends.map(t => [
              t.name,
              t.lastMin,
              t.pctChangePct,
              t.slopePerHour,
              t.support,
              t.resistance,
              t.signal,
              t.confidence,
            ])
          )
        : "_no items with enough history._"
    );
  }
  if (r.token) {
    const t = r.token;
    L.push("", "## WoW Token timing");
    L.push(
      t
        ? `**${t.recommendation}** — current ${t.current}g · MA ${t.ma}g · range ${t.lo}–${t.hi}g · ` +
            `percentile ${t.percentilePct}% · trend ${t.trendPct}% · window ${t.windowDays}d · conf ${t.confidence}`
        : "_no token history._"
    );
  }
  if (r.risk) {
    L.push("", "## Liquidity & volatility (risk)");
    L.push(
      r.risk.length
        ? table(
            ["item", "cv%", "depth", "turns", "spread%", "risk", "band", "suggestList", "note", "conf"],
            r.risk.map(x => [
              x.name,
              x.cvPct,
              x.depth,
              x.stockTurns,
              x.spreadPct,
              x.riskScore,
              x.riskBand,
              x.suggestedListGold,
              x.note || "—",
              x.confidence,
            ])
          )
        : "_no items with enough history._"
    );
  }
  L.push("", "_Advisory only — execute trades in-game; the Blizzard API is read-only._");
  return L.join("\n");
}

process.stdout.write(format === "markdown" ? toMarkdown(result) + "\n" : JSON.stringify(result, null, 2) + "\n");
