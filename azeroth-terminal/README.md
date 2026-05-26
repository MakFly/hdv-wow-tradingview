# Azeroth Terminal — WoW Auction House & WoW Token Market Dashboard

A TradingView-style market terminal for the **World of Warcraft economy**. Track
**WoW Token** prices, **Auction House** commodity trends, top movers and your own
watchlist in real time — powered by the official Blizzard Battle.net API.

> **HdV WoW TradingView** — *HdV (Hôtel des Ventes)* is the French name for the
> in-game Auction House. This project brings a trader's chart view to it.

![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646cff?logo=vite&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-4-e36002?logo=hono&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-runtime-000000?logo=bun&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss&logoColor=white)

---

## Features

- 📈 **TradingView-style price charts** — candlestick / line history for any
  tracked item, built on [`lightweight-charts`](https://github.com/tradingview/lightweight-charts).
- 🪙 **WoW Token ticker** — live WoW Token price with historical chart, for every
  region (US / EU / KR / TW).
- 🏷️ **Auction House market table** — region-wide commodity prices (ore, herbs,
  leather, cloth, gems, enchants, consumables…) and per-realm gear / BoE listings.
- 🚀 **Top movers** — biggest gainers and losers between Auction House regenerations.
- ⭐ **Watchlist** — pin the items you care about; persisted locally, sharable via URL.
- ⚡ **Live updates over SSE** — the backend streams fresh data as Blizzard
  publishes it; no manual refresh.
- 🌍 **Internationalisation** — English & French out of the box (`react-i18next`).
- 🤖 **Bundled Claude skill** — `wow-market-analyst` analyses the collected data
  for flips, trends and Token timing (advisory only — see below).

## Tech stack

| Layer    | Stack                                                                   |
| -------- | ----------------------------------------------------------------------- |
| Frontend | React 19 · TypeScript · Vite 7 · Tailwind CSS 4 · shadcn/ui · lightweight-charts |
| Backend  | Hono · Bun runtime · Server-Sent Events                                 |
| Storage  | SQLite (`bun:sqlite`) — PostgreSQL migration path reserved               |
| Data     | Official [Blizzard Battle.net API](https://develop.battle.net/)          |

## Architecture

```
┌────────────┐   SSE    ┌──────────────┐   OAuth + REST   ┌──────────────────┐
│  React SPA │ ◀──────▶ │  Hono proxy  │ ◀──────────────▶ │  Blizzard API    │
│  (Vite)    │   :5173  │  (Bun) :8788 │                  │  WoW Token + AH  │
└────────────┘          └──────┬───────┘                  └──────────────────┘
                               │ polls Token (~5 min) + AH (~15 min)
                               ▼
                        ┌──────────────┐
                        │ SQLite + JSON│  .data/  (gitignored)
                        │   history    │
                        └──────────────┘
```

The Hono proxy holds the Battle.net OAuth token, polls the WoW Token and Auction
House feeds, honours `Last-Modified` so most polls are cheap no-ops, persists a
rolling history to `.data/`, and fans out updates to every connected browser
over SSE.

## Getting started

### Prerequisites

- [Bun](https://bun.sh/) — used for both the dev server and the API runtime.
- Blizzard Battle.net API credentials — create a client at
  [develop.battle.net/access/clients](https://develop.battle.net/access/clients).

### Installation

```bash
git clone git@github.com:MakFly/hdv-wow-tradingview.git
cd hdv-wow-tradingview
bun install
```

### Configuration

Copy the example environment file and fill in your Battle.net credentials:

```bash
cp .env.example .env
```

```dotenv
# Blizzard Battle.net API credentials (required)
BNET_CLIENT_ID=your_client_id
BNET_CLIENT_SECRET=your_client_secret

# Optional — defaults shown
PORT=8788
DB_PROVIDER=sqlite
SQLITE_PATH=.data/azeroth-terminal.sqlite
POLL_TOKEN_SEC=300   # WoW Token poll interval
POLL_AH_SEC=900      # Auction House poll interval
```

> `.env` and the `.data/` directory are gitignored — your credentials and the
> local market history never leave your machine.

### Run

```bash
bun run dev        # web (Vite :5173) + API (Hono :8788) together
bun run dev:web    # frontend only
bun run dev:api    # backend proxy only
```

Open <http://localhost:5173>.

### Build

```bash
bun run build      # type-check + production build
bun run preview    # preview the production build
```

## Scripts

| Script              | Description                                  |
| ------------------- | -------------------------------------------- |
| `bun run dev`       | Run the web app and API proxy concurrently   |
| `bun run dev:web`   | Vite dev server only                         |
| `bun run dev:api`   | Hono API proxy only (Bun, watch mode)        |
| `bun run build`     | Type-check (`tsc -b`) and build with Vite    |
| `bun run preview`   | Serve the production build locally           |
| `bun run lint`      | Lint with ESLint                             |
| `bun run format`    | Format with Prettier                         |
| `bun run typecheck` | Type-check without emitting                  |

## API reference

The Hono proxy exposes a small REST + SSE surface on `:8788`:

| Method | Endpoint                       | Description                                   |
| ------ | ------------------------------ | --------------------------------------------- |
| `GET`  | `/api/health`                  | Health check + connected-client count         |
| `GET`  | `/api/stream`                  | Server-Sent Events stream of live market data |
| `POST` | `/api/subscribe`               | Subscribe a client to a realm / item set      |
| `GET`  | `/api/realms?region=<region>`  | List connected realms for a region            |
| `GET`  | `/api/items/search?q=<query>`  | Search items by name                          |
| `GET`  | `/api/item/:id`                | Fetch a single item's market snapshot         |

## WoW Market Analyst (Claude skill)

This repo ships a [Claude Code](https://claude.com/claude-code) skill,
`wow-market-analyst`, under `.claude/skills/`. It reads the local
`.data/*.json` history and advises on **flips / arbitrage**, **price trends &
momentum**, **WoW Token timing** and **liquidity risk**.

It is **advisory only** — Blizzard's API is read-only, so the skill cannot place
trades. It tells you *what* to act on; you execute it **in-game** (or via an
addon like TradeSkillMaster).

## Disclaimer

This is an unofficial, fan-made tool. *World of Warcraft* and *Battle.net* are
trademarks of Blizzard Entertainment, Inc. This project is not affiliated with
or endorsed by Blizzard Entertainment.

## License

No license file is currently provided. All rights reserved by the author until a
license is added.
