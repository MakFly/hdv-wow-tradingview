# Azeroth Terminal — WoW real-time economy dashboard
# React + Vite + shadcn frontend, Bun proxy backend (Blizzard Battle.net API)

APP := azeroth-terminal
BUN := bun

.DEFAULT_GOAL := help

## ── Setup ───────────────────────────────────────────────────────────

.PHONY: install
install: ## Install dependencies (bun install)
	cd $(APP) && $(BUN) install

.PHONY: env
env: ## Create .env from .env.example if missing
	@if [ ! -f $(APP)/.env ]; then \
		cp $(APP)/.env.example $(APP)/.env; \
		echo "Created $(APP)/.env — fill in BNET_CLIENT_ID / BNET_CLIENT_SECRET"; \
	else \
		echo "$(APP)/.env already exists"; \
	fi

.PHONY: setup
setup: install env ## Full first-time setup (install + env)

## ── Dev ─────────────────────────────────────────────────────────────

.PHONY: dev
dev: ## Run web + api together (hot reload)
	cd $(APP) && $(BUN) run dev

.PHONY: web
web: ## Run only the Vite frontend (port 5173)
	cd $(APP) && $(BUN) run dev:web

.PHONY: api
api: ## Run only the Bun proxy backend (port 8788)
	cd $(APP) && $(BUN) run dev:api

## ── Build / QA ──────────────────────────────────────────────────────

.PHONY: build
build: ## Production build (tsc + vite build)
	cd $(APP) && $(BUN) run build

.PHONY: preview
preview: ## Preview the production build
	cd $(APP) && $(BUN) run preview

.PHONY: typecheck
typecheck: ## TypeScript type-check, no emit
	cd $(APP) && $(BUN) run typecheck

.PHONY: lint
lint: ## Run eslint
	cd $(APP) && $(BUN) run lint

.PHONY: format
format: ## Format with prettier
	cd $(APP) && $(BUN) run format

.PHONY: check
check: typecheck lint ## Run typecheck + lint

## ── Housekeeping ────────────────────────────────────────────────────

.PHONY: clean
clean: ## Remove build output and persisted history
	rm -rf $(APP)/dist $(APP)/.data $(APP)/node_modules/.vite

.PHONY: distclean
distclean: clean ## clean + remove node_modules
	rm -rf $(APP)/node_modules

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
