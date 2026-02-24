# eBay Shippable Market Arbitrage Bot

TypeScript monorepo that builds a hunt list of liquid SKUs and scans eBay Browse API for underpriced shippable deals.

## Prerequisites
- Node 20+
- pnpm 9+
- eBay developer keys (client id/secret)

## Setup
1. Copy `.env.example` to `.env` and fill in values.
2. Install deps: `pnpm i`
3. Run migrations: `pnpm db:migrate`
4. Generate Prisma client: `pnpm prisma:generate`
5. Typecheck: `pnpm typecheck`

Tip: keep `MOCK_EBAY_MODE=1` in `.env` for a no-API-key dry boot and operational checks.

## One-click install wizard UI

### Windows one-click launcher (.bat)

If you're on Windows, just double-click:

- `setup-wizard.bat`

Tip: keep the repo in a short path like `C:\bot\ebay` to avoid Windows path/tooling issues.

It will:
1. Check Node + pnpm
2. Create `.env` from `.env.example` if missing
3. Run install/migrate/typecheck
4. Open and launch the wizard UI at `http://localhost:4311`

If you want a simple UI to verify the bot is operational:

```bash
pnpm wizard:start
```

Then open `http://localhost:4311`.

From that page click **Run One-Click Setup**. It executes:
1. `pnpm i`
2. `pnpm db:migrate`
3. `pnpm typecheck`
4. `pnpm hunt:run`
5. `pnpm scan:run`

The page shows live logs and operational status (env file, db file, hunt runs, scan rows, alerts).

## Commands
- `pnpm hunt:run` recomputes hunt list and prints top 20.
- `pnpm scan:run` scans latest hunt list, scores deals, stores rows, sends alerts.
- `pnpm worker:start` starts scheduler loop (daily hunt refresh, 10 min scan).
- `pnpm wizard:start` launches the operational UI wizard.

## Config
- Runtime behavior: `config/runtime.json`
- Seed queries/categories: `config/seeds.yaml`
- Thresholds: `thresholds.minProfit`, `thresholds.minRoi`, `thresholds.maxRiskScore`
- Fee model and shipping/packaging costs are editable in runtime config.

## eBay API
Uses Buy Browse API `item_summary/search` with app OAuth token and required headers:
- `Authorization: Bearer <token>`
- `X-EBAY-C-MARKETPLACE-ID`
- `X-EBAY-C-ENDUSERCTX`

## Notes
- v1 supports eBay-only and shippable fixed-price listings.
- Sold-comps oracle is interface-ready; current default uses active-listing-derived robust p25 estimates.
- Dry run mode in `config/runtime.json` writes scores without sending alerts.
