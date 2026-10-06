# Angler Terminal

A multi-venue perp DEX terminal driven by real-time, AI-scored crypto news.

Trade Hyperliquid and Lighter perps, Solana tokens and tokenized stocks from one screen. The terminal picks the
cheapest venue for you, and every important headline turns into a one-tap trade on the asset it moves.

**Live:** [angler-terminal.vercel.app](https://angler-terminal.vercel.app) · **News:**
[news.angler.network](https://news.angler.network) · **News API:** [api.angler.network](https://api.angler.network/openapi.yaml)

> **Alpha.** The terminal runs on testnets by default. Mainnet trades use real funds. Not financial advice: news
> scores and predictions are model outputs.

## Features

- **Live news feed.** Headlines stream over WebSocket from the Angler News API and are scored by AI models:
  importance (0-100), sentiment (-1 to +1), predicted impact per asset and a short summary. Non-English news is
  shown translated to English. You can filter by asset, sentiment, severity and minimum impact, and get browser
  notifications for high-impact items.
- **What happened after similar news.** Important cards show how the asset moved 1h, 4h and 24h after its past news
  of the same impact over the last ~50 days, and how often it went up.
- **News rules.** "When bearish BTC news scores 80+, short $50" or "close my position on adverse news": rules
  watch the feed and alert you, open a perp position or close one, with a one-press prompt unless you make them
  automatic.
- **Trade from the news.** Important news about a tradable asset shows Long/Short size buttons. One press arms
  the order and a second press places it. The asset is resolved to the best venue that lists it. Keyboard
  shortcuts work too: `L` / `S`, `1`–`4`, `Enter`.
- **One order panel for every venue.** Market and limit orders, leverage, cross or isolated margin, reduce-only
  and TP/SL. A summary shows the estimated entry price, slippage, fees, margin, liquidation price and funding.
- **Merged order book and split orders.** See Hyperliquid and Lighter depth in one book, colored by venue, and
  split large market orders across both when that fills cheaper.
- **Best execution.** For market orders the terminal walks the live order books of both perp venues for your size,
  adds each venue's taker fees and routes to the cheaper one. This is on by default and can be turned off.
- **Funding.** Funding rates across Hyperliquid, Lighter, Binance and Bybit, a Markets page with spreads, and a
  one-click delta-neutral funding arbitrage: long on the low-funding venue, short on the high-funding one.
- **Portfolio across venues.** Positions and orders from every perp venue in one table, with liquidation distance,
  per-venue account summary, TP/SL editing and close-all.
- **Funds.** Deposit and withdraw on each venue, and move USDC from Hyperliquid to Lighter in one flow.
- **Your layout.** Hide the order book, order entry, positions, news or account panel, or start from a preset.
  Choose sidebar or top navigation, the ticker tape position, a theme and an accent color. You can also switch
  between the built-in chart (news markers on candles) and TradingView.

## Venues

| Venue | What you trade | Network | How the terminal signs |
| --- | --- | --- | --- |
| [Hyperliquid](https://hyperliquid.xyz) | Perps, including HIP-3 stock perps (NVDA, TSLA, …) | testnet / mainnet | Agent key generated in the browser (can trade, cannot withdraw) |
| [Lighter](https://lighter.xyz) | Perps | testnet / mainnet | API key generated in the browser, stored encrypted |
| [Jupiter](https://jup.ag) | Solana spot tokens | mainnet | Your Solana wallet signs each swap |
| [Titan](https://titan.exchange) | Second quote source for Solana swaps | mainnet | Same as Jupiter; the better quote wins |
| [Arcus](https://arcus.xyz) | Tokenized stocks and indices on Robinhood Chain | testnet / mainnet | Your EVM wallet signs a gasless Permit2 order |

## How it works

```
Browser ──WebSocket──▶ Hyperliquid, Lighter      order books, trades, positions, orders
        ──WebSocket──▶ Angler News (Centrifugo)  raw + enriched news, with a single-use ticket
        ──HTTPS─────▶ Next.js route handlers ──▶ Angler API, Jupiter, Titan, Arcus, Solana RPC (keys added here)
```

- **Non-custodial.** Funds stay in your wallet and on the venues. Trading keys for Hyperliquid and Lighter are
  generated in your browser and used only to sign there; they are never logged or sent anywhere. Hyperliquid
  agent keys cannot withdraw. Both can be revoked from the account panel.
- **Secrets stay on the server.** API keys (Angler, Jupiter, Titan, Arcus, RPC) are read only by route handlers and
  never reach the browser. Only `NEXT_PUBLIC_*` settings are public.
- **No accounts, no database.** There is no login. Preferences live in your browser. Analytics count trades per
  venue and side only, with no wallet addresses or amounts.
- **Live data goes straight to the venues.** Order books, prices and account updates go from your browser to each
  venue, so the server only proxies cached market lists and the calls that need a key.

## Getting started

Requirements: Node.js 20+ and npm.

```bash
git clone https://github.com/Angler-Network/angler-terminal.git
cd angler-terminal
npm install
cp .env.example .env.local   # fill in the values you need (see below)
npm run dev                  # http://localhost:3000
```

The only required value is `ANGLER_API_KEY`, for the news feed. Every venue is optional: leave its variables empty
and it stays off or uses public defaults. `.env.example` documents every variable.

| Variable | Scope | Purpose |
| --- | --- | --- |
| `ANGLER_API_URL`, `ANGLER_API_KEY` | server | Angler News API (`/v1/news`, `/v1/sources`, `/v1/ws/ticket`) |
| `ANGLER_WS_URL` | server | Optional realtime endpoint override |
| `NEXT_PUBLIC_HL_NETWORK` | public | Hyperliquid `testnet` (default) or `mainnet` |
| `NEXT_PUBLIC_HL_BUILDER_ADDRESS` | public | Builder address added to every Hyperliquid order (required to trade) |
| `NEXT_PUBLIC_HL_BUILDER_FEE`, `NEXT_PUBLIC_HL_MAX_BUILDER_FEE` | public | Builder fee and the max users approve, in tenths of a bp |
| `NEXT_PUBLIC_HL_HIP3_DEXES` | public | HIP-3 dexes to list (default `xyz`) |
| `NEXT_PUBLIC_LIGHTER_NETWORK` | public | Lighter `testnet` (default) or `mainnet` |
| `NEXT_PUBLIC_LIGHTER_API_KEY_INDEX` | public | API key slot the terminal uses (default 61) |
| `NEXT_PUBLIC_LIGHTER_INTEGRATOR_*` | public | Optional integrator account and fees |
| `JUP_API_KEY`, `JUP_REFERRAL_ACCOUNT`, `JUP_REFERRAL_FEE_BPS` | server | Jupiter Swap V2 and its referral fee |
| `SOLANA_RPC_URL` | server | Solana RPC for balances and Titan transactions |
| `TITAN_API_KEY` | server | Optional Titan quotes (Jupiter alone without it) |
| `NEXT_PUBLIC_ARCUS_NETWORK`, `NEXT_PUBLIC_ARCUS_RPC_URL` | public | Arcus network and optional RPC |
| `ARCUS_API_KEY`, `ARCUS_BUILDER_FEE_BPS` | server | Optional Arcus partner key and fee |
| `NEXT_PUBLIC_SPOT_SIZE_PRESETS`, `NEXT_PUBLIC_PERP_SIZE_PRESETS` | public | Optional USD size presets |
| `ANALYTICS_TOKEN` | server | Bearer token for `GET /api/analytics/trade` |

### Testnet funds

- Hyperliquid: [app.hyperliquid-testnet.xyz/drip](https://app.hyperliquid-testnet.xyz/drip)
- Lighter: the testnet app at [testnet.app.lighter.xyz](https://testnet.app.lighter.xyz)
- Arcus: testnet mUSDG has an open `mint` on Robinhood Chain testnet (`0xf64780eAE9CFe162EF38f5224459a014a1007cd5`)

Jupiter and Titan have no testnet. Use a dedicated wallet with a few dollars.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit tests (Vitest, `*.test.ts` next to each module) |
| `npm run typecheck` | TypeScript checks |
| `scripts/build-lighter-signer.sh` | Rebuilds Lighter's official WASM signer into `public/lighter/` from a pinned commit |

Unit tests cover the pure logic: pricing and order math, order book parsing, routing, funding, TP/SL validation,
error mapping, storage and the news API parsers. The news API tests run against real API samples in
`lib/angler/fixtures`.

## Project structure

```
app/                  pages and API route handlers (news, markets, funding, venue proxies)
components/app/       shell: top bar, sidebar, settings, onboarding, ticker tape
components/terminal/  chart column, order panel, order book, positions, wallets, deposits
components/news/      news feed and cards
components/markets/   Markets page and funding arbitrage
lib/angler/           Angler News API types, parsers and the realtime feed
lib/venues/           Hyperliquid, Lighter, Jupiter, Titan and Arcus integrations
lib/trading/          execution, funding, order math, order book and TP/SL logic
docs/                 integration notes
```

Built with Next.js (App Router), React, TypeScript and Tailwind CSS. The theme, news components, chart and market
data come from [angler-news](https://news.angler.network), so the two products look and feel the same.

## Contributing

Issues and pull requests are welcome. Before opening a pull request, make sure `npm test`, `npm run typecheck` and
`npm run build` pass. Never commit keys or a real `.env` file: `.env.example` holds placeholders only.

Report security issues privately to the maintainers, not in a public issue.

## Disclaimer

This software is provided as is, without warranty. Trading perpetual futures and tokens carries a high risk of
loss. News scores, sentiment and impact predictions are model outputs, not financial advice. You are responsible
for every trade you place.
