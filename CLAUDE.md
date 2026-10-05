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
- Angler News API (`lib/angler/*`, spec at api.angler.network/openapi.yaml). `types.ts` holds the wire shapes checked
  against live responses; `lib/angler/fixtures/*.json` are real samples the tests read.
  - `GET /api/news` proxies `/v1/news` (coin, min_importance, limit, cursor; `next_cursor` is null on the last
    page) and answers a validated `ApiNewsPage` without `content`. REST items have a numeric `id`, `source_id`,
    `title`, `importance_score` and ticker `coins`, but no sentiment, predictions or summary.
  - `GET /api/sources` proxies `/v1/sources` (cached 10 min) to name sources: REST items by `source_id`, realtime
    items by slug (`external_id`).
  - `POST /api/ws-ticket` calls `/v1/ws/ticket` with `Authorization: Bearer <key>` and returns
    `{ ticket, expires_in, channels, url }`.
  - `use-news-feed.ts` connects with `centrifuge` and passes the ticket as connection **data** via `getData` (not as a
    token). A ticket opens one connection only, so a new one is minted on every connect and reconnect. The feed is
    live only once a channel is subscribed: free-tier keys connect but get every channel refused (code 1003), and
    REST polling takes over.
  - Channels `news.raw` and `news.enriched` publish stage messages `{ news_item_id, item }`; the id is always
    `news_item_id` (the enriched `item.id` is ""). Raw items have no score; enriched ones add `sentiment`
    `{ label, confidence }`, `coins` as `{ symbol, relevance }`, `impact_predictions` (no confidence) and
    `summary_short`. Both shapes become `FeedNews`, upserted by id with `mergeFeedNews`; `toNewsItem` maps them to
    the angler-news `NewsItem` shape. The API carries no Solana mints.
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
- Lighter (`lib/venues/lighter/`, a second `PerpVenue`; research and API notes in `docs/lighter-integration.md`,
  source of truth apidocs.lighter.xyz/llms.txt):
  - Network from `NEXT_PUBLIC_LIGHTER_NETWORK` (testnet default, chain 300; mainnet 304), per-browser override
    `LIGHTER_NETWORK_OVERRIDE_KEY`. Markets from `orderBookDetails`, cached 60s by `/api/lighter/markets`. Ids,
    decimals and minimums always come from the API.
  - Signer: lighter-go's official WASM build in `public/lighter/` (`scripts/build-lighter-signer.sh` pins the commit
    and copies `wasm_exec.js` from the same Go), loaded lazily by `signer.ts`. All HTTP goes through fetch with
    explicit nonces (`nonce.ts` serializes sends per key, refetches on 21104); never `CheckClient` or nonce -1.
  - Onboarding: account exists after the first deposit (`accountsByL1Address`); `GenerateAPIKey` in the browser,
    `SignChangePubKey`, the user's wallet `personal_sign`s `messageToSign` → `L1Sig`, wait for `apikeys`. Key slot
    `NEXT_PUBLIC_LIGHTER_API_KEY_INDEX` (default 61). The private key is stored AES-GCM encrypted with a
    non-extractable WebCrypto key kept in IndexedDB (`key-crypto.ts`), per network + L1 address + account index
    (`key-store.ts`); never log or send it. Revoke = register a throwaway key at the same slot. Optional integrator
    approval (`NEXT_PUBLIC_LIGHTER_INTEGRATOR_*`; zero fee on Standard accounts).
  - Market orders: type 1, IOC, expiry 0, price = worst price (best bid/ask ∓ 3%, `pricing.ts`), integers scaled by
    `size_decimals` / `price_decimals`, minimum = larger of `min_base_amount` and `min_quote_amount` (not for
    reduce-only). `sendTx` 200 is only "accepted": orders are confirmed through `accountOrders` by client index.
  - Account over the WebSocket: `account_all` + `user_stats` (public) and `account_all_orders` (auth token);
    `update/*` messages are partial and merged (`account.ts`). API codes and order statuses map to readable toasts
    in `errors.ts`. Never place mainnet orders from tests or scripts.
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
- Venue resolver (`components/terminal/use-asset-venue.ts`): perps on the preferred perp venue
  (`preferredPerpVenue`, default Hyperliquid) and the other enabled one as fallback (`lib/venues/routing.ts`), Jupiter
  spot when a verified token exists (a mint on the news item goes straight to spot; the Angler API sends none today).
- News → trading: orders start from the news. Important news (impact ≥ `tradeMinImpact`, default 60) with a
  tradable asset shows a size grid per asset (`components/news/news-trade-grid.tsx`): green Long/Buy row, red
  Short/Sell row, four presets each. Venues come from the resolver `use-asset-venue.ts`; the ticket carries the perp venue id. A press arms the button
  ("Confirm"); the second press places it (`trade-ticket.tsx` → `use-news-trader.ts`, headless). One-click mode
  (setting, off by default) is the only way a single press trades. The news direction only highlights a side.
  Spot trades refuse quotes with price impact above `MAX_SPOT_PRICE_IMPACT_PCT`.
- Test order form (`components/terminal/manual-order.tsx`, temporary): while `manualOrders` is on (default, toggle in
  Trading settings) the account panel shows a market order form for the chart's asset with a venue picker
  (Hyperliquid, Lighter, Jupiter), side, USD size and perp leverage, so people can check each venue and network.
  It goes through `use-news-trader.ts` (same guards, analytics with no news id) and keeps the two-press confirm.
- Shell: same layout as news.angler.network. `components/app/sidebar.tsx` (Terminal, News link, Wallets, Settings)
  and `components/app/settings-dialog.tsx` (General, Appearance, News filters, Trading, Venues & networks,
  Notifications, About; `openSettings(section)` opens a given section),
  built from the copied angler-news `form-controls`, `select-field`, `appearance-settings`. Venues can be turned off
  (`venueHyperliquid`, `venueLighter`, `venueJupiter`); each perp venue's network can be overridden per browser
  (`HL_NETWORK_OVERRIDE_KEY`, `LIGHTER_NETWORK_OVERRIDE_KEY`, applied after a reload; the markets routes follow
  `?network=`). The trading provider merges both perp venues' positions and orders (venue badge in the positions
  bar; close/cancel route by `venue`); the account panel and setup dialog have a section per perp venue.
- `components/app/alpha-notice.tsx` shows the alpha warning once per browser (bump `ACK_KEY` to show it again) and
  the "Alpha" badge in the top bar.
- Wallets: one Connect button opens `wallet-modal.tsx`, a venue picker (Hyperliquid, Lighter, Jupiter live; Titan,
  Arcus "Soon"). Choosing a venue lists the wallets for its chain: EVM via EIP-6963 discovery, Solana via Wallet
  Standard. One wallet per chain serves every venue on that chain. The account panel (`account-panel.tsx`: balances, trading key) and
  its grid column only appear once a wallet is connected. Perp leverage for news trades lives in settings.
- High-impact highlight: `lib/trading/high-impact.ts` (threshold and sound in settings, sound off by default).
- Analytics: `lib/analytics/*` counts placed trades (venue, side, news id, one-click). Never add wallet addresses,
  amounts or other personal data. `GET /api/analytics/trade` needs `ANALYTICS_TOKEN`.
- Keep the disclaimer "Not financial advice. Scores are model outputs." next to the account panel and in settings.
- Wallets never connect on page load unless the user clicked Connect in this app before (wallet permissions are per
  origin and may come from another app on the same origin).
- Chart intervals: `lib/chart/candles.ts` lists the 14 intervals Binance and Hyperliquid both accept (1m–1M);
  `components/chart/interval-picker.tsx` shows starred ones (`chartFavoriteIntervals`) as quick buttons.
- Selected asset lives in `components/terminal/selected-asset.tsx`; news chips call `selectAsset`. Clicking a ticker
  tape pill calls `focusAsset`: it selects the chart and narrows the feed to that symbol (`newsFocus`, cleared from
  the "Only X" chip). The clickable pill is a terminal-only change to the copied `ticker-pill.tsx`/`ticker-tape.tsx`.
- News filters (`lib/news/filter.ts`, saved as the `newsFilters` preference, edited in settings and from the feed
  header): assets, sentiment (±0.15 is neutral), severity, minimum impact, raw headlines. Raw items have no assets,
  so they are hidden while an asset filter or focus is on. With one asset (focus or a single filter) the feed's REST
  history is requested with `coin`.
- Out of scope: Supabase auth, memberships, payments, admin, referrals, Telegram. The terminal has no login.

## Checks

`npm test` (vitest, `*.test.ts` next to the module), `npm run typecheck` and `npm run build` must pass before
pushing. Pure logic (pricing, parsing, error mapping, storage) gets unit tests; network and wallet code does not.

In Claude Code cloud sessions, Node's built-in fetch ignores `HTTPS_PROXY`: start the app (or any script that calls
external APIs) with `NODE_USE_ENV_PROXY=1`. Delete `.next/cache` after running against mocks, since `unstable_cache`
persists responses across builds.
