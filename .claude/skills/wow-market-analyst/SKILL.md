---
name: wow-market-analyst
description: >-
  Analyzes World of Warcraft auction-house and WoW Token market data to advise on
  gold-making — flip/arbitrage opportunities, price trend & momentum signals, WoW
  Token buy/sell timing, and liquidity/volatility risk. Use whenever the user asks
  what to buy, sell, or flip in the WoW economy, asks about auction-house prices or
  market trends, asks about WoW Token timing, or which items are profitable. Reads
  the local .data/*.json history files (works offline) and resolves item/realm
  names via the local proxy at :8788 when it is running. Advisory only — it cannot
  place trades (the Blizzard API is read-only; the user executes moves in-game).
allowed-tools:
  - Bash(bun .claude/skills/wow-market-analyst/scripts/analyze.ts:*)
  - Read(.data/**)
  - Read(.claude/skills/wow-market-analyst/references/**)
user-invocable: true
---

# WoW Market Analyst

Advise on WoW gold-making from the dashboard's collected market data. This skill
**cannot trade** — Blizzard's API is read-only. It tells the user *what* to act
on; they execute it **in-game** (or via an addon like TradeSkillMaster). State
this constraint in every response.

## When to use

Any request about: what to buy / sell / flip, auction-house prices, market
trends or momentum, WoW Token timing, which items are profitable, or trade risk.

## Prerequisites

Run from the project root (`app/azeroth-terminal/`). Confirm the data files
exist: `.data/ah-history.json` and `.data/token-history.json`. If either is
missing, tell the user to start the dashboard backend once (`make api` or
`bun run dev:api`) to populate `.data/`, then stop.

The `:8788` proxy is **optional** — it only resolves item/realm names. If it is
down, results still compute; names just show as `#<itemId>`. Mention this once.

## Choosing scope (important — there are ~123k keys)

- `--region` is **required**: `us` | `eu` | `kr` | `tw`.
- `--scope commodities` (default) — region-wide market (ore, herbs, leather,
  cloth, gems, enchants, consumables…). This is the deepest market and what most
  gold-makers trade. Start here.
- `--scope realm --realm <connectedRealmId>` — gear / BoE / pets on one realm.
  Only realms that were subscribed in the dashboard UI have data. To get the id,
  ask the user for their realm name and resolve it via the proxy:
  `GET http://localhost:8788/api/realms?region=<region>` → match `name` → use `id`.
- Token timing needs only `--region` (no scope).

## How to run

Always run with `--format json` and render the report yourself:

```
bun .claude/skills/wow-market-analyst/scripts/analyze.ts --region us --scope commodities --top 15 --format json
```

Flags: `--region` (req) · `--scope commodities|realm` · `--realm <id>` ·
`--analyses flip,trend,token,risk` (subset, default all) · `--top 15` ·
`--min-listings 5` · `--min-snapshots 2` · `--min-price 1` (gold floor for
flips/trends) · `--item <ids>` (deep-dive a specific item) · `--no-api` (skip
name resolution) · `--data-dir <path>` · `--api-base <url>`.

The script emits one JSON object: `{ meta, warnings, flips[], trends[], token,
risk[] }`. Every row carries a `confidence` of `high` | `medium` | `low`.

## How to present results

Render up to four compact markdown tables — **Flips / arbitrage**, **Trend /
momentum**, **WoW Token timing**, **Liquidity & risk** — from the JSON, then add
2–4 sentences of interpretation per section drawn from `references/methodology.md`.

Rules:
- Surface every `warnings[]` entry up front (thin history, short token window,
  proxy down, empty scope).
- Always show the `confidence` label. **Never** present a `low`-confidence row as
  a firm recommendation — the live history is thin (often 2–7 snapshots/item).
- Note `meta.ahFileAgeHours` — if the data is several hours old, caveat the advice.
- Cross-reference: an item in **flips** with `low`/`med` **risk** and a non-`SELL`
  **trend** is a strong buy candidate. A **token** `SELL` while the user holds
  tokens (or `BUY` while gold-rich) is the only genuine arbitrage — call it out.
- End every response with: advisory only, data is ~hours stale, execute in-game.

## Going deeper

For the *why* — what makes a good flip, undercut math, reading token cycles, the
risk-score rubric, confidence thresholds — read `references/methodology.md`.
For exact data shapes and the unit/timestamp traps, see `references/data-schema.md`.
Read these when the user wants strategy depth, not for a routine report.
