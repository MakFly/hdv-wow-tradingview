# Methodology — wow-market-analyst

How the four analyses work, how to read them, and the gold-making heuristics
behind them. Read this when the user wants the *why* or a deeper strategy
discussion; the formulas themselves live in `scripts/analyze.ts`.

## The read-only constraint (state this every time)

Blizzard's Battle.net API is **read-only** — it serves ~hourly auction snapshots
and has no endpoint to post, buy, or cancel auctions. Trade execution exists only
through the in-game Lua API (`C_AuctionHouse.*`), usable only by in-game addons
(TradeSkillMaster, Auctionator…). So this skill is an **advisor**: it tells the
user *what* to act on; they execute it **in-game**. Never imply a trade happened.

The one genuine money instrument is the **WoW Token** — it converts gold ↔ real
money / game time, and its gold price is a real, tradeable signal.

## Confidence labels

Driven by snapshot count per item (history is thin — usually 2–7 snapshots):
- `high` ≥ 10 snapshots · `medium` 6–9 · `low` 3–5 (and the 2-snapshot floor).
- A **strong BUY/SELL trend signal requires ≥ 6 snapshots** (`medium`+). `low`
  rows are reported but forced to `NEUTRAL`.
- Token confidence is by window length: `high` ≥ 7 d · `medium` ≥ 3 d · else `low`.
- Always surface the confidence label, and never push a `low`-confidence row as a
  firm recommendation.

## 1. Flip / arbitrage

A flip = buy the cheap listings now, relist higher. The script keeps an item only
when `listings ≥ --min-listings` (5), `total ≥ 2×listings` (filters single-stack
fake liquidity), `min ≥ --min-price` (1 g), and `edge ≥ 15%`, where
`edge = max((median − min)/median, (recentHigh − min)/recentHigh)`.
Ranked by `score = edge × min × (listings × ln(1+total))` — margin weighted by
market depth, so deep liquid markets rank above thin ones.

Reading it: `edgePct` is the headroom; `estMarginGold` is gross gold/unit. **Net**
is lower — the AH takes ~5% on sale, and you must actually resell into the same
demand. A high edge on a thin or `low`-confidence item is a trap (the "median"
may be two listings). Prefer `high` confidence + high `listings`/`total`.

## 2. Trend / momentum

`pctChange` = median of the first half of the price series vs median of the last
half — a robust comparison that a single 1-copper outlier snapshot can't blow up.
`slopePerHour` is the least-squares slope of `min` over time (informational).
24 h `support`/`resistance` = min/max of `min` over the last 24 h (mirrors the
dashboard's MarketStats).

Signal: `BUY` when the item fell ≥ 8% **and** is sitting near support (≤ 1.05×);
`SELL` when it rose ≥ 8% **and** is near resistance (≥ 0.95×). Only fires on a
plausible move (8–300%) at `medium`+ confidence; otherwise `NEUTRAL`. Treat
signals as "worth a look", not certainty — the history window is short.

## 3. WoW Token timing

The token's **gold price** is what's tracked. `percentile` = where the current
price sits in the observed range; `ma` = mean over the window.
- `BUY TOKEN WITH GOLD` — price low (`percentile ≤ 30%` and below MA): tokens are
  cheap in gold → good time to spend gold on game time / a token.
- `SELL TOKEN FOR GOLD` — price high (`percentile ≥ 70%` and above MA): a token
  converts to lots of gold → good time to cash a token out for gold.
- `HOLD` otherwise.
Current data windows are ~0.4 day → almost always `low` confidence; say so.

## 4. Liquidity & volatility (risk)

Per item: `cv` = stdev/mean of `min` (volatility), `depth` = current `listings`,
`stockTurns` = `total/listings`, `spread` = `(median − min)/median`.
`riskScore` (0–100) = `100 × (0.5·min(cv/0.4,1) + 0.3·(1−min(depth/30,1)) +
0.2·min(spread/0.3,1))`. Bands: `low` < 33 · `med` 33–65 · `high` ≥ 66.
Sorted by `depth` descending — the deepest, most-tradeable markets first.

**Undercut math:** `suggestedListGold` undercuts current `min` by ~0.5% (1 g floor
for ≥ 1 g items; 5% for sub-1 g). On a deep market a tiny undercut is enough; a
`note` of "thin spread — undercut war likely" means `spread < 2%` — relisting
there just races competitors to the floor, often not worth it.

Combine with the flip list: a high-margin flip on a `high`-risk item → take a
**small position**; high margin + `low` risk + deep market → the best plays.

## Workflow heuristics

1. Start with `--scope commodities` — region-wide, deepest, what most gold-makers
   trade. Use `--scope realm` for gear/BoE on a specific realm.
2. Cross-reference: an item that appears in **flips** *and* has `low`/`med` **risk**
   *and* a non-`SELL` **trend** is a strong buy candidate.
3. A **token** `SELL` while you're sitting on tokens, or `BUY` while you're
   gold-rich and want game time — act on it; it's the only real arbitrage.
4. Always end with: data is ~hours stale, signals are advisory, execute in-game.
