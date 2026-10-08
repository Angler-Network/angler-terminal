# Developing Angler Terminal

Angler Terminal is a Next.js (App Router) app in TypeScript, styled with Tailwind CSS 4. This page covers running it
locally, configuration and the project layout. For what the app does, see the [README](../README.md).

## Run it locally

Requirements: Node.js 20+ and npm.

```bash
git clone https://github.com/Angler-Network/angler-terminal.git
cd angler-terminal
npm install
cp .env.example .env.local   # fill in what you need
npm run dev                  # http://localhost:3000
```

The only required value is `ANGLER_API_KEY`, for the news feed. Every venue is optional: leave its variables empty and
it stays off or uses public defaults. `.env.example` lists and explains every variable. Never commit a real `.env`
file: the repository is public.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit tests (Vitest, `*.test.ts` next to each module) |
| `npm run typecheck` | TypeScript checks |
| `scripts/build-lighter-signer.sh` | Rebuilds Lighter's official WASM signer into `public/lighter/` from a pinned commit |

`npm test`, `npm run typecheck` and `npm run build` must pass before a pull request. Unit tests cover the pure logic
(pricing, order math, routing, funding, parsers, error mapping, storage); the venue API parsers run against real
response samples in each module's `fixtures/` folder.

## How it works

```
Browser ──WebSocket──▶ Hyperliquid, Lighter, Aster, Orderly   order books, trades, positions
        ──WebSocket──▶ Angler News                              raw + AI-enriched news
        ──HTTPS─────▶ Next.js route handlers ──▶ Angler API, Jupiter, Titan, Uniswap, Relay, LI.FI, Across,
                                                 Arcus, Polymarket, RPCs (API keys and partner fees added here)
```

- The browser talks to the venues directly for market data and signed orders. Server route handlers (`app/api/*`)
  only add API keys and partner fees, and cache shared data such as market lists and funding rates.
- Server secrets are read only by route handlers. Anything prefixed `NEXT_PUBLIC_` is bundled into the browser, so
  never put a secret there.
- Trading keys (Hyperliquid, Lighter, Aster, Orderly) are generated in the browser and used only to sign there; they
  are never logged or sent anywhere.

## Mainnet and testnet sites

One codebase runs both sites as two Vercel projects on the same repository and branch:

| Site | `NEXT_PUBLIC_DEPLOYMENT` | What it does |
| --- | --- | --- |
| trade.angler.network | `mainnet` | Every configured venue on mainnet |
| testnet-trade.angler.network | `testnet` | Every venue on testnet with in-app faucets; mainnet-only venues off |

`NEXT_PUBLIC_DEPLOYMENT` pins every venue's network. On mainnet, a venue is offered only once its settings are present
(for example a builder address for Hyperliquid, an API key for Jupiter); redeploy after adding one, since
`NEXT_PUBLIC_*` values are inlined at build time. Set `NEXT_PUBLIC_OTHER_DEPLOYMENT_URL` on each project to link to
the other site.

### Testnet funds

- Hyperliquid: [app.hyperliquid-testnet.xyz/drip](https://app.hyperliquid-testnet.xyz/drip)
- Lighter: **Get test USDC** in the account panel or the funds window opens a testnet account with test USDC.
- Arcus: test ETH from [faucet.testnet.chain.robinhood.com](https://faucet.testnet.chain.robinhood.com), then
  **Mint mUSDG** in the account panel's Arcus section.

Jupiter, Titan and Uniswap have no testnet: use a dedicated wallet with a few dollars, and never place mainnet orders
from tests or scripts.

## Project layout

```
app/                    pages and API route handlers
  (terminal)/           /perp, /swap and /spot, sharing one terminal shell
  prediction/           prediction markets
  profile/              profile, portfolio, leaderboard
  markets/  settings/   markets table, settings pages
components/
  app/                  shell: top bar, sidebar, settings, onboarding, wallets, ticker tape
  terminal/             chart column, order panels, swap cards, order book, positions, funds window
  news/                 news feed and cards
  prediction/  profile/  markets/  portfolio/  chart/
lib/
  angler/               Angler News API types, parsers and the realtime feed
  venues/               one folder per venue (hyperliquid, lighter, aster, orderly, jupiter, titan, uniswap,
                        arcus, polymarket, aggregators) plus bridges (across, relay, lifi)
  trading/              execution, funding, order math, order book, TP/SL
  spot/  prediction/  profile/  news/  analytics/  chart/  layout/
docs/                   integration notes (Lighter)
```

`CLAUDE.md` holds detailed architecture notes for each integration.
