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

- Theme: Tailwind CSS 4, configured in CSS (no `tailwind.config`): `app/globals.css` holds the `--app-*` channel
  variables per theme and the `@theme` tokens (`--color-app-*` → `bg-app-card/55` etc.).
- Font: Sora is self-hosted in `public/fonts` (SIL OFL, `OFL.txt` next to it), declared in `globals.css` with a
  metric-matched "Sora Fallback", and the Latin file is preloaded from `app/layout.tsx` (a `Link` header). Not
  `next/font`: it only hinted the font late in the page, so text repainted seconds after the first paint. File names
  carry a content hash (`next.config.mjs` caches `/fonts/*` for a year); rename the file when replacing it.
  Never put two display utilities on one element (`inline-flex hidden lg:inline-flex`): Tailwind 4's stylesheet order
  differs from 3's, so set the display per breakpoint instead. Default look is the `oled` theme with the `liquid`
  surface (`APPEARANCE_VERSION` in `lib/preferences.ts` moves older saved looks to it once).
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
  - Two exchanges, one code path: core Lighter (venue `lighter`, USDC) and Lighter on Robinhood Chain (venue
    `lighterRh`, "Lighter RH": USDG margin, mostly stock perps, the venue behind Robinhood Wallet's perps; docs
    apidocs.rh.lighter.xyz). Same tx format, signer, REST and WebSocket; separate accounts, keys, nonces, markets.
    Every module takes a `LighterConfig` (`lighterConfig` / `lighterRhConfig`, `lighterConfigs[venue]`): base URL and
    chain id travel together (RH mainnet `api.rh.lighter.xyz`, chain 466324; testnet `api.rh-testnet.lighter.xyz`,
    chain 300, only BTC/SOL/ETH). `createLighterVenue(config)` builds each venue; `storeKey` separates browser keys
    and caches (core keeps the bare network so existing keys stay found). RH env: `NEXT_PUBLIC_LIGHTER_RH_*`
    (network, integrator account/fee/max, referral); key slot shared, never 157 (reserved on RH). RH marks every
    market strategy 0, so `forInstance` names its crypto (`RH_CRYPTO`) and calls the rest stocks. Deposits: USDG on
    Robinhood Chain to the RH intent address (`createIntentAddress` chain_id 4663, ≥ 1 USDG; `ROBINHOOD` source,
    viem chain from `arcus/config`). The trading provider runs `useLighterInstance` per exchange; the account
    panel, setup dialog, deposit dialog, merged order book (up to three venues), best execution, chart candles and
    profile points (same client-order tag) handle both. Still core-only: portfolio/order history, the testnet
    faucet, funding rates (the feed has no RH).
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
  takes the `ExpectedWinner` route and builds the unsigned v0 transaction server-side (Titan returns instructions
  only); `app/api/titan/execute` sends the signed tx through `SOLANA_RPC_URL` and waits for confirmation. Both use
  `@solana/kit` (server only; `@solana/web3.js` 1.x pulled in vulnerable jayson deps and is gone); `server.test.ts`
  pins the exact transaction bytes the old web3.js code produced for the fixture. `use-news-trader.ts` asks Jupiter
  and Titan in parallel and executes the larger output (`lib/trading/best-quote.ts`, Jupiter wins ties). No key → 503 → Jupiter alone. Partner fee (`fees.ts`):
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
    sidebar/top bar) and Settings → Layout). Default columns: chart (rest of the width) | order book | trading column
    (order panel + account card on top, news under it, full height), with the positions running under both the chart
    and the order book (`positionsSpanRail`: whenever the order book has the column next to the chart); side widths use
    `clamp(…vw)` so the chart keeps room on laptops. The sidebar and top bar hide like angler-news
    (`layout-toggles.tsx`, always available here). Every panel edge facing the chart has a drag handle
    (`panel-resizer.tsx`, desktop only; double-click or Home resets): positions height (`positionsHeight`), watchlist,
    trading and news column widths and the order book height (`panelSizes`, `lib/layout/panel-sizes.ts`). A dragged
    width is capped at a share of the grid (`min(Wpx, N%)`) and a drag stops where the chart would drop below 360px.
  - Mobile (below `lg`, 1024px): no rail, no frame, top bar always shown; a bottom tab bar (`mobile-nav.tsx`: Chart,
    Trade, News, Portfolio, More → Markets / Wallets / Settings / news site) switches full-screen views
    (`mobile-view.tsx` context; `terminal-shell.tsx` hides the others with `max-lg:hidden`, so no layout flash, and
    renders every panel whatever the desktop `panels`). Trade = order panel + account + order book, scrolling. The
    chart header wraps the stats to their own row. Toasts sit above the tab bar; dialogs cap at the viewport height;
    `viewportFit: "cover"` + `env(safe-area-inset-bottom)` keep the bar above the home indicator. News asset chips
    switch to the Chart view on phones.
  - Chart header: asset, price, then `market-stats.tsx` (mark, 24h volume, open interest from the venue market list,
    hourly funding + countdown to the top of the hour; `lib/trading/market-stats.ts`) and the interval picker.
  - Arrangement (`arrangement` preference, `lib/layout/arrangement.ts`): column order (watchlist, main = chart +
  positions, rail, trade) and which of the order book / news sits under the order panel (default: news there, order
  book in the rail next to the chart; a saved copy of the old default, rail last, moves to it once via `version`). Hover a panel, drag the grip at its top onto another to swap (`ArrangeHandle`, HTML5 drag and
  drop in `terminal-shell.tsx`); Layout menu → Reset arrangement. Phones keep the order book under the order panel.
- Page mode (`fitToScreen`, Layout menu and Settings → Layout, `html[data-viewport=fit]` set before hydration):
  desktop scrolls by default, with the top bar and rail sticky and the terminal grid on `--rows-scroll`: a fixed 988px
  grid (620px chart over 360px positions by default), so dragging the positions edge moves the line between them
  instead of stretching the side columns; list pages (`.app-main` without `.terminal-grid`) stay one screen tall. Fit screen is
  the old one-screen layout. CSS in `globals.css` ("Desktop page mode").
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
  - Funds (`deposit-dialog.tsx`, "Deposit / Withdraw" in the account panel, "Bridge" in the sidebar/top bar; routes in
    `lib/venues/bridge-routes.ts`, transfers in `lib/venues/deposits.ts` + `deposit-client.ts`, viem on demand): one
    sentence for every flow, "Move [amount] [token] from [Wallet on chain | venue] to [Wallet on chain | venue]". The
    wallet side picks USDC on Arbitrum or Base or USDG on Robinhood Chain (where Arcus trades). `fundsRoute` turns the
    pair into steps the window runs in order (one wallet signature each; waits keep polling with the window closed and
    toast when the next step is ready): `hlWithdraw` (Hyperliquid `withdraw3`, 1 USDC fee, lands on Arbitrum in 3-4
    min, `withdrawalArrived`), `across` (below), `transfer` (mainnet Hyperliquid = native USDC on Arbitrum to Bridge2
    `0x2Df1…3dF7`, min 5, less is lost, credits the sender; Lighter = USDC on Arbitrum/Base to the wallet's CCTP
    intent address (`createIntentAddress`); Lighter RH = USDG on Robinhood Chain to its intent address, min 1).
    Examples: HL → Lighter RH = withdraw + Across USDC → USDG paid straight to the RH intent address; Base → HL =
    Across to the wallet on Arbitrum + transfer. Lighter/RH withdrawals and other venues say "coming soon"; testnets
    use faucets (Lighter's universal deposit address needs a builder key, not used). Deposit / Withdraw / Bridge tabs
    only preset the pair (`presetRoute`). Pickers portal their list to the body (the dialog's blur clips a fixed list).
    The order panel shows total buying power and, when the chosen venue lacks margin, offers to trade on a funded
    venue, move funds or deposit (`openDeposit(venue, mode)`).
  - Across (`lib/venues/across*.ts`, `app/api/across/[...path]`): the intent bridge Robinhood lists as a partner and
    Uniswap's own bridging runs on (chosen over Uniswap's API: same bridge, no extra layer or key). Mainnet only.
    The browser calls our proxy (`swap/approval` → app.across.to/api, `deposit/status` → indexer.api.across.to; the
    server adds `ACROSS_INTEGRATOR_ID` and the optional `ACROSS_APP_FEE` + `ACROSS_APP_FEE_RECIPIENT`, never the
    browser). Signing uses the official `@across-protocol/app-sdk` (pinned, loaded on demand): a fresh exactInput quote
    right before signing, approval + deposit on the origin chain, then the indexer status until `filled` (`expired` /
    `refunded` = funds back on origin). A Lighter recipient must clear its deposit minimum after fees (`minOutputAmount`).
  - Pro order (`pro-order-dialog.tsx`, yellow "Pro order" in the sidebar/top bar/mobile menu; logic in
    `lib/trading/pro-order.ts`): hedge (same coin long on one perp venue, short on another, same base size at the
    coarser step) or multi (up to `MAX_PRO_LEGS` market orders on any venue and coin), sent together behind a confirm
    press; partial results are reported. "Bridge" next to it opens the funds window on the HL → Lighter move.
    The market type comes from the route (`/perp`, `/spot`, `lib/terminal-kind.ts`), not a switch in the panel: an
    asset without a venue of that kind shows a link to the other view.
  - Merged book and split orders: with two venues listing the asset the order book defaults to "All venues"
    (`mergeVenueBooks`: levels summed per price, bars split by venue color, "Crossed" when one venue's bid tops the
    other's ask; trades merged with venue dots). `useBestExecution` also returns `splitExecution` (cheapest levels of
    both books after fees); the order panel offers "Split HL $X + Lighter $Y" when it saves ≥ $0.25 and 0.5 bp, every
    leg clears its venue minimum (`minOrderUsd`) and no TP/SL is set, and sends the legs in parallel.
  - Portfolio (`positions-bar.tsx`): positions/orders of every perp venue with a venue filter, liquidation distance
    from the mark, a Venues tab (`lib/trading/portfolio.ts`: account value, uPnL, margin used, withdrawable per venue
    and in total), and close-all (all, per filter or per venue) behind a confirm press.
- Routes: the terminal is `/perp` and `/spot`, both rendered by `app/(terminal)/layout.tsx` (the shell lives in the
  layout, so switching views keeps the chart, books and news feed mounted; the pages only set titles). `/` redirects
  to `/perp` (`next.config.mjs`). `/prediction` is the prediction page (below) and `app/not-found.tsx` the 404
  (`StatusScreen`). Perp / Spot / Prediction lead every
  navigation from one list (`components/app/market-nav.ts`: sidebar, top bar, phone menu). /spot hides the order book
  (Jupiter and Arcus are AMM/routers) and shows the spot venues' balances in the account card; /perp the perp ones.
- Prediction (`/prediction`, `components/prediction/*`, `lib/prediction/*`): Polymarket and Hyperliquid HIP-4
  outcome markets in one shape (`types.ts`: event → binary markets → two outcomes with price = probability and the
  traded asset). Polymarket is where the volume is (HIP-4 traded ~$51M in September, about 0.07% of Polymarket +
  Kalshi), HIP-4 trades with the account the terminal already has. Polymarket is blocked by ISPs in Turkey (DNS points
  at a block page): develop it over a VPN exit outside Polymarket's geoblock list, and never route orders through
  our server to get around a block.
  - Data goes through our server (`server.ts`, `unstable_cache`): Gamma `/events` (top 150 by 24h volume),
    `/public-search`, `/events/{id}`; CLOB `/prices-history` and `/book`; Hyperliquid `outcomeMeta` + `allMids`,
    `candleSnapshot` and `l2Book` for `#N` coins. Routes: `/api/prediction/{events,event,history,book}`.
  - Polymarket (`polymarket.ts`): Gamma sends outcomes, prices and ids as JSON strings; V2 markets trade by
    `positionIds`, older ones by `clobTokenIds`; categories come from tags; neg-risk events are one-winner
    (`exclusive`, likeliest first), others keep Gamma's order (price strikes, game lines).
  - HIP-4 (`hip4.ts`): outcome `o`, side `s` (0 = Yes) trades as coin `#(10o+s)`, order asset `100000000 + 10o+s`,
    balances `+N`. Titles come from the deployers' templates (pipe-separated `key:value` descriptions): questions
    (one winner among named outcomes; the 0.5-placeholder "Other" is hidden) and standalone outcomes grouped by
    asset+date ("BTC above ___ on Oct 8?"), game, or IPO deadline; hand-written questions get a category from their
    words; events that ended 3+ days ago are dropped (testnet keeps months of them).
  - HIP-4 trading (`lib/venues/hyperliquid/outcomes.ts`, `hip4-trade.ts`): same agent key and builder fee as perps,
    IOC at the best ask/bid ± 5¢ inside (0, 1), whole contracts, ≥ $10 per order. Outcomes spend spot USDC (shared on
    unified accounts); a standard account gets "Move $X from perps to spot" (`usdClassTransfer`, user-signed).
    Fills carry our builder fee, so profile points count them.
  - Polymarket trading (`lib/venues/polymarket/*`, `components/prediction/polymarket-trade.tsx`): the official SDK
    `@polymarket/client` (pinned, loaded on demand). The user's EVM wallet (switched to Polygon, chain 137) signs;
    the account is a Deposit Wallet the SDK derives and deploys gaslessly through Polymarket's relayer. Builder
    headers come from `/api/prediction/polymarket/sign` (`remoteBuilderSigning`; `POLYMARKET_BUILDER_*` stay on the
    server; Origin must match, POST/DELETE to plain paths only, rate limited). Orders go straight from the browser to
    Polymarket with `builderCode` (`NEXT_PUBLIC_POLYMARKET_BUILDER_CODE`): market orders with `maxSpend` and a 5¢
    price cap, one wallet signature each. L2 credentials stay in sessionStorage for the tab. Polymarket's
    `/api/geoblock` runs in the browser first; blocked or unreachable (Turkey's DNS block) means no trading. Funding:
    `bridge.polymarket.com/deposit` gives the account an EVM deposit address; "Deposit from Arbitrum/Base" sends USDC
    there with `sendUsdc` (≥ $2), converted to pUSD. Polymarket volume doesn't earn profile points yet.
- Spot pairs (`lib/spot/listings.ts`, `lib/spot/server.ts`, `GET /api/spot/listings` cached 2 min, `/api/spot/search`):
  live from the venues' pools, never a fixed list. Jupiter `toptraded/24h` + `toporganicscore/24h` + `tag=stocks`,
  Arcus stock/index/commodity tokens priced from the same asset's perp quote. Dollar tokens (Jupiter tags `stable`,
  or `yb` named after USD) stay listed but sort last. An asset without a token of its own ticker (BTC on Solana)
  trades as the most traded verified token that represents it (24h volume first, pool liquidity second: WBTC parks
  more liquidity, cbBTC trades ~4x more) (`representsAsset`: same
  ticker, a wrapper named "wrapped"/"bridged" or after the asset, a tokenized stock; staked/leveraged versions never)
  — `/api/jup/token` falls back to it, so BTC → cbBTC or WBTC by live volume; the watchlist highlights that token. Unverified tokens never win: Jupiter's
  search for "BTC" returns a dozen scam "BTC" tokens with millions in liquidity (`fixtures/jup-search-btc.json`).
  `assetSymbolOf` maps a token back to the terminal asset (WBTC → BTC) so picking it moves the chart and news.
- Spot charts: on /spot the chart header and candles are the traded token's (`use-spot-chart-token.ts`: cbBTC with its
  logo, price, liquidity, volume, market cap), not the asset's. Candles come from the token's busiest DEX pool via
  `GET /api/spot/candles` (`lib/spot/pool-candles*.ts`: GeckoTerminal; CoinGecko's on-chain API with
  `COINGECKO_API_KEY`, `COINGECKO_API_PLAN=pro` for paid plans). Calls are scarce (free: ~10/min site-wide; keyed:
  monthly credits possibly shared with the Angler API), so the server fetches 1000 base candles per pool and timeframe
  once every 5 minutes and slices them for every interval and refresh, pools are cached an hour, and a keyed setup
  stops at `COINGECKO_DAILY_BUDGET` calls a day (`takeDailyBudget`, Redis). Between fetches `applyLivePrice` moves the
  last candle with the token's live price. Any failure falls back to the asset's market chart. Intervals
  GeckoTerminal lacks (3m, 30m, 2h, 8h, 3d, 1w, 1M) merge smaller candles (`resampleCandles`).
- Market search (`components/terminal/asset-search.tsx`, Ctrl/⌘+K or the chart header's symbol button): perp
  markets of the enabled venues, or spot pairs + live Jupiter search ("Verified only" on by default), category tabs,
  sortable columns, ★ favorites (Ctrl+S) stored as the `watchlist` preference (`lib/watchlist.ts`, validated on read). Rows come from
  `market-rows.tsx`, shared with the optional Watchlist panel (`panels.watchlist`, off by default, on in the Pro
  preset): a column left of the chart with All / Yours (perp positions or Solana tokens) / Starred.
- History (positions bar tabs, loaded on demand from `history-tables.tsx`): Order history = Hyperliquid
  `historicalOrders` (open ones dropped, they have their own tab) + Lighter `accountInactiveOrders` (auth token:
  only a browser holding the account's trading key can read it), mapped in `lib/trading/order-history.ts`. Position
  history is rebuilt from the 30-day fills (`lib/trading/position-history.ts`): flat → flat per venue and asset,
  seeded from Hyperliquid's `startPosition` (exact even when the venue caps fills at 2000; checked against a live
  market maker: closed + still-open PnL equals the venue's total to the cent) or current size minus the window.
- Controls: no native `<select>` or range input. Dropdowns are `SelectField` (`size`: md settings rows, sm form
  fields, xs panel headers, ghost inline text); sliders are `RangeSlider` (native input drawn by `.range-slider` in
  `globals.css`, `marks` as breaks in the track).
- Shell: same layout as news.angler.network. `components/app/sidebar.tsx` (Perp, Spot, Prediction, Markets, Portfolio,
  Layout, News link, Pro order, Bridge, Settings; wallets are only the top bar's Connect button) and the settings
  page `app/settings/[[...section]]` → `components/app/settings-view.tsx` (sections in `lib/settings-sections.ts`, one
  URL each: `/settings`, `/settings/rules`…; `openSettings(section)` navigates there, `closeSettings` returns to the
  page the user came from, the terminal when they landed on it), built from the copied angler-news `form-controls`,
  `select-field`, `appearance-settings`. Venues can be turned off
  (`venueHyperliquid`, `venueLighter`, `venueJupiter`); each perp venue's network can be overridden per browser
  (`HL_NETWORK_OVERRIDE_KEY`, `LIGHTER_NETWORK_OVERRIDE_KEY`, applied after a reload; the markets routes follow
  `?network=`). The trading provider merges both perp venues' positions and orders (venue badge in the positions
  bar; close/cancel route by `venue`); the setup dialog has a section per perp venue; the account
  panel shows only the venue the order panel trades on (`tradeVenue`, else `preferredPerpVenue`), so more venues
  don't add Deposit buttons.
- Onboarding (`components/app/alpha-notice.tsx`), once per browser, no skip: Welcome → "Make it yours" (theme,
  accent, framed or full screen, sidebar or top navigation, tape position; applied live) → "What do you want on your
  screen?" (`layoutPresets` News trader / Pro trader / Minimal + panel chips, written to `panels`) → a 3-line alpha
  notice. Bump `ONBOARDING_ACK_KEY` (`lib/onboarding.ts`) to show it again; Settings → About reopens it. Keep it short:
  no text-heavy slides. It is the first visit's largest paint, so it opens before hydration: `onboardingScript` (head)
  marks `html[data-welcome]` when the acknowledgement is missing, the server always renders the welcome step, and
  `openOnboardingScript` (right after it in `layout.tsx`) calls `showModal()` at once. Opening it from React later
  would move it into the top layer after its first paint (a new, later LCP). The welcome logo is a CSS background
  (`.welcome-logo`) so it only downloads when the dialog is open.
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
  records in analytics (profiles, below, are the one exception for wallet addresses); the rate limit hashes the IP
  into a key that expires after a minute (`lib/redis.ts` is shared with profiles). POST checks Origin and allows 30
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
- SEO: both sites are indexed (`isIndexable` in `lib/site.ts`: any pinned `NEXT_PUBLIC_DEPLOYMENT`; dev builds stay
  `noindex`), each with its own canonical origin (`siteUrl`, `NEXT_PUBLIC_SITE_URL` overrides). `app/robots.ts` keeps
  crawlers off `/api/`, `app/sitemap.ts` lists the terminal and Markets. The link preview is the brand banner
  (`app/opengraph-image.jpg` + `twitter-image.jpg`, angler-landing's `assets/og-banner.jpg`, used unchanged). Vercel
  marks preview deployments `noindex` itself.
- Profile (`/profile`, `/profile/portfolio`, `/profile/leaderboard`; `components/profile/*`, `lib/profile/*`): the
  top bar's avatar button (`profile-button.tsx`, once a wallet connects) leads to it. A profile is keyed by the wallet
  (EVM address lowercase, else the Solana address; `identity.ts`). Usernames (3-20 `[A-Za-z0-9_]`, unique ignoring
  case) are set by signing a plain-text message (`profileMessage`, EVM `personal_sign` or Solana `signMessage`,
  accepted for 10 minutes; no gas, no login). Points: 0.01 per dollar traded through Angler (a point per $100) (`levels.ts`, ten fishing
  levels Minnow → Whale), only from the venues' own records (`volume.ts`, `server.ts`): Hyperliquid fills whose
  `builderFee` matches our builder rate (`userFillsByTime`, the last 10,000 fills on first sync), Lighter trades whose
  own side's client order index ends in `ANGLER_CLIENT_TAG` (`lighter/pricing.ts`; counted from 2026-10-07, earlier
  orders weren't tagged), Solana swaps whose transaction pays our Jupiter referral token account (PDA
  `referral_ata` + account + mint) or Titan fee USDC account, volume = the signer's USDC change, each transaction
  once. Perp volume syncs when the profile loads (`GET /api/profile/{id}?sync=1`, at most once a minute per profile,
  cursors per venue); swaps are claimed after they confirm (`claimSwapPoints` → `POST /api/profile/swap`). A Solana
  wallet can be linked to an EVM profile (signed by the Solana wallet): its volume moves over and later swaps count
  there. Stored in Redis per deployment (`store.ts`, memory without Redis): the one place wallet addresses are kept.
  Referrals: `?ref=<username or address>` is kept in localStorage; the profile page applies it with a signed
  "Use referral code" message (`POST /api/profile/referral`, once, never changed). The referrer earns 10% of the
  referred profile's volume after joining as points (`refUsd`, `REFERRAL_SHARE`), never a referrer's own bonus.
  The top bar has one account control (`profile-button.tsx`): Connect, then a dropdown with Profile, Portfolio, Referrals, Wallets (Layout is in the sidebar).
  Arcus volume doesn't count yet. The portfolio lives under the profile (`/portfolio` redirects).
- Out of scope: Supabase auth, memberships, payments, admin, referrals, Telegram. The terminal has no login.

- First load stays light: the Hyperliquid SDK (`hyperliquid/clients.ts`), viem's wallet client (`getWalletClient`),
  the Arcus SDK (`arcus/venue.ts`; lookups in `arcus/catalog.ts`) and the settings/setup dialogs (`lazy-dialogs.tsx`)
  load on demand. Don't import them statically from components on the first screen. The ticker bar streams its
  server-fetched prices through Suspense so the page shell never waits on market APIs.
- Server-rendered chart price (the mobile LCP element): preferences mirror the chart's asset, market type and price
  source into the `angler_chart` cookie (`CHART_COOKIE`, next to the tape's `angler_tape`). `app/layout.tsx` seeds
  `PreferencesProvider` with it so the server and the first client render show the same asset, and `app/page.tsx`
  streams that one quote (`chartQuote`, from the cached `getMarkets`, never the whole list) through
  `InitialQuoteProvider`. The header's `QuoteSlot` renders the browser's live quote and the streamed one through the
  same element: replacing the element would register a later LCP. Measured on a throttled phone: LCP 5.5s → 1.7s.
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
