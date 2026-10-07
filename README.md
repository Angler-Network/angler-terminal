# Angler Terminal

A multi-venue perp DEX terminal driven by real-time, AI-scored crypto news.

Trade Hyperliquid and Lighter perps, Solana tokens and tokenized stocks from one screen. The terminal picks the
cheapest venue for you, and every important headline turns into a one-tap trade on the asset it moves.

**Live:** [trade.angler.network](https://trade.angler.network) · **Testnet:**
[testnet-trade.angler.network](https://testnet-trade.angler.network) · **News API:** [api.angler.network](https://api.angler.network/openapi.yaml)

> **Alpha.** The terminal runs on testnets by default. Mainnet trades use real funds. Not financial advice: news
> scores and predictions are model outputs.

## Why Angler Terminal

Most multi-venue terminals compete on how many venues they connect and how many bots they run for you. Angler
Terminal is built for people who manage their own on-chain portfolio and want to make the decisions themselves:

- **You see why the market moves before you trade it.** Every headline arrives scored, translated and linked to
  the assets it affects, next to the chart, the order book and your positions on every venue.
- **You keep the keys and the final say.** Nothing trades without your press unless you write the rule yourself,
  and no key or fund ever leaves your wallet or browser.
- **It stays fast and simple.** One screen, one order panel for every venue, live data straight from the venues
  and a first load of about 200 kB of JavaScript.

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

The browser talks to the venues directly; the server only adds API keys and caches shared data.

## Security

Angler Terminal never holds your funds or your keys, and the code that signs your orders is open for anyone to read.

- **Non-custodial by design.** Funds stay in your wallet and on the venues. There is no deposit contract and no
  pooled account, and the app can't move your funds: deposits and withdrawals are signed by your own wallet.
- **Keys are created and kept in your browser.** Hyperliquid and Lighter trading keys are generated locally and
  used only to sign locally; they are never logged or sent anywhere. A Hyperliquid agent key can trade but cannot
  withdraw. The Lighter key is stored encrypted (AES-GCM) with a non-extractable WebCrypto key, so the raw key
  can't be read back out of the browser's storage. Both can be revoked from the account panel at any time.
- **Official signers only.** Hyperliquid orders are signed with a maintained open-source SDK, Lighter orders with
  Lighter's own WASM signer built from a pinned commit (`scripts/build-lighter-signer.sh`), and spot swaps by your
  own wallet (Wallet Standard on Solana, EIP-712 / Permit2 on EVM).
- **Server secrets stay on the server.** API keys (Angler, Jupiter, Titan, Arcus, RPC) are read only by route
  handlers and never reach the browser. Only `NEXT_PUBLIC_*` settings are public.
- **Guard rails on every trade.**
  - Orders need two presses by default; one-click trading is opt-in.
  - Automatic news rules are off by default and limited to one trade per rule every five minutes.
  - Spot swaps are re-quoted right before signing and refused above 3% price impact.
  - Wallets never connect on page load unless you connected them in this app before.
- **Little about you is stored.** There is no login. Preferences live in your browser. Your profile (points, level,
  an optional username) is keyed by your wallet address and built only from the venues' public records of trades
  placed through Angler. Analytics count trades per venue and side only, with no wallet addresses.

Found a vulnerability? Report it privately to the maintainers rather than in a public issue.

## Performance

Speed comes from what the app doesn't do: no account server sits between you and the venues, and nothing heavy
loads until you need it.

- **Direct to the venues.** Order books, trades, prices and your positions stream from each venue to your browser
  over WebSockets, with no relay server adding latency. Book updates are batched so the page stays smooth in
  fast markets.
- **Realtime news.** Headlines arrive over WebSocket the moment they're ingested, and the analyzed version
  replaces the raw headline in place.
- **Light first load.** The terminal page ships about 200 kB of JavaScript on first load (compressed, at the time
  of writing). Trading SDKs, wallet clients and dialogs load on demand, and the server-rendered price tape streams
  in without blocking the page.
- **Better fills.** Market orders are priced from both perp venues' live order books with every fee included,
  routed to the cheaper venue, and split across venues when that fills cheaper.
- **Shared, cached data.** Market lists, funding rates, news sources and news reaction stats are cached on the
  server, so a crowd of users costs the upstream APIs about the same as one.

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
| `COINGECKO_API_KEY`, `COINGECKO_API_PLAN`, `COINGECKO_DAILY_BUDGET` | server | Optional: spot token charts from CoinGecko's on-chain API (free GeckoTerminal without it), capped per day |
| `ANALYTICS_TOKEN` | server | Bearer token for `GET /api/analytics/trade` |

### Testnet funds

- Hyperliquid: [app.hyperliquid-testnet.xyz/drip](https://app.hyperliquid-testnet.xyz/drip)
- Lighter: **Get test USDC** in the account panel or the deposit dialog opens your testnet account with test USDC
  (the same faucet as [testnet.app.lighter.xyz](https://testnet.app.lighter.xyz))
- Arcus: test ETH from [faucet.testnet.chain.robinhood.com](https://faucet.testnet.chain.robinhood.com), then
  **Mint 500 mUSDG** in the account panel's Arcus section (the explorer can't call the token's mint)

Jupiter and Titan have no testnet. Use a dedicated wallet with a few dollars.

### Mainnet and testnet sites

One codebase runs both sites as two Vercel projects on the same repository and branch:

| Site | `NEXT_PUBLIC_DEPLOYMENT` | What it does |
| --- | --- | --- |
| trade.angler.network | `mainnet` | Every venue on mainnet, including Jupiter and Titan |
| testnet-trade.angler.network | `testnet` | Every venue on testnet with in-app faucets; Jupiter and Titan off |

Set `NEXT_PUBLIC_OTHER_DEPLOYMENT_URL` on each project to link to the other site.

The mainnet site only offers venues whose settings are present: Hyperliquid needs `NEXT_PUBLIC_HL_BUILDER_ADDRESS`,
Jupiter `JUP_API_KEY`, Titan `TITAN_API_KEY` and Arcus `ARCUS_API_KEY`. Lighter needs nothing. Redeploy after adding
one.

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

Built with Next.js (App Router), React, TypeScript, Tailwind CSS and GSAP. The project started from
[angler-news](https://news.angler.network) and is developed independently.

## Contributing

Issues and pull requests are welcome. Before opening a pull request, make sure `npm test`, `npm run typecheck` and
`npm run build` pass. Never commit keys or a real `.env` file: `.env.example` holds placeholders only.

## Disclaimer

This software is provided as is, without warranty. Trading perpetual futures and tokens carries a high risk of
loss. News scores, sentiment and impact predictions are model outputs, not financial advice. You are responsible
for every trade you place.
