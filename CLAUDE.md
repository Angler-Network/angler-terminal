# Angler Terminal

News-driven trading terminal (Next.js App Router, TypeScript, Tailwind). It started from angler-news
(github.com/Angler-Network/angler-news, live at news.angler.network) and is now developed as its own product: code,
dependency versions and design are free to diverge from angler-news.

## Git rules (every session must follow these)

- Commits are authored with the user's local git `user.name` and `user.email`. Never commit as Claude and never change
  the configured identity.
- No `Co-Authored-By` trailers, no "Generated with" lines, no AI footer or any mention of AI/Claude in commit messages,
  pull request titles or pull request descriptions.
- Commit messages follow Conventional Commits, are a single line, and are 72 characters or fewer
  (e.g. `feat(news): upsert enriched items by id`).
- Work on and push to `main`. Never create or push branches with "claude" (or any AI reference) in the name.

## Secrets

- The repository is public. Never commit secrets, keys, tickets or real `.env` files.
- `.env.example` holds placeholders only. Real values live in `.env.local` (gitignored).
- `ANGLER_API_KEY` is read only on the server (`lib/angler/env.ts`, imported by route handlers). Never expose it to the
  browser and never prefix it with `NEXT_PUBLIC_`.

## Architecture

- Theme: `app/globals.css` CSS variables + `app.*` tokens, Sora font in `app/layout.tsx`. Default look is the `oled`
  theme with the `liquid` surface (`APPEARANCE_VERSION` in `lib/preferences.ts` moves older saved looks to it once).
- Code that began as copies of angler-news (`components/news/*`, `components/chart/*`, `components/app/ticker-*`,
  `market-icon`, `preferences-provider`, `searchable-select`, `lib/markets/*`, `lib/chart/candles.ts`,
  `lib/preferences.ts`, `lib/appearance.ts`, `lib/format.ts`) is owned here now: change it freely, nothing is ported
  back. `lib/i18n` is an English-only shim so those components keep calling `t()`.
- Markets: `lib/markets/server.ts` lists Binance + Hyperliquid perps, spot and HIP-3 stock perps (dex `xyz`), plus
  Lighter mainnet perps as a fallback quote (Binance answers 451 to US servers and Hyperliquid can rate limit shared
  IPs). Requests retry once and log failures; an all-empty load throws so the cache keeps the last good list. It is the
  market source for the venue resolver.
- Angler News API (`lib/angler/*`, spec at api.angler.network/openapi.yaml). `types.ts` holds the wire shapes checked
  against live responses; `lib/angler/fixtures/*.json` are real samples the tests read.
  - `GET /api/news` proxies `/v1/news` (coin, min_importance, limit, cursor; `next_cursor` is null on the last
    page) and answers a validated `ApiNewsPage` without `content`. REST items have a numeric `id`, `source_id`,
    `title`, `importance_score`, ticker `coins` and `summary_short` (when the plan shows it), but no sentiment or
    predictions.
  - Translations (API v2026.10.3): `title`/`lang` stay in the original language; a non-English item carries its
    English title under `translations.en.title` (REST and `news.enriched`; the event sends `null` parts while
    untranslated, `translations: null` for English items, and a deprecated `title_en`). `map.ts` keeps only the
    title (bodies are dropped like `content`) as `FeedNews.titleEn`; `toNewsItem` shows it as the headline with the
    original as `originalHeadline` (tooltip + "zh → EN" tag) unless `newsTranslate` is off (Settings → News filters).
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
- Deployments: one repo and branch, two Vercel projects. `NEXT_PUBLIC_DEPLOYMENT` (`lib/deployment.ts`) = `mainnet`
  (trade.angler.network) or `testnet` (testnet-trade.angler.network) pins every venue's network (`pinnedNetwork`,
  ignoring the per-browser overrides, which Settings then hides) and limits venues through `venueAvailable`
  (preferences, wallet tiles, settings rows, account sections): testnet drops Jupiter/Titan; mainnet offers only
  venues whose required settings exist, from `NEXT_PUBLIC_CONFIGURED_VENUES`, which `next.config.mjs` derives at build
  time from env presence (names only: HL needs a real `NEXT_PUBLIC_HL_BUILDER_ADDRESS`, Jupiter `JUP_API_KEY`, Titan
  `TITAN_API_KEY`, Arcus `ARCUS_API_KEY`; Lighter needs nothing). A Testnet badge in the top bar links to
  `NEXT_PUBLIC_OTHER_DEPLOYMENT_URL`. Unset, each venue follows its own `NEXT_PUBLIC_*_NETWORK` as before.
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
  - Testnet faucet: `requestTestFunds` (`api.ts`) calls `GET /api/v1/faucet?l1_address=&do_l1_transfer=false`, the
    undocumented endpoint behind the testnet app's "Request Funds" (opens the account with 10,000 test USDC; refills
    only under $100), then polls `accountsByL1Address`. `lighter-faucet-button.tsx` sits in the account panel, the
    deposit dialog and setup step 1.
  - Onboarding: account exists after the first deposit (`accountsByL1Address`); `GenerateAPIKey` in the browser,
    `SignChangePubKey`, the user's wallet `personal_sign`s `messageToSign` → `L1Sig`, wait for `apikeys`. Key slot
    `NEXT_PUBLIC_LIGHTER_API_KEY_INDEX` (default 61). The private key is stored AES-GCM encrypted with a
    non-extractable WebCrypto key kept in IndexedDB (`key-crypto.ts`), per network + L1 address + account index
    (`key-store.ts`); never log or send it. Revoke = register a throwaway key at the same slot. Optional integrator
    approval (`NEXT_PUBLIC_LIGHTER_INTEGRATOR_*`; zero fee on Standard accounts). With
    `NEXT_PUBLIC_LIGHTER_REFERRAL_CODE` the approve step offers an opt-in checkbox (on by default, says it replaces
    the account's current code) that calls `referral/use` with the key's auth token (`applyLighterReferral`, no
    wallet signature); a failure only shows an info toast. Titan's API has no referral system (fee only).
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
  spot when a verified token exists (a mint on the news item goes straight to spot; the Angler API sends none today),
  then Arcus stock tokens (`spotVenue: "arcus"`) when nothing else lists the asset.
- Titan (`lib/venues/titan/`): second Solana spot quote source via the REST Portal (`portal.api.titan.exchange`,
  `x-api-key: TITAN_API_KEY`, server only; the SDK is WebSocket/Enterprise-only, don't use it). `app/api/titan/order`
  takes the `ExpectedWinner` route and builds the unsigned v0 transaction server-side with `@solana/web3.js`
  (Titan returns instructions only); `app/api/titan/execute` sends the signed tx through `SOLANA_RPC_URL` and waits
  for confirmation. `use-news-trader.ts` asks Jupiter and Titan in parallel and executes the larger output
  (`lib/trading/best-quote.ts`, Jupiter wins ties). No key → 503 → Jupiter alone. Partner fee (`fees.ts`):
  `TITAN_FEE_WALLET` + `TITAN_FEE_BPS` add `feeAccount`/`feeBps` to the quote, always in USDC (the wallet's USDC ATA:
  `feeFromInputMint` on buys, output on sells); the ATA must already exist.
- Arcus (`lib/venues/arcus/`): stock/index tokens on Robinhood Chain (testnet 46630, mainnet 4663;
  `NEXT_PUBLIC_ARCUS_NETWORK`, testnet default), via `@arcus-xyz/arcus-spot-sdk` for signing only.
  - The browser calls `app/api/arcus/[...path]` (tokens, price, quote, status, submit only): the mainnet router allows
    listed origins only, and the server adds `ARCUS_API_KEY` + `ARCUS_BUILDER_FEE_BPS` when set.
  - Flow (`venue.ts`): size in USDG (mUSDG on testnet; sells sized from `/v1/price`), balance check, `/v1/quote`,
    keep only the gasless `arcus` venue quote, refuse impact above `MAX_SPOT_PRICE_IMPACT_PCT` vs `referencePrice`,
    switch/add Robinhood Chain in the wallet, Permit2 allowance (EIP-2612 permit or one-time approve), sign the
    Permit2 witness, `/v1/submit`, poll `/v1/status`. Minimum $5 per trade.
  - Testnet funds: the account panel's Arcus section links the Robinhood testnet ETH faucet and mints
    `TEST_USDG_MINT_AMOUNT` mUSDG through the token's open `mint(address,uint256)` (`mintTestUsdg`, simulated first; the
    contract is unverified so explorers can't call it, and it limits mints per wallet). mUSDG supports EIP-2612 permits.
- News → trading: orders start from the news. Important news (impact ≥ `tradeMinImpact`, default 60) with a
  tradable asset shows a size grid per asset (`components/news/news-trade-grid.tsx`): green Long/Buy row, red
  Short/Sell row, four presets each. Venues come from the resolver `use-asset-venue.ts`; the ticket carries the perp venue id. A press arms the button
  ("Confirm"); the second press places it (`trade-ticket.tsx` → `use-news-trader.ts`, headless). One-click mode
  (setting, off by default) is the only way a single press trades. The news direction only highlights a side.
  Spot trades refuse quotes with price impact above `MAX_SPOT_PRICE_IMPACT_PCT`.
- Multi-venue trading UI (the product is now a multi perp DEX terminal, news is the differentiator):
  - Layout (`terminal-shell.tsx`): every panel but the chart can be hidden (`panels` preference: orderbook,
    orderEntry, positions, news, account; edited from Layout in the sidebar (`layout-menu.tsx`: presets, panels,
    sidebar/top bar) and Settings → Layout). Columns: chart (rest of the width, positions under it) | trading column
    (order panel + account card on top, order book under it, filling the height) | news; side widths use
    `clamp(…vw)` so the chart keeps room on laptops. The sidebar and top bar hide like angler-news
    (`layout-toggles.tsx`, always available here).
  - Mobile (below `lg`, 1024px): no rail, no frame, top bar always shown; a bottom tab bar (`mobile-nav.tsx`: Chart,
    Trade, News, Portfolio, More → Markets / Wallets / Settings / news site) switches full-screen views
    (`mobile-view.tsx` context; `terminal-shell.tsx` hides the others with `max-lg:hidden`, so no layout flash, and
    renders every panel whatever the desktop `panels`). Trade = order panel + account + order book, scrolling. The
    chart header wraps the stats to their own row. Toasts sit above the tab bar; dialogs cap at the viewport height;
    `viewportFit: "cover"` + `env(safe-area-inset-bottom)` keep the bar above the home indicator. News asset chips
    switch to the Chart view on phones.
  - Chart header: asset, price, then `market-stats.tsx` (mark, 24h volume, open interest from the venue market list,
    hourly funding + countdown to the top of the hour; `lib/trading/market-stats.ts`) and the interval picker.
  - Shell chrome (`app-frame.tsx`, client): top bar + page + optional footer. `navMode` ("sidebar" | "top") moves
    navigation into the top bar (`top-nav.tsx`); `tapePosition` ("top" | "bottom" | "off") places the server-rendered
    tape (`ticker-bar.tsx` → `ServerTape`) once. `html[data-nav]` / `html[data-tape]` are set before hydration so the
    rail doesn't flash; choosing top navigation drops the tape to the footer (`navModeChange`). Offered in onboarding,
    the layout menu and Settings → Layout.
  - Order panel (`order-panel.tsx`, laid out like the venues' own forms): Long/Short tabs, venue, a leverage button
    (popover: slider, presets, cross/isolated) next to Market/Limit, inline-labelled inputs, a 0-100% slider of
    available margin, then a summary (est. entry from the book walk, slippage, fees, margin, liquidation
    (`lib/trading/order-math.ts`), hourly funding). Perps call `placeOrder` directly. Spot goes through
    `use-news-trader.ts`. Two-press confirm unless one-click.
  - TP/SL (`lib/trading/tpsl.ts` validates the side): reduce-only market-when-triggered orders. Hyperliquid: entry +
    triggers with grouping `normalTpsl`, open positions with `positionTpsl`. Lighter: types 4 (TP) / 2 (SL), IOC,
    expiry -1 (28 days), grouped with the entry via `SignCreateGroupedOrders` (OTO, or OTOCO for both) and as an
    OCO pair for open positions. Set from the order panel or the TP/SL button on a position row.
  - Order book (`order-book.tsx` + `use-order-book.ts`): plain WebSockets (HL `l2Book`/`trades`, Lighter
    `order_book/{id}`/`trade/{id}` with deltas), parsers and grouping in `lib/trading/orderbook.ts`. Clicking a price
    hands it to the order panel through `order-draft.tsx`.
  - Best execution (`use-best-execution.ts`, `lib/trading/execution.ts`): for market perp orders the order panel
    fetches both venues' REST books (HL `l2Book`, Lighter `orderBookOrders`), walks them for the USD size, adds taker
    fees (HL base tier 0.045% + builder fee; Lighter `taker_fee` + integrator fee) and shows the cost gap. With
    `autoRoute` (default on) the order goes to the best venue; picking a perp venue by hand turns it off.
  - Funding (`/api/funding` → Lighter's aggregated mainnet `funding-rates`, 8-hour rates for Hyperliquid, Lighter,
    Binance, Bybit; `lib/trading/funding.ts`): shown in the order panel and on the Markets page (`app/markets`,
    sidebar), which lists every tradable asset with funding per venue and the Hyperliquid–Lighter spread.
  - Funding arb (`components/markets/funding-arb-dialog.tsx`, Arb button on Markets rows listed on both venues):
    market long on the low-funding venue + market short on the high-funding one, same base size (`arbLegSize`,
    coarser size step), sent together; a half-filled pair is reported so the user can close the unhedged leg.
  - News perp trades also go to the best quote (`quoteVenues`) when `autoRoute` is on; analytics records the venue
    actually used.
  - Funds (`deposit-dialog.tsx`, "Deposit / Withdraw" in the account panel; `lib/venues/deposits.ts` +
    `deposit-client.ts`, viem on demand): mainnet Hyperliquid = native USDC transfer on Arbitrum to Bridge2
    (`0x2Df1…3dF7`, min 5 USDC, less is lost); mainnet Lighter = USDC on Arbitrum/Base to the wallet's CCTP intent
    address (`createIntentAddress`); testnets link to each venue's faucet. Hyperliquid withdrawals: `withdraw3`
    signed by the wallet (1 USDC fee, 3-4 min). Lighter's universal deposit address needs a builder key (not used).
    Move (Lighter tab, mainnet only): Hyperliquid `withdraw3` → poll the wallet's Arbitrum USDC until it lands
    (`withdrawalArrived`) → deposit to the Lighter intent address. The order panel shows total buying power and, when
    the chosen venue lacks margin, offers to trade on a funded venue, move funds or deposit (`openDeposit(venue, mode)`).
  - Pro order (`pro-order-dialog.tsx`, yellow "Pro order" in the sidebar/top bar/mobile menu; logic in
    `lib/trading/pro-order.ts`): hedge (same coin long on one perp venue, short on another, same base size at the
    coarser step) or multi (up to `MAX_PRO_LEGS` market orders on any venue and coin), sent together behind a confirm
    press; partial results are reported. "Bridge" next to it opens the funds window on the HL → Lighter move.
    The order panel starts with a Perp | Spot switch (venues of that kind only; a kind the asset lacks is disabled).
  - Merged book and split orders: with two venues listing the asset the order book defaults to "All venues"
    (`mergeVenueBooks`: levels summed per price, bars split by venue color, "Crossed" when one venue's bid tops the
    other's ask; trades merged with venue dots). `useBestExecution` also returns `splitExecution` (cheapest levels of
    both books after fees); the order panel offers "Split HL $X + Lighter $Y" when it saves ≥ $0.25 and 0.5 bp, every
    leg clears its venue minimum (`minOrderUsd`) and no TP/SL is set, and sends the legs in parallel.
  - Portfolio (`positions-bar.tsx`): positions/orders of every perp venue with a venue filter, liquidation distance
    from the mark, a Venues tab (`lib/trading/portfolio.ts`: account value, uPnL, margin used, withdrawable per venue
    and in total), and close-all (all, per filter or per venue) behind a confirm press.
- Shell: same layout as news.angler.network. `components/app/sidebar.tsx` (Terminal, News link, Wallets, Settings)
  and `components/app/settings-dialog.tsx` (General, Appearance, News filters, Trading, Venues & networks,
  Notifications, About; `openSettings(section)` opens a given section),
  built from the copied angler-news `form-controls`, `select-field`, `appearance-settings`. Venues can be turned off
  (`venueHyperliquid`, `venueLighter`, `venueJupiter`); each perp venue's network can be overridden per browser
  (`HL_NETWORK_OVERRIDE_KEY`, `LIGHTER_NETWORK_OVERRIDE_KEY`, applied after a reload; the markets routes follow
  `?network=`). The trading provider merges both perp venues' positions and orders (venue badge in the positions
  bar; close/cancel route by `venue`); the account panel and setup dialog have a section per perp venue.
- Onboarding (`components/app/alpha-notice.tsx`), once per browser, no skip: Welcome → "Make it yours" (theme,
  accent, framed or full screen, sidebar or top navigation, tape position; applied live) → "What do you want on your
  screen?" (`layoutPresets` News trader / Pro trader / Minimal + panel chips, written to `panels`) → a 3-line alpha
  notice. Bump `ACK_KEY` to show it again; Settings → About reopens it. Keep it short: no text-heavy slides.
- Wallets: one Connect button opens `wallet-modal.tsx`: a grid of colored venue tiles (logo, name, kind; built to take
  more venues), connected wallets listed once per chain below. Choosing a venue lists the wallets for its chain: EVM via EIP-6963 discovery, Solana via Wallet
  Standard. One wallet per chain serves every venue on that chain. The account panel (`account-panel.tsx`: balances, trading key) and
  its grid column only appear once a wallet is connected. Perp leverage for news trades lives in settings.
- News reaction (`components/news/news-reaction.tsx`, on tradable cards): how the lead asset moved 1h/4h/24h after
  its past news in the same impact bucket (`reactionBucket`: 40/60/80). `/api/news/reaction` (`lib/news/reaction-server.ts`,
  cached 15 min) pages `/v1/news?coin=` back ~50 days, merges bursts within an hour (`distinctEvents`) and prices
  them from Hyperliquid mainnet 15m candles (`xyz:` dex for stocks); math in `lib/news/reaction.ts`. The API's
  `exposure_outcomes` would be the source once the terminal key has a plan (it returns nothing without one).
- News rules (`lib/news/rules.ts`, `newsRules` preference, Settings → News rules, ⚡ button in the feed header):
  asset (any / my positions / ticker), minimum impact, sentiment (any / bullish / bearish / adverse to my position;
  direction comes from the asset's impact prediction, else the sentiment, so REST items only match "any"), action
  (alert, long/short $N on the best perp venue through `use-news-trader.ts`, close the position). `news-rules-runner.tsx`
  runs them on fresh enriched items while the tab is open: a toast with a one-press action unless the rule is
  automatic; cooldowns 1 min (alerts) and 5 min (trades) per rule.
- High-impact highlight: `lib/trading/high-impact.ts` (threshold and sound in settings, sound off by default).
  `newsNotifications` (Settings → Notifications, asks for permission) shows a browser notification for fresh
  high-impact items while the tab is in the background (`lib/alerts/notify.ts`; click focuses the tab and selects the
  item). No push server: notifications need an open tab. `app/manifest.ts` makes the site installable (PWA).
- Analytics: `lib/analytics/*` keeps daily totals only (trades, filled USD volume, estimated partner fees per venue,
  news-driven and one-click counts) in Redis (`KV_REST_API_URL`/`TOKEN`, Upstash REST; memory without it). Perp
  volume is the fill (`filledUsd`, our fee from `OrderResult.partnerFeeBps`), spot volume the USDC/USDG side; spot
  fees are estimated from server config (Jupiter net of its 20%). Never store wallet addresses, IPs or per-trade
  records; the rate limit hashes the IP into a key that expires after a minute. POST checks Origin and allows 30
  events a minute per client. The totals are private: only `GET /api/analytics/trade` (`ANALYTICS_TOKEN`) reads
  them (all-time, 7/30-day sums, per day, top news); there is no public stats page.
- The disclaimer "Not financial advice. Scores are model outputs." lives in the onboarding alpha step and in Settings
  (Trading, About); the user asked to keep it off the trading screen.
- Wallets never connect on page load unless the user clicked Connect in this app before (wallet permissions are per
  origin and may come from another app on the same origin).
- Chart engine: the `chart` preference (Settings → General) picks the Angler chart (Lightweight Charts, news markers)
  or the TradingView advanced chart widget from angler-news, opened on the selected asset (`lib/chart/tradingview.ts`:
  crypto → `BINANCE:<SYM>USDT.P`, stocks → ticker). The widget has its own interval bar, so ours is hidden.
- Chart intervals: `lib/chart/candles.ts` lists the 14 intervals Binance and Hyperliquid both accept (1m–1M);
  `components/chart/interval-picker.tsx` shows starred ones (`chartFavoriteIntervals`) as quick buttons. In the
  terminal the chart header measures what's left after the market stats and passes `maxQuick` (`lib/chart/interval-fit.ts`):
  narrow headers keep only the active interval, the rest stay in the dropdown.
- Selected asset lives in `components/terminal/selected-asset.tsx`; news chips call `selectAsset`. Clicking a ticker
  tape pill calls `focusAsset`: it selects the chart and narrows the feed to that symbol (`newsFocus`, cleared from
  the "Only X" chip). The clickable pill is a terminal-only change to the copied `ticker-pill.tsx`/`ticker-tape.tsx`.
  The feed renders `news-card.tsx` with a terminal-only `compact` prop (smaller icon, type and padding); the empty
  positions panel shrinks to its tabs and one line.
- News filters (`lib/news/filter.ts`, saved as the `newsFilters` preference, edited in settings and from the feed
  header): assets, sentiment (±0.15 is neutral), severity, minimum impact, raw headlines. Raw items have no assets,
  so they are hidden while an asset filter or focus is on. With one asset (focus or a single filter) the feed's REST
  history is requested with `coin`.
- Out of scope: Supabase auth, memberships, payments, admin, referrals, Telegram. The terminal has no login.

- First load stays light: the Hyperliquid SDK (`hyperliquid/clients.ts`), viem's wallet client (`getWalletClient`),
  the Arcus SDK (`arcus/venue.ts`; lookups in `arcus/catalog.ts`) and the settings/setup dialogs (`lazy-dialogs.tsx`)
  load on demand. Don't import them statically from components on the first screen. The ticker bar streams its
  server-fetched prices through Suspense so the page shell never waits on market APIs.
- Motion (`lib/motion.ts`, hooks in `components/app/use-motion.ts`): GSAP loads on the first press or key, or once the
  page has settled (`useMotionPreload` in `lazy-dialogs.tsx`); never import `gsap` statically. `motion()` is null until
  then and under `prefers-reduced-motion`, so content never waits on an animation. Entrances clear their inline styles
  when done (`ENTER_PROPS`: a leftover transform breaks `position: fixed` children) and revert on cleanup. Used for
  overlay dialogs (`useModalEnter` on the backdrop), native dialogs and popovers (`riseIn`), onboarding steps, toasts
  (enter, collapse on dismiss), news arrivals and new position/order rows (`useListEnter`: never the first render,
  at most `MAX_ANIMATED_ARRIVALS` at once) and mobile view switches.
- Chart refresh: every 30s the chart fetches only from the last closed candle (`since`) and merges it
  (`lib/chart/merge-candles.ts`). The chart key follows the first venue only, so a fallback venue's market list
  arriving later doesn't clear the chart and refetch. Loading states keep their final size (order panel skeleton,
  mobile stats row, interval fit measured before paint) so nothing shifts when data lands.

## Checks

`npm test` (vitest, `*.test.ts` next to the module), `npm run typecheck` and `npm run build` must pass before
pushing. Pure logic (pricing, parsing, error mapping, storage) gets unit tests; network and wallet code does not.

In Claude Code cloud sessions, Node's built-in fetch ignores `HTTPS_PROXY`: start the app (or any script that calls
external APIs) with `NODE_USE_ENV_PROXY=1`. Delete `.next/cache` after running against mocks, since `unstable_cache`
persists responses across builds.
