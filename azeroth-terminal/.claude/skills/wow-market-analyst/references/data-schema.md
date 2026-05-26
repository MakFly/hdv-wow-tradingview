# Data schema reference — wow-market-analyst

The analysis script reads two persisted files written by the dashboard backend,
and optionally calls the local proxy for names. The unit/timestamp traps below
are the main source of bugs — they are handled in `analyze.ts`, documented here
so they aren't re-derived.

## `.data/token-history.json`

WoW Token price history, keyed by region.

```json
{
  "us": [ { "t": 1778748662000, "price": 278542 }, ... ],
  "eu": [ ... ], "kr": [ ... ], "tw": [ ... ]
}
```

- `t` — unix timestamp in **MILLISECONDS**.
- `price` — token price in **GOLD** (the backend already divided Blizzard's
  copper value by 10000).
- Intended retention ~90 days; **observed in current data ≈ 0.4 day** — token
  timing is therefore usually `low` confidence.

## `.data/ah-history.json`

Auction-house snapshot history. ~44 MB, ~123k keys. `JSON.parse` ≈ 0.4 s — fine,
no streaming needed, but **filter to scope immediately** after parse.

Key format:
- `"${region}:c:${itemId}"` — region-wide **commodities** (ore, herbs, leather,
  cloth, gems, flasks, enchants, consumables…). ~10–12k keys per active region.
- `"${region}:${connectedRealmId}:${itemId}"` — per-connected-realm **gear / BoE /
  pets**. Only realms that were *subscribed in the dashboard UI* have data.

Value — array of snapshots, oldest-first is **not** guaranteed (sort by `t`):

```json
[ { "t": 1778749134, "min": 307.79, "median": 477, "total": 23013, "listings": 3119 }, ... ]
```

- `t` — unix timestamp in **SECONDS** (note: differs from token history's ms).
- `min` — lowest unit buyout in **GOLD**.
- `median` — median unit price across all listings in **GOLD**.
- `total` — total quantity listed across all auctions.
- `listings` — number of distinct auctions.
- Intended retention 600 snapshots/item; **observed ≈ 2–7 snapshots/item** — thin
  history is the norm, every item signal is gated and confidence-labelled.

## Local proxy API (`http://localhost:8788`) — names only, optional

The `.data` files carry only numeric itemIds. Human names need the running
backend. The script probes `/api/health` (1.5 s timeout); if down, every name
falls back to `#<itemId>` and `meta.apiAvailable` is `false`.

- `GET /api/health` → `{ ok, authConfigured, clients }`
- `GET /api/item/{id}?region=` → `{ id, name, quality:{type,name}, item_class,
  item_subclass, sell_price (COPPER — ÷10000 for gold), icon }`
- `GET /api/realms?region=` → `[{ id, name, slug, status, population, region }]`
- `GET /api/items/search?region=&q=&lang=` → `{ results: [{id,name,quality}] }`

## Unit & timestamp traps

| Source | timestamp | price |
| --- | --- | --- |
| `ah-history.json` | seconds | **gold** |
| `token-history.json` | **milliseconds** | gold |
| API `sell_price` | — | **copper** (÷10000) |

## Scope

There are ~123k keys. **Always** filter by `region` + `scope` (string-prefix
test) before any computation. `--scope commodities` is the default and the
highest-liquidity market; `--scope realm --realm <crId>` for gear.
