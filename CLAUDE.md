# Angler Terminal

News-driven trading terminal (Next.js App Router, TypeScript, Tailwind). Sister product of angler-news
(github.com/Angler-Network/angler-news, live at news.angler.network): it must look and feel like the same product.

## Git rules (every session must follow these)

- Commits are authored with the user's local git `user.name` and `user.email`. Never commit as Claude and never change
  the configured identity.
- No `Co-Authored-By` trailers, no "Generated with" lines, no AI footer or any mention of AI/Claude in commit messages,
  pull request titles or pull request descriptions.
- Commit messages follow Conventional Commits, are a single line, and are 72 characters or fewer
  (e.g. `feat(news): upsert enriched items by id`).
- Work on and push to `main`. Never create or push branches with "claude" (or any AI reference) in the name.

## Secrets

- The repository is shared with hackathon judges. Never commit secrets, keys, tickets or real `.env` files.
- `.env.example` holds placeholders only. Real values live in `.env.local` (gitignored).
- `ANGLER_API_KEY` is read only on the server (`lib/angler/env.ts`, imported by route handlers). Never expose it to the
  browser and never prefix it with `NEXT_PUBLIC_`.

## Architecture

- Theme: `app/globals.css` CSS variables + `app.*` tokens in `tailwind.config.ts`, Sora font in `app/layout.tsx`, copied
  from angler-news. Default look is the `oled` theme with the `liquid` surface (`APPEARANCE_VERSION` in
  `lib/preferences.ts` moves older saved looks to it once). Keep Next.js, React and Tailwind on the same versions as angler-news.
- Reused angler-news code (keep it close to upstream so fixes can be ported): `components/news/*`,
  `components/chart/*`, `components/app/ticker-*`, `market-icon`, `preferences-provider`, `searchable-select`,
  `lib/markets/*`, `lib/chart/candles.ts`, `lib/preferences.ts`, `lib/appearance.ts`, `lib/format.ts`.
  `lib/i18n` is an English-only shim so the copied components keep calling `t()`.
- Markets: `lib/markets/server.ts` lists Binance + Hyperliquid perps, spot and HIP-3 stock perps (dex `xyz`). It is the
  market source for the venue resolver.
- Angler News API (`lib/angler/*`):
  - `GET /api/news` proxies `/v1/news` (coin, min_importance, limit, cursor; `next_cursor` paginates).
  - `POST /api/ws-ticket` calls `/v1/ws/ticket` with `Authorization: Bearer <key>` and returns
    `{ ticket, expires_in, channels, url }`.
  - `use-news-feed.ts` connects with `centrifuge` and passes the ticket as connection **data** via `getData` (not as a
    token). A ticket opens one connection only, so a new one is minted on every connect and reconnect.
  - Channels `news.raw` (arrives first, no enrichment) and `news.enriched` (same id, later). Items are upserted by news
    id with `mergeApiNews`; `toNewsItem` maps them to the angler-news `NewsItem` shape.
- Venues (`lib/venues/*`): the `Venue` interface in `types.ts`; Hyperliquid in `hyperliquid/`, built on
  `@nktkas/hyperliquid`.
  - Network comes from `NEXT_PUBLIC_HL_NETWORK` (testnet default); switching to mainnet needs no code change.
  - Markets: `perpDexs` + `metaAndAssetCtxs` per dex, cached 60s by `/api/hl/markets`. HIP-3 coins are named
    `dex:COIN`, with asset id `100000 + dexIndex * 10000 + index` (index in the full `perpDexs` list). Only dexes in
    `NEXT_PUBLIC_HL_HIP3_DEXES` (default `xyz`) are listed; testnet has hundreds of junk dexes.
  - Onboarding: `approveBuilderFee` (user wallet, max fee from config), then `approveAgent` with a key generated in
    the browser. The agent key is stored per network and user in localStorage (`agent-store.ts`), used only to sign
    locally, and must never be logged or sent anywhere. Revoke = approveAgent with the zero address and the same name.
  - Market orders are IOC limits at mid ± 5% slippage, rounded to 5 significant figures and 6 - szDecimals
    decimals. Every order carries `builder: { b, f }` (f in tenths of a bp). Leverage is updated before an order
    only when it changed.
  - Positions and orders stream over the browser WebSocket (`allDexsClearinghouseState` + `openOrders` per dex).
  - Exchange errors go through `errors.ts` (`humanizeHlError`) and are shown as toasts.
- Jupiter (`lib/venues/jupiter/`, a `SpotVenue`): Swap V2 Meta-Aggregator only (`GET /swap/v2/order` +
  `POST /swap/v2/execute` on api.jup.ag). Ultra and Metis are unmaintained: don't use them. Docs source:
  github.com/jup-ag/docs (mirrors developers.jup.ag).
  - Every Jupiter call goes through `app/api/jup/*`, which adds `x-api-key` (`JUP_API_KEY`) and
    `referralAccount` + `referralFee` (50-255 bps) server-side. Balances come from Solana RPC via
    `app/api/solana/balances` (`SOLANA_RPC_URL`).
  - Tokens: `/tokens/v2/search`, verified only; on a symbol clash the most liquid verified token wins. Symbols
    are compared without a leading `$` (the verified dogwifhat token is `$WIF`).
  - Amounts are integer base units using decimals from token data (`amounts.ts`), never assumed.
  - Wallets: Wallet Standard (`solana:signTransaction`); the transaction is signed as raw bytes. Quotes refresh every
    5s and are re-fetched right before signing.
- Venue resolver (`components/terminal/use-asset-venue.ts`): Hyperliquid perps when listed, Jupiter spot when a
  verified token exists (a mint from the news item goes straight to spot).
- News → trading: there is no manual order form. Important news (impact ≥ `tradeMinImpact`, default 60) with a
  tradable asset shows a size grid per asset (`components/news/news-trade-grid.tsx`): green Long/Buy row, red
  Short/Sell row, four presets each. Venues come from the resolver `use-asset-venue.ts`. A press arms the button
  ("Confirm"); the second press places it (`trade-ticket.tsx` → `use-news-trader.ts`, headless). One-click mode
  (setting, off by default) is the only way a single press trades. The news direction only highlights a side.
  Spot trades refuse quotes with price impact above `MAX_SPOT_PRICE_IMPACT_PCT`.
- Wallets: one Connect button opens `wallet-modal.tsx` with EVM wallets (EIP-6963 discovery, for Hyperliquid) and
  Solana wallets (Wallet Standard, for Jupiter). The account panel (`account-panel.tsx`: balances, trading key) and
  its grid column only appear once a wallet is connected. Perp leverage for news trades lives in settings.
- High-impact highlight: `lib/trading/high-impact.ts` (threshold and sound in settings, sound off by default).
- Analytics: `lib/analytics/*` counts placed trades (venue, side, news id, one-click). Never add wallet addresses,
  amounts or other personal data. `GET /api/analytics/trade` needs `ANALYTICS_TOKEN`.
- Keep the disclaimer "Not financial advice. Scores are model outputs." next to the account panel and in settings.
- Wallets never connect on page load unless the user clicked Connect in this app before (wallet permissions are per
  origin and may come from another app on the same origin).
- Selected asset lives in `components/terminal/selected-asset.tsx`; news chips call `selectAsset`.
- Out of scope: Supabase auth, memberships, payments, admin, referrals, Telegram. The terminal has no login.

## Checks

`npm test` (vitest, `*.test.ts` next to the module), `npm run typecheck` and `npm run build` must pass before
pushing. Pure logic (pricing, parsing, error mapping, storage) gets unit tests; network and wallet code does not.

In Claude Code cloud sessions, Node's built-in fetch ignores `HTTPS_PROXY`: start the app (or any script that calls
external APIs) with `NODE_USE_ENV_PROXY=1`. Delete `.next/cache` after running against mocks, since `unstable_cache`
persists responses across builds.
