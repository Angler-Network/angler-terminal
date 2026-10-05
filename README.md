# Angler Terminal

A news-driven trading terminal: live Angler news streams next to the chart, and every asset chip on a news card
switches the chart to that asset. Order entry and positions are placeholders for now.

## Run it

```bash
npm install
cp .env.example .env.local   # then put your Angler API key in ANGLER_API_KEY
npm run dev                  # http://localhost:3000
```

| Variable         | Where it is used | Purpose                                                 |
| ---------------- | ---------------- | ------------------------------------------------------- |
| `ANGLER_API_URL` | server           | Angler News API base URL (`https://api.angler.network`) |
| `ANGLER_API_KEY` | server only      | API key for `/v1/news` and `/v1/ws/ticket`              |
| `ANGLER_WS_URL`  | server → browser | Optional realtime endpoint override                     |
| `NEXT_PUBLIC_HL_NETWORK` | browser | `testnet` (default) or `mainnet` |
| `NEXT_PUBLIC_HL_BUILDER_ADDRESS` | browser | Builder address added to every order (required to trade) |
| `NEXT_PUBLIC_HL_BUILDER_FEE` | browser | Builder fee per order, in tenths of a basis point (max 100) |
| `NEXT_PUBLIC_HL_MAX_BUILDER_FEE` | browser | Max fee users approve during setup, same unit |

## How the news feed works

1. `GET /api/news` loads recent history (proxied to `/v1/news`, paginated with `next_cursor`).
2. `POST /api/ws-ticket` mints a single-use realtime ticket on the server.
3. The browser connects to Centrifugo with the ticket as connection data, minting a new ticket on every reconnect,
   and subscribes to `news.raw` and `news.enriched`.
4. Raw headlines show immediately; the enriched version (coins, sentiment, impact predictions, summary, importance)
   replaces it in place, matched by news id.

The API key never reaches the browser.

## Trading on Hyperliquid

1. Connect a browser wallet (MetaMask, Rabby, …).
2. On the first trade, a 2-step setup asks for two signatures: approve the builder fee, then create a trading key.
   The key is generated in the browser, can place and cancel orders but cannot withdraw, and can be revoked from the
   order panel at any time.
3. After that, orders sign locally without wallet popups. Positions and open orders stream live in the bottom bar.

Testnet funds: https://app.hyperliquid-testnet.xyz/drip

## Spot swaps on Jupiter (Solana)

Assets that aren't Hyperliquid perps, or that are verified Solana tokens, can be swapped on Jupiter (Swap V2):
connect a Solana wallet (Phantom, Solflare, Backpack) in the account panel, then use Buy (USDC → token) or Sell
(token → USDC) on a news card. Each trade re-quotes right before signing, is refused above 3% price impact, and links to
Solscan.

Jupiter has no testnet: use a dedicated wallet with a few USD. Development builds default to $1/$2/$5/$10 presets.

| Variable | Where | Purpose |
| --- | --- | --- |
| `JUP_API_KEY` | server only | Jupiter API key |
| `JUP_REFERRAL_ACCOUNT`, `JUP_REFERRAL_FEE_BPS` | server only | Integrator fee (50-255 bps) |
| `SOLANA_RPC_URL` | server only | RPC for wallet balances |
| `NEXT_PUBLIC_SPOT_SIZE_PRESETS` | browser | Optional comma-separated USD presets |

## Trading from the news feed

Trades start from the news. For now a **test order form** in the account panel (for the chart's asset) can also
place market orders on Hyperliquid, Lighter or Jupiter, to check each venue and network; turn it off in Settings →
Trading.

- Important news (impact ≥ 60 by default, configurable) that mentions a tradable asset shows a size grid per asset:
  a green **Long/Buy** row and a red **Short/Sell** row. Hyperliquid assets trade as perps (Long/Short), Solana-only
  tokens as Jupiter spot swaps (Buy/Sell). The side matching the news direction is highlighted; nothing trades
  automatically.
- Press a size to arm it ("Confirm"), press again to place it. One-click trading can be enabled in settings (gear
  icon); it is off by default.
- Keyboard on the selected news item: `L` long/buy, `S` short/sell, `1`–`4` size, `Enter` or the same key again to
  confirm, `Esc` cancel.
- The right column holds wallets, the Hyperliquid trading key, balances and the leverage used for news trades.
- News filters (sliders icon in the news header, or Settings → News filters): only some assets (e.g. BTC), positive /
  neutral / negative sentiment, severity and minimum impact. Clicking a pair on the ticker tape opens its chart and
  shows only its news until you clear the "Only BTC" chip.
- High-impact items (impact ≥ 80 by default) are briefly highlighted; an optional sound can be enabled in settings.

Not financial advice. Scores are model outputs.

## Tests

```bash
npm test
```

## Layout

Top bar (logo, ticker tape, Connect) · chart · order panel · live news column · positions/orders bar.
Built on the theme, news components, chart and market data of [angler-news](https://news.angler.network).
