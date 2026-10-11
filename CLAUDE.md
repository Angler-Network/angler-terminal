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
  surface (`APPEARANCE_VERSION` in `lib/preferences.ts` moves older saved looks to it once). Likewise `VENUES_VERSION` drops saved
  Aster/Arcus switches older than it once (they had stuck at "off" from when those venues were unavailable or off by
  default); Aster is on by default wherever it's offered. Saved preferences also carry `venuesSeen` (the venues the site offered when
  they were saved): a venue switch saved while its venue wasn't offered (its key not set yet) is ignored, so a venue
  configured later comes on for every returning visitor, while one the user turned off stays off. Saves without it
  fall back to the default switches once.
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
  - Pause: `ANGLER_API_PAUSED=1` (server env, redeploy) turns the news API off on purpose: `anglerConfig()` reports
    no key, so nothing calls it (feed, sources, reaction, alerts news); the routes answer 503 `{ paused: true }` and
    the feed shows "Paused" and stops asking (no ticket retries, no polling). Unpaused but failing, the routes answer
    502 at once for 30s after a failure (`anglerDown`) and ticket retries back off from 5s to 5 min.
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
  (preferences, wallet tiles, settings rows, account sections): testnet drops every venue with no testnet (Jupiter, Titan,
  Uniswap, 0x, KyberSwap, LI.FI swaps, and Aster, whose API is mainnet only); mainnet offers only
  venues whose required settings exist, from `NEXT_PUBLIC_CONFIGURED_VENUES`, which `next.config.mjs` derives at build
  time from env presence (names only: HL needs a real `NEXT_PUBLIC_HL_BUILDER_ADDRESS`, Jupiter `JUP_API_KEY`, Titan
  `TITAN_API_KEY`, Uniswap `UNISWAP_API_KEY`; Lighter and Arcus need nothing: the Arcus router answers our proxy
  without a key, which only adds the builder fee). A Testnet badge in the top bar links to
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
    Referral: with `NEXT_PUBLIC_HL_REFERRAL_CODE` the "Create trading key" step offers an opt-in checkbox (on by default);
    `applyHlReferral` sends `setReferrer` signed by the new agent (no wallet popup) unless `info.referral` shows the
    account already has a referrer (Hyperliquid never replaces one). Users get 4% off Hyperliquid's fees (first $25M),
    the code owner 10% of them (first $1B); a failure is an info toast. Aster has no API to apply a referral code (its
    web app only), and an Orderly referral would be paid out of our own broker fee, so neither is wired.
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
    (network, integrator account/fee/max, referral); key slot shared, never 157 (reserved on RH). Web app:
    robinhoodchain.lighter.xyz (`APP_URLS.rh`; the account panel still opens RH accounts through the terminal's own USDG
    deposit). Integrator fees on both: millionths, perps capped at 1000 (10 bps, Lighter's Partner Attribution limit). RH marks every
    market strategy 0, so `forInstance` names its crypto (`RH_CRYPTO`) and calls the rest stocks. Deposits: USDG on
    Robinhood Chain to the RH intent address (`createIntentAddress` chain_id 4663, ≥ 1 USDG; `ROBINHOOD` source,
    viem chain from `arcus/config`). The trading provider runs `useLighterInstance` per exchange; the account
    panel, setup dialog, deposit dialog, merged order book (up to three venues), best execution, chart candles and
    profile points (same client-order tag) handle both. Order and position history cover both (`fromLighterOrder` / `fromLighterTrade` take the venue). Funding: `/api/funding` adds RH's own feed (`api.rh.lighter.xyz`,
    its "lighter" rows as venue `lighterRh`). Still core-only: the testnet faucet.
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
- Orderly (`lib/venues/orderly/`, a `PerpVenue` like Aster; docs orderly.network/docs, index /docs/llms.txt): an
  omnichain order book with no front end of its own; we trade as a broker. Every account is registered under our
  broker id (`NEXT_PUBLIC_ORDERLY_BROKER_ID`; mainnet offers Orderly only with it, testnet falls back to Orderly's demo
  `woofi_dex`), and our fee is the broker's rate set in Orderly's admin above its base (3 bps taker): orders carry no fee
  field, so `NEXT_PUBLIC_ORDERLY_TAKER_FEE` only feeds cost comparisons and analytics. Network: deployment, else
  `NEXT_PUBLIC_ORDERLY_NETWORK` (testnet default). Setup (`onboarding.ts`), two wallet EIP-712 signatures on the
  off-chain domain with the wallet moved to Arbitrum (Sepolia on testnet): `Registration` (nonce from
  `/v1/registration_nonce`, POST `/v1/register_account`; account id = keccak256(abi.encode(address, keccak256(broker))))
  then `AddOrderlyKey` (ed25519 key made here, scope read,trading, a year; POST `/v1/orderly_key`). The key's secret is
  AES-GCM encrypted with Lighter's device key (`key-crypto.ts`). Private requests carry `orderly-account-id/key/
  timestamp/signature` = ed25519 over `timestamp + METHOD + path?query + body`, base64url (`sign.ts`). Markets:
  `/v1/public/info` + `/v1/public/futures`, broker-only markets (`broker_id` set) dropped, lots can be 100
  (`roundToTick`). Orders POST `/v1/order` (MARKET/LIMIT; read back from `/v1/order/{id}` until final), leverage POST
  `/v1/client/leverages` per symbol, cancel DELETE `/v1/order?order_id&symbol`, account = `/v1/positions` +
  `/v1/orders?status=INCOMPLETE` every 3s, candles `/tv/history`. TP/SL: POST `/v1/algo/order` `POSITIONAL_TP_SL` (mark price, `CLOSE_POSITION`
  children) placed after a market fill or from the position row. A limit entry with TP/SL is one `BRACKET` algo order
  (`LIMIT` + a `POSITIONAL_TP_SL` child, per the create-algo-order docs), listed from `/v1/algo/orders?status=INCOMPLETE&
  algo_type=BRACKET` as an open order with a negative `oid` (cancel → `DELETE /v1/algo/order`, which takes the TP/SL too;
  a plain-order copy carrying its `algo_order_id` is dropped). Not yet seen live: testnet's faucet never funded the test
  account, so check the first real bracket shows and cancels. Funding rates
  (`orderly/funding.ts`, `/v1/public/futures` + `/info`, normalized to 8h) join the Markets table. The REST book needs a signed account,
  so the order book and best execution read the public WebSocket (`stream.ts`: one shared socket; the path needs an
  account id Orderly knows (it refuses others since Oct 2026): `NEXT_PUBLIC_ORDERLY_STREAM_ID` first when set, else the
  docs' example id, `orderlyStreamIds`; a socket closed before its first message moves to the next,
  `{symbol}@orderbook` full snapshots + `@trade`, answers pings). Deposits (`depositToOrderly`): USDC approve + vault
  `deposit(VaultDepositFE{accountId, brokerHash, tokenHash, amount})` with `getDepositFee` as the value, Arbitrum or
  Base (vault `0x816f…67e9` on both); testnet points to Orderly's testnet app. Withdrawals (`withdraw.ts`, the funds window's Orderly → Wallet on
  Arbitrum, mainnet only): `/v1/withdraw_nonce`, the wallet signs EIP-712 `Withdraw` on the ledger domain (mainnet
  `0x6F7a…D203`, testnet `0x1826…abff`), amount in USDC base units (checked on testnet), POST `/v1/withdraw_request`;
  Orderly takes 1 USDC. Profile points: `lib/profile/orderly-volume.ts` reads the public broker leaderboard
  (`/v1/broker/leaderboard/daily?broker_id&address`, perp volume and broker fee per closed UTC day; only with our own
  broker id, never the demo one).
  Checked end to end on testnet with a throwaway wallet (register, key, signed GET/POST).
- Extended (`lib/venues/extended/`, a `PerpVenue`; API docs api.docs.extended.exchange, product docs
  docs.extended.exchange/llms.txt, official SDK `x10-python-trading-starknet`): a Starknet perp order book (moving to
  Circle's Arc on 22 Oct 2026: re-check hosts, the Stark/EIP-712 domains and deposits after it). Builder codes: every
  mainnet order carries `builderId` (`NEXT_PUBLIC_EXTENDED_BUILDER_ID`, our Extended clientId 300382) and `builderFee`
  (`NEXT_PUBLIC_EXTENDED_BUILDER_FEE`, default 0.00035, capped at `/user/fees?builderId` `builderFeeRate`), paid to that
  account daily; the fee is inside the Stark-signed max fee. Testnet orders carry none (the id is a mainnet account).
  Setup (`onboarding.ts`, checked end to end on testnet in the browser): EIP-712 `AccountCreation` on domain
  `{ name: signingDomain }` → Stark key via the WASM's `generate_private_key_from_eth_signature` (deterministic: an
  existing Extended account comes back), EIP-712 `AccountRegistration` + a Stark signature over pedersen(wallet, key)
  → `POST /auth/onboard` (idempotent), then `personal_sign("<path>@<time>")` → `POST /api/v1/user/account/api-key`
  (headers L1_SIGNATURE, L1_MESSAGE_TIME, X-X10-ACTIVE-ACCOUNT). Stark key and API key AES-GCM encrypted with the device
  key (`store.ts`); never log or send the Stark key. Signer: Extended's WASM `@x10xchange/stark-crypto-wrapper-wasm`
  (pinned; .wasm copied to `public/extended/`, rename with the version), `@scure/starknet` for the public key and
  pedersen; both load with the first signature. Orders (`venue.ts`, amounts in `amounts.ts` with BigInt decimals,
  pinned against the SDK's Decimal results): synthetic = qty × resolution, collateral = qty × price × resolution (buy
  rounds up, sell down; buyer's collateral and seller's synthetic negative), max fee = (taker + builder) × notional,
  rounded up, settlement expiry = expiry + 14 days; the order id is the hash as a decimal string (the external id).
  Market = IOC at the touch ± 1.5% inside the mark's band; limits GTT 28 days. TP/SL on entries ride on the order
  (`tpSlType: "ORDER"`); on positions a standalone `TPSL` order (`POSITION`, legs signed for max position value × 50 /
  price, or `ORDER` for part). Extended's ids pass 2^53: the terminal's `oid` hashes the external id (`oidOf`) and
  cancels go by `externalId`. No CORS on its REST API: the browser goes through `app/api/extended/[network]/[...path]`
  (Tokyo, `preferredRegion = "hnd1"`, next to Extended; paths allowlisted in `proxy.ts`; account and order paths refuse
  Extended's restricted countries by Vercel's `x-vercel-ip-country`/`-region`, `geo.ts`, an unknown country counting as
  restricted on Vercel: orders reach Extended from our IP, so this is what keeps restricted visitors out; never relax it)
  and `/api/extended/markets` (trimmed list, cached 30s, `markets-server.ts`, also feeding `/api/funding`: hourly × 8).
  Account: the v2 JSON-RPC WebSocket (`scope: "account"`, API key in the subscribe message, merged by
  `account-stream.ts`), REST polling every 10s through the proxy when it can't open (not verified live: this cloud
  sandbox passes no WebSockets). Book and trades: REST through the proxy every second (edge-cached 2s). Deposits: not in
  the funds window yet (`openDeposit("extended")` opens Extended's app; its bridge API is `/user/bridge/*` + Rhino.fi's
  `depositWithId`, wait for Arc). Testnet faucet `POST /api/v1/user/claim` ($1,000/hour; its first claims answered
  SYSTEM_ERROR in October 2026, so a testnet fill hasn't been seen yet). Not yet: profile points (`/api/v1/builder/trades`
  with our builder account's key) and the VIP discount on its builder fee.
- Jupiter (`lib/venues/jupiter/`, a `SpotVenue`): Swap V2 Meta-Aggregator only (`GET /swap/v2/order` +
  `POST /swap/v2/execute` on api.jup.ag). Ultra and Metis are unmaintained: don't use them. Docs source:
  github.com/jup-ag/docs (mirrors developers.jup.ag).
  - Every Jupiter call goes through `app/api/jup/*`, which adds `x-api-key` (`JUP_API_KEY`) and
    `referralAccount` + `referralFee` (50-255 bps) server-side. Balances come from Solana RPC via
    `app/api/solana/balances` (`SOLANA_RPC_URL`).
  - Tokens: `/tokens/v2/search`. A symbol resolves to verified tokens only (on a clash the most liquid wins; symbols
    are compared without a leading `$`, the verified dogwifhat token is `$WIF`). A mint resolves to that exact token,
    verified or not: picking an address in the market search ("Verified only" off) is an explicit choice, which is how
    fresh pump.fun launches trade; the swap card then shows a red "Unverified token" box (launchpad, Solscan link)
    and needs "I checked this token" ticked before a buy.
  - Raydium, Pump.fun (bonding curve and PumpSwap), Meteora etc. are reached through Jupiter's routing, never as
    separate sources: Jupiter already compares them, and only Jupiter (referral) and Titan (fee account) pay us a
    fee and earn profile points (Raydium's API has no partner fee; pump.fun has no official swap API; PumpPortal
    charges its own 0.5%). Quotes carry the DEXes they route through (`SpotQuote.route` from Jupiter's `routePlan`
    labels and Titan's step labels); the swap card shows "via BisonFi → PumpSwap" (`routeText` renames "Pump.fun" to
    "Pump.fun bonding curve" and "Pump.fun Amm" to "PumpSwap"). Jupiter takes the fee in the swap's SOL/USDC side
    when it can, so the referral account needs token accounts for those mints.
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
    listed origins only, and the server adds `ARCUS_API_KEY` + `ARCUS_BUILDER_FEE_BPS` when set. The server's router
    network follows `NEXT_PUBLIC_DEPLOYMENT` first (`readArcusServerConfig`), like the browser: before that fix the
    mainnet site, which doesn't set `NEXT_PUBLIC_ARCUS_NETWORK`, proxied the testnet router.
  - Flow (`venue.ts`): size in USDG (mUSDG on testnet; sells sized from `/v1/price`), balance check, `/v1/quote`,
    keep only the gasless `arcus` venue quote, refuse impact above `MAX_SPOT_PRICE_IMPACT_PCT` vs `referencePrice`,
    switch/add Robinhood Chain in the wallet, Permit2 allowance (EIP-2612 permit or one-time approve), sign the
    Permit2 witness, `/v1/submit`, poll `/v1/status`. Minimum $5 per trade.
  - Testnet quotes: the testnet router quotes only some mock tokens (often only TSLA; mTSLA, AMD, AMZN, NFLX, PLTR and
    mUSDC answer `NO_QUOTES`, "upstream venue unavailable"). The testnet spot list prices each token from the router's
    own `/v1/price` for $100 of mUSDG (`arcusTestnetListings`, `indicativeTokenPrice`) and leaves out what it can't
    quote; the swap card says "Arcus has no quote for X right now" instead of a silent 0. Arcus tokens show "Quote on
    request" instead of liquidity/volume/market cap in the chart header (RFQ: no pool).
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
    orderEntry, positions, news, account; edited from the Layout icon in the top bar (`layout-menu.tsx`: presets, panels,
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
  - Chart header (phones: asset + price + Draw, then the intervals on their own row from the left edge, then the
    stats): asset, price, then `market-stats.tsx` (mark, 24h volume, open interest from the venue market list,
    hourly funding + countdown to the top of the hour; `lib/trading/market-stats.ts`) and the interval picker.
  - Arrangement (`arrangement` preference, `lib/layout/arrangement.ts`): column order (watchlist, main = chart +
  positions, rail, trade) and which of the order book / news sits under the order panel (default: news there, order
  book in the rail next to the chart; a saved copy of the old default, rail last, moves to it once via `version`). Hover a panel, drag the grip at its top onto another to swap (`ArrangeHandle`, HTML5 drag and
  drop in `terminal-shell.tsx`); the order panel's own grip swaps it with the panel stacked in its column (`stackOnTop`:
  news or order book above it, its height handle then on its bottom edge; with both shown, the top one's grip also
  moves the trading column, so the column never shows two grips); Layout menu → Reset arrangement. Phones keep the order book under the order panel.
- Page mode (`fitToScreen`, Layout menu and Settings → Layout, `html[data-viewport=fit]` set before hydration):
  desktop scrolls by default inside `.app-main` (not the window, so the scrollbar starts under the top bar on every page,
  like the list pages), with the terminal grid on `--rows-scroll`: a fixed 988px
  grid (620px chart over 360px positions by default), so dragging the positions edge moves the line between them
  instead of stretching the side columns. Fit screen is the old one-screen layout. CSS in `globals.css` ("Desktop page mode").
- Shell chrome (`app-frame.tsx`, client): top bar + page + optional footer. `navMode` ("sidebar" | "top") moves
    navigation into the top bar (`top-nav.tsx`); `tapePosition` ("top" | "bottom" | "off") places the server-rendered
    tape (`ticker-bar.tsx` → `ServerTape`) once. `html[data-nav]` / `html[data-tape]` are set before hydration so the
    rail doesn't flash; choosing top navigation drops the tape to the footer (`navModeChange`). Offered in the layout
    menu and Settings → Layout.
  - Order panel (`order-panel.tsx`, laid out like the venues' own forms): Long/Short tabs, venue (`VenuePicker`: an Auto switch beside one dropdown naming the venue, logo + name, every venue listed
    inside with a tick; it replaced a row of icon chips that grew with each venue), a leverage button
    (popover: slider, presets, cross/isolated) next to Market/Limit, inline-labelled inputs, a 0-100% slider of
    available margin, then a summary (est. entry from the book walk, slippage, fees, margin, liquidation
    (`lib/trading/order-math.ts`), hourly funding). Perps call `placeOrder` directly. Two-press confirm unless
    one-click.
  - Scale and TWAP (order panel's third tab, "Pro" → Scale / TWAP; logic in `lib/trading/algo-orders.ts`, sending in
    `components/terminal/algo-orders.tsx`): done by the terminal, not the venues' own algos, so every order carries our
    fee and earns points (Hyperliquid's `twapOrder` action has no builder field; Aster and Orderly have no TWAP). Scale =
    2-20 limit orders evenly spaced From → To, sized even or growing toward either end (`scaleLadder`), each at least the
    venue minimum (`minOrderUsd`), placed one after another; legs past the mid are flagged as fills. TWAP = market
    slices every 30s (fewer when a slice would fall under the minimum, `twapPlan`), 5 min to 24 h, optional ±20% random
    timing; a failed slice's share moves to the later ones and three failures in a row stop it. Jobs live in
    localStorage per wallet (`twap-store.ts`) and one tab per wallet sends slices (Web Lock `angler:twap:<address>`), so a
    reload carries on and two tabs never double-send; with every tab closed it waits. The positions bar's TWAP tab
    (shown once a job exists) has progress, average fill, Pause / Resume / Cancel. No TP/SL with either.
  - Swap card (`swap-card.tsx`, the order panel on /swap; math in `lib/trading/swap.ts`): spot is a swap like the
    venues' own screens: Sell box (amount of the sold token, wallet balance, 25/50/75/Max) over Buy box (Jupiter/Titan
    best quote, else the price estimate), a flip arrow, the rate line and, with Titan on, the route list (pin a
    source). The asset pill opens the market search straight away when one venue lists the chart's asset; when several do
    (Solana token via Jupiter/Titan, Arcus stock token on Robinhood, priced from Arcus `/v1/price`) it lists them,
    with "Other token…" (the search) last; the stablecoin side is the
    venue's (USDC on Solana, USDG on Robinhood). Execution is unchanged: `use-news-trader.ts`, sized in USD (sells:
    amount × price). Shared pieces: `inline-picker.tsx` (portaled dropdown), `token-icon.tsx` (`CoinIcon`: token or
    asset logo + chain badge, falls back to `MarketIcon` when an image fails).
    "Private" in both swap cards' header (`PrivateToggle`, `privateSwap` preference, off by default) = MEV protection,
    not anonymity (the card says the wallet and trade stay public): only routes whose swap never waits in a public
    mempool. Solana: Jupiter only (its /execute lands through Beam), Titan skipped (here and in news trades). EVM: Uniswap
    asked for `protocols: ["UNISWAPX_LATEST"]` only and a classic route refused (`fetchUniswapQuote({ privateOnly })`,
    also in `uniswapSwap`), 0x/KyberSwap skipped; cross-chain swaps stay on Relay/LI.FI intents. Robinhood stocks: Arcus only
    (`robinhoodSources` drops Uniswap). With no protected route the card says so instead of sending publicly.
    A gear in the card's header opens Max slippage (`swapSlippageBps` preference, `lib/trading/slippage.ts`): Auto
    (null: Jupiter's real-time estimate, RTSE; Titan 0.5%, Arcus 0.5%) or a fixed 0.5 / 1 / 3 % / custom value sent as
    `slippageBps` to `/api/jup/order`, `/api/titan/order` and Arcus `/v1/quote` (also on the trade itself), with a
    warning above 5% or under 0.1%. Under the card a summary like the venues' own: You sell, Est. amount, Est. out
    value, Min. received (quote's `minOutAmount`), Price impact, Max slippage (the quote's own when Auto), Platform
    fee (`feeBps`: Jupiter's total incl. our referral; Titan's our partner fee), Bridge fee for cross-chain buys.
    Solana swaps pay with (or, selling, pay out in) any token: the stablecoin pill is a "Pay with" / "Receive" token picker
    (the market search window in pick mode, `useAssetSearch().pickToken`: Solana tokens only, every one of them,
    USDC/SOL/USDT and the wallet's tokens first, the live search by ticker/name/address and "Use this address" for a
    pasted mint; picking a row sets the pay token instead of the chart); `quoteMint` rides on the trade and quotes
    (`jupiterVenue.quoteToken(mint)`, USD size = amount × the token's price; "Max" keeps 0.01 SOL for fees). The picker is
    multi-chain (`scope: "evm"`, the other chains' dollars and gas coins pinned after Solana's): a token on an EVM chain
    makes it a cross-chain swap in one LI.FI route (`use-cross-swap.ts`: buying, the EVM wallet sends and the Solana
    token lands in the Solana wallet; selling, the reverse; needs both wallets; Jupiter isn't asked). `sourceChainById`
    knows every swap chain, so cross-chain sends from BNB Chain, Polygon… work in both swap cards. Profile
    points count a swap's USDC change, or, without one (SOL → token), our referral fee priced over our rate.
    On /swap the panel under the chart is the traded token's activity (`swap-holdings.tsx`), not perp positions, from
    free sources only (a paid indexer such as Birdeye would add per-holder bought/sold and full wallet PnL):
    Swaps = its busiest pool's last 300 trades (`GET /api/spot/trades`, GeckoTerminal/CoinGecko on-chain
    `pools/{pool}/trades`, cached 60s, `readPoolTrades` reads the side from the token's view; min-size filter);
    Holders = Jupiter's holder count + top-10 share and the largest wallets (`GET /api/spot/holders`: Solana RPC
    `getTokenLargestAccounts` + owners; public RPCs rate limit it, so a failure isn't cached and the list needs a real
    `SOLANA_RPC_URL`; Robinhood tokens link to Blockscout, whose API answers servers with a Cloudflare challenge);
    Your trades = swaps made here (`lib/spot/swap-history.ts`, recorded per wallet in localStorage by
    `use-news-trader.ts` through `swap-history-store.ts`) plus the wallet's trades among the pool's recent ones;
    My holdings = the Solana wallet's tokens (`components/portfolio/spot-table.tsx`, shared with the portfolio page; a
    row picks that token) with PnL against the average cost of what was bought here (`costBasis`, `unrealizedPnl`;
    "—" for tokens bought elsewhere, "*" when only part of the holding has a known cost). The free GeckoTerminal API
    allows about 10 calls a minute site-wide: set `COINGECKO_API_KEY` before traffic grows.
    Cross-chain buys (Arcus mainnet only): the Sell pill is the same any-token-any-chain picker as the other cards
    (`pickToken({ scope: "evm" })`, USDG · Robinhood, USDC · Base / Arbitrum, SOL / USDC · Solana and the Hyperliquid
    balance pinned first). USDG pays as is; another wallet chain's USDC or the Hyperliquid balance takes the bridge path
    below; any other token on any chain (`payFrom: "other"`, SOL and USDC on Solana too) is one `quoteDirectSwap` route
    (Relay or LI.FI) to USDG on Robinhood paid to the EVM wallet, then the Arcus press with what landed (as below).
    All three swap cards share the pay token (`pay-memory.ts`): each remembers what it shows, defaults included (/swap opens
    on USDC · Solana and that must carry over too), and each starts from it, so USDC · Base or SOL stays the pay token when the Buy side
    moves to another chain's token (it used to fall back to that chain's own dollar). Other dollars run the funds steps first through `use-funds-run.ts` (the step runner shared
    with the funds window: `fundsRoute(... → wallet on Robinhood)`, i.e. Hyperliquid withdrawal and/or Across USDC →
    USDG to the wallet), with the Across quote previewed in the Buy box; when the USDG lands (`onDone`) the card asks
    for one more press to swap it on Arcus (rounded down to the cent). The card says plainly that USDC becomes USDG.
    USDC · Solana and SOL · Solana (`payFrom` solanaUsdc / solanaSol) skip the funds steps: a debounced
    `quoteDirectSwap` (LI.FI only: Solana) to USDG on Robinhood paid to the EVM wallet, one Solana signature
    (`sendDirectSwap`), then `bridgeLegState` until filled; the USDG that arrived (Robinhood USDG balance after minus
    before) becomes `bridged` for the same Arcus press. Both wallets must be connected (balances: `use-solana-balance.ts`).
  - TP/SL (`lib/trading/tpsl.ts` validates the side): reduce-only market-when-triggered orders. Hyperliquid: entry +
    triggers with grouping `normalTpsl`, open positions with `positionTpsl`. Lighter: types 4 (TP) / 2 (SL), IOC,
    expiry -1 (28 days), grouped with the entry via `SignCreateGroupedOrders` (OTO, or OTOCO for both) and as an
    OCO pair for open positions. Set from the order panel or the TP/SL button on a position row.
    Partial TP/SL (`PositionTpsl.size`, `portionOf`): HL plain triggers (grouping `na`), Lighter sized triggers, Aster
    `quantity` + reduceOnly instead of `closePosition`, Orderly `TP_SL` with `quantity`. At entry (`tpslSize`, market
    only) the provider sends the entry alone, then the sized TP/SL on the fill. Position rows open dialogs
    (`position-dialogs.tsx`): Close (market or reduce-only limit, any share) and TP/SL (any share, active triggers).
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
  - Funding arb (`components/markets/funding-arb-dialog.tsx`, Arb button on Markets rows listed on two or more of
    `TRADABLE_FUNDING_VENUES`: Hyperliquid, Lighter, Lighter RH, Aster, Orderly): market long on the low-funding venue +
    market short on the high-funding one, same base size (`arbLegSize`, coarser size step), each leg at least its venue's
    `minOrderUsd`, sent together; a half-filled pair is reported so the user can close the unhedged leg. It opens on the
    best pair, but each leg has a venue picker (funding APR and free margin per venue, a swap button; `arbBetween` prices
    any pair, a negative spread is flagged as paying funding) for traders who want volume or margin elsewhere.
  - News perp trades also go to the best quote (`quoteVenues`) when `autoRoute` is on; analytics records the venue
    actually used.
  - Funds (`deposit-dialog.tsx`, "Deposit / Withdraw" in the account panel, "Bridge" in the sidebar/top bar; routes in
    `lib/venues/bridge-routes.ts`, transfers in `lib/venues/deposits.ts` + `deposit-client.ts`, viem on demand): laid
    out like the swap card: a From box (venue or wallet picker, balance or Hyperliquid withdrawable, amount, token
    pill, 25/50/75/Max), a flip arrow, a To box (what arrives after fees and the bridge quote, destination picker, token
    pill), then route/fee/time, the conversion note, the steps and the button. (It was one sentence, "Move [amount]
    [token] from … to …".) The wallet side lists every swap chain (`FUNDS_CHAINS`, `fundsChainSource`: the chain's
    main dollar with its decimals, e.g. USDT with 18 on BNB Chain); the four `WALLET_CHAINS` stay the swap cards' bridge
    path. Amounts go through `tokenUnits` / `fromTokenUnits` / `decimalsOf`, never a fixed 6; `chainFor` resolves any
    swap chain (viem's definition or one from the config) and throws on an unknown one rather than signing on
    Arbitrum. Bridge legs from the new chains run on Relay or LI.FI (Across covers few); step labels name each chain's
    gas coin (BNB, POL…). The
    wallet side is a token picker (USDC · Arbitrum, USDC · Base, USDG · Robinhood Chain, where Arcus trades): the
    sending one sits right after the amount, a venue source shows its fixed token there instead; venue options show
    their margin token. Token and chain logos are self-hosted (`public/tokens`, `public/chains`; Across's token list
    gives USDG the USDC logo, so it isn't used). A "You send / You receive" card shows both amounts (after Hyperliquid's fee and
    the Across quote) and says plainly when USDC becomes USDG; the button reads "… USDC → USDG to …". `fundsRoute` turns the
    pair into steps the window runs in order (one wallet signature each; waits keep polling with the window closed and
    toast when the next step is ready): `hlWithdraw` (Hyperliquid `withdraw3`, 1 USDC fee, lands on Arbitrum in 3-4
    min, `withdrawalArrived`), `across` (below), `transfer` (mainnet Hyperliquid = native USDC on Arbitrum to Bridge2
    `0x2Df1…3dF7`, min 5, less is lost, credits the sender; Lighter = USDC on Arbitrum/Base to the wallet's CCTP
    intent address (`createIntentAddress`); Lighter RH = USDG on Robinhood Chain to its intent address, min 1).
    Examples: HL → Lighter RH = withdraw + Across USDC → USDG paid straight to the RH intent address; Base → HL =
    Across to the wallet on Arbitrum + transfer. `lighterWithdraw` = Lighter fast withdrawal (`lighter/withdraw.ts`: transfer to the fast-withdraw pool with the payout address in the memo, trading key + wallet L1 signature, `POST fastwithdraw`; core USDC on Arbitrum min 4, RH USDG presumably on Robinhood Chain min 1, verify the first real one; mainnet only), then bridges or deposits on; `asterWithdraw` = Aster → wallet on Arbitrum (`withdrawAsterUsdc` in `aster/venue.ts`: wallet EIP-712 `Action` on domain "Aster" v1 chain 42161, then the agent-signed V3 `POST /fapi/v3/aster/user-withdraw`, fee from Aster's public estimate, ~0.5 USDC; mainnet only, untested with real funds); other directions say "coming soon"; testnets
    use faucets (Lighter's universal deposit address needs a builder key, not used). Deposit / Withdraw / Bridge tabs
    only preset the pair (`presetRoute`). Pickers portal their list to the body (the dialog's blur clips a fixed list).
    The order panel shows total buying power and, when the chosen venue lacks margin, offers to trade on a funded
    venue, move funds or deposit (`openDeposit(venue, mode)`).
  - Uniswap (`lib/venues/uniswap/*`, `app/api/uniswap/[...path]`): the Trading API (trade-api.gateway.uniswap.org/v1,
    OpenAPI at `/v1/api.json`), mainnet only (it has no testnet; `uniswapOnRobinhood` needs a mainnet Robinhood Chain).
    The proxy allows `check_approval`, `quote`, `swap`, `order` (POST, same origin) and `orders`, `swaps` (GET), adds
    `x-api-key` (`UNISWAP_API_KEY`) and replaces any browser fee with ours: `integratorFees: [{ bips, recipient }]`
    from `UNISWAP_FEE_BPS` (≤ 500, two decimals; fractional pins Universal Router 2.1.1) + `UNISWAP_FEE_RECIPIENT`
    (shape confirmed against the live validator). Quotes are same-chain only (4663 now; 42161/8453 allowed for later).
    First use: Robinhood Chain stock tokens (the Arcus catalog, which needs no Arcus key) are quoted on every enabled
    source (`robinhood-sources.ts`, `robinhood-quotes.ts`: Arcus `/v1/price` vs Uniswap `/quote`) and the larger
    output wins (Arcus on a tie). `preferArcus` (default on, a checkbox under the swap card's route list, not in Settings:
    Arcus volume earns Arcus points) keeps Arcus first unless Uniswap pays over `PREFER_ARCUS_BPS` (0.5%) more
    (`orderRobinhoodQuotes`, also used by news trades). The route list (`SpotRoutes`) shows whenever two sources can
    fill, before any amount: a "Route" header, one row per source (logo, name, "Best" next to the best quote); a press
    pins a row, pressing it again goes back to the best. Execution
    (`venue.ts`, on demand): balance, `check_approval` (one-time Permit2 approve, needs ETH gas), a fresh quote for
    the wallet, Permit2 EIP-712 signature (`permitPrimaryType`), then `routing` decides: CLASSIC/WRAP/UNWRAP →
    `/swap` + the wallet sends the tx (received amount from Transfer logs), DUTCH_V2/V3/PRIORITY → `/order`, gasless,
    polled through `/orders` until filled. `readUniswapTx` refuses empty calldata. Uniswap volume earns profile
    points (`claimEvmSwapPoints`, see Profile); analytics records venue `uniswap`.
  - Uniswap on EVM chains (`lib/venues/uniswap/chains.ts`: Base, Arbitrum, Ethereum, each with USDC/ETH/WETH/USDT to
    pay with; native ETH is the zero address `NATIVE_TOKEN`: no approval, sent as the tx value, priced and charted as
    WETH, "Max" keeps a gas reserve). BNB Chain (56) too: USDT first (its USDT and USDC have 18 decimals), native BNB
    and WBNB (`nativeName`, `wrapped` per chain; `wrappedNative` reads `wrapped`), `poolTop` so PancakeSwap's busiest
    pools add the tokens Uniswap doesn't rank. It isn't a funds wallet chain: another chain's dollar (and the Hyperliquid
    balance) reaches it through Relay / LI.FI like any token (`bridgeable` in `evm-swap-card.tsx`), not the Across path.
    Same for HyperEVM (999, HYPE/WHYPE, no Uniswap there: aggregators only, `poolTop`), Polygon (137, POL/WPOL, RPC
    drpc: publicnode and polygon-rpc.com failed reads), Optimism (10), Avalanche (43114, AVAX/WAVAX), Unichain (130,
    USDC only: its USDT is too thin) and Monad (143, MON/WMON, `poolTop`). Also Linea (59144), Sonic (146), Berachain (80094), Plasma
    (9745, USDT0 first), Ronin (2020), MegaETH (4326, USDm first) and Etherlink (42793): KyberSwap-supported chains
    without Uniswap, so 0x and KyberSwap quote and the list is `poolTop` only; addresses read on-chain, each
    chain's KyberSwap route checked with a live $10 quote. Their logos are KyberSwap's, PNGs wrapped in an SVG so the
    `/chains/<key>.svg` path holds. DexScreener barely covers Ronin and Etherlink; GeckoTerminal fills their stats. A
    native coin listed by a pool source keeps the chain's own symbol and name (`nativeName`), not the wrapped token's
    (Robinhood's ETH once showed as a second "WETH"). Service names differ per chain (GeckoTerminal
    `polygon_pos`/`avax`, DefiLlama `hyperliquid`/`avax`, DexScreener `avalanche`): check each against the live API when
    adding a chain, and the token addresses on-chain (symbol, decimals, supply). A chain = one `EVM_SWAP_CHAINS` entry
    (with `gasReserve`), its logo `public/chains/<key>.svg` (the search filter builds the path from the key, the token
    badge reads `CHAIN_LOGOS` by id), its viem chain in `viemChain`, `UNISWAP_CHAIN_IDS` when Uniswap trades there, and
    the aggregators' chain maps.
    Long tail (`lifi: true`): Mantle, Ink, Cronos, Gnosis, World Chain, Celo, zkSync, Katana, Immutable zkEVM, Rootstock,
    Pharos, Blast. Picked from LI.FI's EVM chains (`li.quest/v1/chains`) with DefiLlama TVL ≥ $10M (`api.llama.fi/v2/chains`
    by chain id; some entries lack one, match by name) and a working LI.FI same-chain quote; addresses from LI.FI's token
    list, checked on-chain. No KyberSwap there, so LI.FI quotes same-chain swaps (provider `lifi` in the aggregators:
    `/v1/quote` with fromChain = toChain, `toAddress` = the wallet, our LIFI_INTEGRATOR/LIFI_FEE_BPS, tx to LI.FI's
    diamond, `approvalAddress` to approve; only asked on `lifi` chains to spare its rate limit; follows the LI.FI switch
    and `bridge:lifi` off-switch); Uniswap also quotes on Ink, World Chain, Celo, zkSync and Blast. Celo's gas coin is a
    token contract (CELO `0x471E…`, no zero-address entry: LI.FI refuses it). Katana's tokens are vault-bridge ones
    (vbUSDC, vbETH, vbUSDT); Blast's dollar is USDB (18 decimals). `dexscreener` is optional (unset where DexScreener has
    no chain; GeckoTerminal fills in). `viemChain` takes viem's definition by id, else builds one from the config
    (Pharos). Left out: Arc, Tempo, Stable (gas paid in a stablecoin or no native coin; the card assumes a native gas
    coin), Sei and Fraxtal (no LI.FI same-chain route), Flow and BOB (no real dollar liquidity). Logos: LI.FI's chain
    SVGs (lifinance/types), checked for scripts.
    Gasless (`gaslessSwap` preference, "Gasless" next to Private in the EVM swap card, `GaslessToggle`/`GaslessNote`):
    only routes where the wallet signs and the swap pays the network fee: UniswapX orders (`gaslessOnly` in
    `uniswapSwap`: refuses native input and any approval transaction, saying the token needs one approval with gas) and
    0x Gasless (`/api/aggregators/gasless` price/firm quote, `/submit`, `/status`; same ZEROX_API_KEY and
    AGGREGATOR_FEE_* as the Swap API; `zeroxGaslessSwap` signs the gasless approval when the token offers one, then the
    trade (Permit2 witness), splits each signature into v/r/s, submits, polls until succeeded/confirmed, reads the
    received amount from the receipt). Native coins can't be sold gasless. 0x Gasless is skipped while Private is on
    (its relayer isn't a protected mempool); the other aggregators are skipped whenever Gasless is on.
    Aggregators (`lib/venues/aggregators/*`, `AGGREGATOR_PROVIDERS`): 0x and KyberSwap (Odos was removed when it shut down; `KYBERSWAP_CLIENT_ID`, no
    key; GET `/{chain}/api/v1/routes` with our fee as `feeAmount`/`isInBps`/`chargeFeeBy=currency_out`/`feeReceiver`,
    then POST `route/build` right before signing; `KYBER_CHAINS` maps every swap chain), all quoted with
    Uniswap on every EVM swap and the largest output runs. Each has a Settings switch and an admin off-switch. the spot list adds Uniswap's 300 most traded + 150 deepest (TVL) tokens per chain (Trading API `/tokens?sort=`, max 1000, server
    side with the key; not Robinhood, `listTop: false`), priced by DefiLlama (`lib/spot/llama.ts`: `coins.llama.fi`
    prices + 24h change, free, batches of 60). Volume, liquidity and market cap come from DexScreener
    (`lib/spot/dexscreener.ts`; it returns empty results to rate-limited IPs instead of a 429, which once silently left
    every token unpriced), else GeckoTerminal's `tokens/multi` for what it left bare (`lib/spot/gecko-tokens.ts`,
    `getOnchainTokenStats`: same key/plan/daily budget as the pool charts, 30 per call, at most 2 calls per chain per
    refresh), else the last good numbers (`lib/spot/market-memory.ts`: Redis hash `angler:spot:evm-stats:v1`, memory
    without Redis, used up to 6 hours). Prices fall back the same way (DefiLlama → pool sources). The search adds Relay's token search (`lib/spot/relay-currencies.ts`, `POST
    /currencies/v2`) plus DexScreener's, priced by DefiLlama; hits outside the list are unverified. Verified = on
    Uniswap's default list, or ≥ $250k pool liquidity, or (no liquidity figure) DefiLlama confidence ≥ 0.95; never with a
    transfer tax; blocked tokens are dropped. A picked token rides in the
    selected asset's `mint` slot as `evm:<chainId>:<address>` (`evmRef`/`parseEvmRef`; Jupiter lookups skip it, the
    watchlist accepts it), and /swap then shows `EvmSwapCard` (`evm-swap-card.tsx`: exact-input sell/buy boxes,
    balances over each chain's public RPC, a debounced Uniswap quote, `uniswapSwap` with the viem chain) instead of the
    Solana/Robinhood card. `useEvmToken` reads the list, else the search by address plus the contract's decimals. The
    chart and the activity panel use GeckoTerminal networks `eth`/`base`/`arbitrum`. Swaps are recorded per wallet
    (`SwapRecord.chain`), counted in analytics as `uniswap` and in profile points (`claimEvmSwapPoints`, see Profile).
    Cross-chain: the card's other side is any token on any chain, picked in the market search's EVM pick mode
    (`pickToken({ scope: "evm" })`: Uniswap tokens of every chain, the chains' USDC/ETH, USDG on Robinhood and, buying,
    the Hyperliquid balance pinned first, plus SOL and USDC on Solana; the list adds every Jupiter token). Same chain →
    Uniswap. Any token across chains → Relay or LI.FI in one go (`direct`: `quoteDirectSwap` asks both, larger output
    wins, Relay on a tie; Relay only between EVM chains; `sendDirectSwap` sends on the origin chain, `bridgeLegState`
    until filled; analytics venue `relay` or `lifi`). A Solana token on the other side (`LIFI_SOLANA_CHAIN`, the mint
    as address, native SOL as `LIFI_NATIVE_SOL` for LI.FI) goes through LI.FI only and needs a Solana wallet too: buying,
    it signs LI.FI's base64 transaction, sent by `/api/solana/send` (`lib/solana/send-server.ts`, shared with Titan's
    execute); selling, the Solana wallet is the recipient. Balances from `/api/solana/balances` (SOL keeps 0.01 back),
    decimals from `/api/jup/token`. Another chain's dollar (USDC on Arbitrum/Base/Ethereum, USDG on Robinhood) or the Hyperliquid balance
    keeps the bridge path below. Buying runs `fundsRoute(… → wallet on the token's chain)`
    through `useFundsRun` (`waitForWithdrawal` makes a lone HL withdrawal wait for the USDC too), then asks for one
    more press to swap the USDC that landed (`bridged`); selling swaps to the chain's USDC, then bridges what it
    delivered. Bridge stays its own window (the sidebar/top bar/phone "Bridge" opens the funds window on its Bridge
    tab, as before; tried and dropped: Bridge as a swap-page tab or a /bridge page, since a chart is no use there).
    Ethereum is a funds wallet chain too (`ETHEREUM` in `deposits.ts`). Robinhood Chain is an EVM swap chain as well
    (USDG first). Its list (`poolTop`) adds the tokens of its busiest pools (GeckoTerminal `getTopPoolTokens`, three
    pages, cached 15 min; `readGeckoPoolTokens`) to whatever Uniswap's `/tokens` ranks there, and drops Uniswap rows
    for Arcus's stock tokens so they're listed once, as Arcus. Before this only Arcus showed on Robinhood.
    Pons (pons.family, Robinhood Chain's main memecoin launchpad): KyberSwap routes its tokens both on the bonding
    curve (`pons-v2`) and after graduation (`uniswap-v4-pons-v2`, the v4 pool with Pons's hook), checked with a live
    quote and a built transaction carrying our fee, so the EVM swap card already trades them. `getPonsTokens`
    (`pool-candles-server.ts`, GeckoTerminal dexes `pons-v2` ×2 pages and `pons-v2-dex` ×1, base tokens only via
    `readGeckoPoolBaseTokens`, cached 15 min) adds them to the Robinhood list first, tagged `pons: "curve" | "graduated"`;
    the search shows them under their own "Pons" filter (`RowChain` "pons", venue "Pons · On curve" / "Pons"), which
    shows them even with "Verified only" on. The EVM swap card asks for "I checked this token" before buying any
    unverified token, like the Solana card. Pons's own factories in its integration guide emit nothing recent;
    don't build on them.
    Four.meme (BNB Chain's memecoin launchpad, `lib/spot/four-meme.ts`): tokens at vanity addresses ending in 4444 or ffff
    (`isFourMemeAddress`, checked against GeckoTerminal's live list). `getFourMemeTokens` (GeckoTerminal dex `four-meme`,
    two pages, cached 30 min, last good list kept like Pons's through `launchTokens`) adds the curve tokens to the BNB list
    tagged `fourMeme: "curve"`; a Four.meme address among BNB's busiest pools is tagged "graduated" (PancakeSwap). Search
    filter "Four.meme" under Launchpads, venue "Four.meme · On curve" / "Four.meme". KyberSwap doesn't know curve tokens
    ("token not found"); LI.FI routes them through OKX's aggregator with our fee, so the EVM card asks LI.FI too whenever
    a side is a Four.meme address (`lifiHere`). Aerodrome (Base) needs no integration of its own: KyberSwap routes its
    pools with our fee; Base has `poolTop` so tokens of its busiest pools (mostly Aerodrome) are listed, and
    `kyberExchangeName` names Aerodrome Slipstream and PancakeSwap in the route line.
  - Route lists (`RouteList` in `swap-card.tsx`, styled like `SpotRoutes`): every swap shows the routes it can take when
    there's more than one, best first, "Best" and the gap on the others; a press pins one (used while it still quotes),
    pressing again goes back to the best; a new pair or side clears it. EVM card: same-chain providers (Uniswap/UniswapX,
    0x, KyberSwap, LI.FI; `useQuote` keeps them all) and direct cross-chain routes; the Arcus card's and the Solana
    card's cross-chain payments too. `quoteDirectSwap` returns `options` and takes `prefer` (route id `directRouteId`:
    `relay` or `lifi:<tool>`), so the fresh quote at send time keeps the pinned route. Where Relay can't help (Solana
    pairs) LI.FI is asked again with `denyBridges=<first tool>` for a second route (e.g. Relay depository vs LI.FI
    Intents); the proxy passes `denyBridges` only as up to five tool keys (never "all"), it can only narrow LI.FI's choice.
  - Relay (`lib/venues/relay*.ts`, `bridge-leg.ts`, `app/api/relay/[...path]`): every bridge leg (`FundsStep` "across":
    funds window, both swap cards) quotes Across and Relay together (`quoteBridgeLeg`) and runs the larger output,
    Across on a tie; waits follow `BridgeLegRef` (Across deposit id or Relay request id). Relay's `/quote` lists the
    origin-chain transactions (approval when needed, deposit), `/intents/status/v2` reports waiting → success /
    refund / failure. No key needed; the proxy (POST quote same origin, GET status) adds our app fee
    (`RELAY_FEE_BPS` whole bps ≤ 500 to `RELAY_FEE_RECIPIENT`) and, with `RELAY_API_KEY`, the referrer (quotes with a
    referrer but no key are refused). Relay checks no balance in its quote, so the client does before sending.
  - LI.FI (`lib/venues/lifi*.ts`, `bridge-leg.ts`, `app/api/lifi/[...path]`): third quote in every bridge leg (Across,
    Relay, LI.FI; the largest output runs) and the direct swaps' second route (Solana included). `GET /v1/quote` returns
    one route (often another bridge such as Across or Mayan, plus LI.FI's own fixed 0.25% fee) as one transaction:
    EVM = an exact ERC-20 approval to `approvalAddress` when the allowance is short, then `transactionRequest`
    (`sendLifiEvm`); Solana = base64 versioned tx (`sendLifiSolana`). `/v1/status` by origin tx hash: DONE (also
    PARTIAL) = filled, DONE/REFUNDED or FAILED = failed, NOT_FOUND (404, code 1003) = keep waiting. No key needed; the
    proxy (GET quote same origin with whitelisted params, GET status) adds `LIFI_INTEGRATOR` and the fee
    (`LIFI_FEE_BPS` whole bps ≤ 300, only with an integrator; fee wallets are set on portal.li.fi) and `LIFI_API_KEY`.
  - Across (`lib/venues/across*.ts`, `app/api/across/[...path]`): the intent bridge Robinhood lists as a partner and
    Uniswap's own bridging runs on (chosen over Uniswap's API: same bridge, no extra layer or key). Mainnet only.
    The browser calls our proxy (`swap/approval` → app.across.to/api, `deposit/status` → indexer.api.across.to; the
    server adds `ACROSS_INTEGRATOR_ID` and the optional `ACROSS_APP_FEE` + `ACROSS_APP_FEE_RECIPIENT`, never the
    browser). Signing uses the official `@across-protocol/app-sdk` (pinned, loaded on demand): a fresh exactInput quote
    right before signing, approval + deposit on the origin chain, then the indexer status until `filled` (`expired` /
    `refunded` = funds back on origin). A Lighter recipient must clear its deposit minimum after fees (`minOutputAmount`).
    Robinhood Chain's public mainnet RPC is `rpc.mainnet.chain.robinhood.com` (`rpc.chain.robinhood.com` never
    answers) and its explorer `robinhoodchain.blockscout.com`; Lighter RH's `createIntentAddress` takes chain 4663 only, core Lighter's takes 42161/8453.
  - Pro order (`pro-order-dialog.tsx`, yellow "Pro order" in the sidebar/top bar/mobile menu; logic in
    `lib/trading/pro-order.ts`): hedge (same coin long on one perp venue, short on another, same base size at the
    coarser step) or multi (up to `MAX_PRO_LEGS` market orders on any venue and coin), sent together behind a confirm
    press; partial results are reported. "Bridge" next to it opens the funds window on the HL → Lighter move.
    The market type comes from the route (`/perp`, `/swap`, `lib/terminal-kind.ts`), not a switch in the panel: an
    asset without a venue of that kind shows a link to the other view.
  - Merged book and split orders: with two venues listing the asset the order book defaults to "All venues"
    (`mergeVenueBooks`: levels summed per price, bars split by venue color; trades merged with venue dots). Venues trade
    apart (Orderly and Extended often 0.06-0.09% under Hyperliquid/Aster), so laid together raw one venue's asks fell
    under another's bids and the merged ladder read as broken: each venue's levels are cut at the median of the venues'
    mids (asks above, bids below), and the middle row says "Venues X% apart" (hover: each venue's offset) when crossed. The book's venue menu (`BookSourcePicker`) picks any set of venues
    (`lib/trading/book-sources.ts`: default = the first three, "All venues" = every venue listing the asset, up to
    `MAX_BOOK_SOURCES` 6 streams, one `useOrderBook` slot per perp venue; "Only" for one); its
    color key names up to three and folds the rest into "+N sources" (a press lists them). A venue picked by hand in the
    order panel (or the home search) switches the book to it when listed (`showBookVenue` in `order-draft.tsx`); Auto's
    choices don't move it. `useBestExecution` also returns `splitExecution` (cheapest levels of
    both books after fees); the order panel offers "Split HL $X + Lighter $Y" when it saves ≥ $0.25 and 0.5 bp, every
    leg clears its venue minimum (`minOrderUsd`) and no TP/SL is set, and sends the legs in parallel.
  - Portfolio (`positions-bar.tsx`): positions/orders of every perp venue with a venue filter, liquidation distance
    from the mark, a Venues tab (`lib/trading/portfolio.ts`: account value, uPnL, margin used, withdrawable per venue
    and in total), and close-all (all, per filter or per venue) behind a confirm press.
- Routes: the terminal is `/perp`, `/swap` and `/spot`, all rendered by `app/(terminal)/layout.tsx` (the shell lives
  in the layout, so switching views keeps the chart, books and news feed mounted; the pages only set titles). `/`
  redirects to `/perp` (`next.config.mjs`; the old `/spot` → `/swap` redirect is gone: /spot is the order-book view
  now). The navigation names them Dex Perp, Swap, Dex Spot. Swap = pools and aggregators (Jupiter, Titan, Uniswap,
  Relay, LI.FI); inside the code its market kind stays `"spot"` (`TerminalKind`, `lib/spot/*`). Dex Spot = order books
  (Hyperliquid, Lighter spot; centralized exchanges later) plus Arcus's Robinhood Chain stock tokens (no book: the
  Arcus swap card, Arcus vs Uniswap, "Prefer Arcus"), kind `"book"`: `useSpotView` picks the order-book market first,
  else the Arcus token (an Arcus-filter pick goes to Arcus); with Arcus the order book hides and the token's activity
  sits under the chart, like /swap. `onSpotView` decides which list a search row or star belongs to. Arcus left /swap
  (an asset only /spot lists links there). `/prediction` is the prediction page (below) and `app/not-found.tsx` the 404
  (`StatusScreen`). Dex Perp / Swap / Dex Spot / Prediction lead every
  navigation from one list (`components/app/market-nav.ts`: sidebar, top bar, phone menu). /swap hides the order book
  (Jupiter and Arcus are AMM/routers) and shows the spot venues' balances in the account card; /perp the perp ones.
- Prediction (`/prediction`, `components/prediction/*`, `lib/prediction/*`): Polymarket and Hyperliquid HIP-4
  outcome markets in one shape (`types.ts`: event → binary markets → two outcomes with price = probability and the
  traded asset). Off on the testnet site (`predictionViewAvailable`: no nav entry, `/prediction` redirects home):
  Polymarket has no testnet, so the page would show and trade real Polygon markets there. Polymarket is where the volume is (HIP-4 traded ~$51M in September, about 0.07% of Polymarket +
  Kalshi), HIP-4 trades with the account the terminal already has. Polymarket is blocked by ISPs in Turkey (DNS points
  at a block page): develop it over a VPN exit outside Polymarket's geoblock list, and never route orders through
  our server to get around a block.
  - Layout (`prediction-view.tsx`, `prediction-home.tsx`): it opens on an overview (title, source, search, category
    tabs, events as cards with their top two lines and Yes/No, live trades on the right); a card, line or Yes/No opens
    the event (`?event=`, that market and side preselected) with the list beside it and a back button to the overview.
    The filters (`useEventBrowser`) are shared by both. Live trades: Polymarket's latest taker trades across every
    market (`data-api.polymarket.com/trades?takerOnly&filterType=CASH&filterAmount=`, via `/api/prediction/trades?min=`
    1|10|100|1000, cached 3s; `readPolymarketTrades`, timestamps in seconds), polled every 4s, plus HIP-4 trades of the
    40 busiest outcome events streamed over Hyperliquid's WebSocket (`useHip4Trades`, `readHip4Trades`). A row opens its
    event: HIP-4 directly, Polymarket via `/api/prediction/resolve?slug=` (Gamma `/markets/slug/{slug}` → its event).
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
    there with `sendUsdc` (≥ $2), converted to pUSD. Polymarket volume earns profile points from our builder trades (see Profile).
- Vaults (`/vaults`, sidebar/top bar/phone menu; `lib/vaults/*`, `components/vaults/vaults-view.tsx`): every perp venue's
  vaults in one table, public like `/` (the invite gate skips it; in the
  sitemap). Sources, all keyless: Hyperliquid `stats-data.hyperliquid.xyz/{Mainnet|Testnet}/vaults` (every vault ever,
  ~14 MB, 10-15s: fetched no-store and only the parsed rows cached) + `vaultDetails`; Lighter and Lighter RH
  `publicPoolsMetadata` (pages of 100 running down from index 281474976710655) + the public `pnl` chart; Orderly
  `api-sv.orderly.org/v1/public/strategy_vault/vault/{info,performance}` (no value history). `GET /api/vaults` = open
  vaults ≥ $1k, one `unstable_cache` entry per venue (15 min; a failing venue keeps its last list and is named in
  `failed`); `GET /api/vaults/[venue]/[id]` = history (5 min). The list's APR is each venue's own figure (HL APR, Lighter
  APY, Orderly 30-day APY) and says so; the opened row computes 7d/30d/90d/1y returns and max drawdown the same way for
  all from a growth index: Lighter's exact share price ((inflow - outflow + trade PnL) / shares), Hyperliquid's PnL over
  capital per step (Modified Dietz, all-time steps stitched with the month's and week's). HLP's children are left out;
  HL leaders keep 10% (HLP 0), locks 4 days (HLP) / 1 day. "Established only" (default) = ≥ $10k and 30+ days, venue
  vaults always shown. "Your vaults": HL `userVaultEquities` and Lighter `account?by=l1_address` shares, from the browser.
  Deposit / Withdraw run in the terminal for Hyperliquid and Lighter (core + RH) (`vault-transfer-dialog.tsx`, loaded on
  demand; amounts checked in `lib/vaults/transfer.ts`): HL `vaultTransfer` (L1 action, signed by the agent key, micro-dollars
  from/to the perp margin; a withdrawal near the whole stake takes all of it, `hlWithdrawUsd`), Lighter `SignMintShares` /
  `SignBurnShares` (tx 18/19, trading key, shares = USD / (pool value / total shares), `lighterShares`; a burn needs the
  shares in the trading key's own account, `VaultStake.shares` per account). Lighter pools take at least $5 per deposit
  and per withdrawal (`LIGHTER_MIN_POOL_USD`, from Lighter's own app; the sequencer answers "invalid burn share amount" to
  a smaller partial burn): with less than $5 in, the window only offers Withdraw all (`onlyWithdrawAll`). Share price =
  (perps + spot value) / total shares (LLP holds spot; `total_asset_value` is the perps part). Orderly's Deposit still
  opens its page. No fee rides on vault transfers, so no points. A first real Lighter deposit ($1) went through; the
  partial withdrawal of it failed before the $5 rule.
- Copy trading (`/copy`, sidebar/top bar/phone menu; `lib/copy/*`, `components/copy/*`): follow Hyperliquid, Lighter and
  Lighter RH wallets (their positions are public by address; Aster and Orderly need the account's own key, so they can't be
  followed), copy them on any perp venue. The list (`Follow`: source, address, label, notify, copy settings; max
  `MAX_FOLLOWS` 20, `MAX_COPYING` 5) lives per wallet in localStorage (`follow-store.ts`, with the copy book: what each copy
  holds per leader coin, and the activity log). Cards read positions from the browser (`leader-client.ts`: HL
  `clearinghouseState` per dex + `userFills`, Lighter `account`; every 15s). Copying (`copy-runner.tsx`, started by
  `CopyGate` inside the trading provider only while a copy is on, loaded on demand) runs while a tab is open: one tab per
  wallet (Web Lock `angler:copy:<address>`) polls each copying leader every 5s, `leaderEvents` turns snapshot changes into
  open / add / reduce / close / flip, `copyPlan` sizes them (opens: fixed USD or a % of the leader's size, capped; adds,
  reductions and closes in proportion to what the copy holds; positions held before copying started are never touched; a
  coin list filters opens), and orders go through the provider's `placeOrder` (our fee, points) on the copy's venue, else
  the target ("same", "best" via `quoteVenues`, or a fixed venue); reductions are capped at the open position. Alerts
  (Telegram / Discord, with the browser closed): the card's Alerts switch keeps the wallet in `AlertSettings.follows`
  (`PUT /api/alerts/follows`, profile session; Profile → Alerts saves leave it alone) and the alerts tick reads each followed
  wallet once however many follow it (`readLeaderEvents`, Redis hash `…:leaders`, first look only records, an unreadable
  venue keeps its last positions, at most `MAX_LEADERS` 300 a tick) and messages each follower (`leaderMessage`) with a
  `/copy?follow=&coin=&side=` link: the page's `TradeOffer` card copies that trade by hand at the follower's size. The
  server never trades: the trading keys stay in the browser. Not yet tried with real orders.
- Hyperliquid and Lighter spot (`lib/spot/book-spot.ts`, `lib/venues/hyperliquid/spot.ts`, `lib/venues/lighter/spot.ts`,
  `components/terminal/book-spot-card.tsx`, the /spot view): order-book spot markets against USDC on both networks. /spot
  (`spot-order-panel.tsx`, `use-book-spot.ts`: `useBookSpotRef` = the picked `book:` market, else the asset's busiest
  one) shows the chart on the venue's candles, the order book (`OrderBook markets=…`, HL by spot coin `@N`, Lighter by
  market id) and an exchange-style form: Buy/Sell, Market (IOC) or Limit (HL GTC; Lighter GTT 28 days, type 0), a
  price clicked in the book fills the limit, size in base with % of available, then the market's open orders with
  Cancel (HL `openOrders` by coin; Lighter `accountActiveOrders`, needs this browser's trading key). Its search and
  watchlist list only these markets; /swap's no longer do (an asset only they list links to /spot). Under the
  chart: `spot-book-panel.tsx`, the wallet's whole HL + Lighter spot account (`lib/venues/book-spot-account.ts`, parsers
  in `lib/spot/book-spot-account.ts`): Balances (USD at the market price; a row opens its market), Open orders on every
  spot market with Cancel, Order history (HL `historicalOrders` and Lighter `accountInactiveOrders`, spot markets only,
  through the perp history mappers); Lighter orders need this browser's trading key. Before /spot they lived in the swap card, so testnet /swap had
  real pairs (HL testnet: HYPE, PURR, UETH…; Lighter testnet: ETH, LIT). Listed with the spot pairs (HL pairs with ≥ $1k
  24h volume on mainnet, ≥ $10 on testnet, `HL_SPOT_MIN_VOLUME_USD`; Lighter's `spot_order_book_details`), following the
  `venueHyperliquid` / `venueLighter` switches. A market rides in the `mint` slot as `book:<venue>:<id>` (HL pair index,
  Lighter market id); on /swap an asset no pool venue lists falls back to its busiest book market (`pickBookSpotListing`).
  HL: coin `@<index>` ("PURR/USDC" for 0), order asset 10000 + index, spot price rule (8 - szDecimals), IOC at mid ± 5%,
  ≥ $10, our builder fee; contexts match by `coin` and tokens by `index` (neither list is aligned by position); Unit
  tokens trade as the asset (UBTC → BTC, `hlSpotAsset`). Spends spot USDC (unified accounts share it); a standard
  account moves USDC perps → spot first (`moveUsdcToSpot`, wallet-signed). Lighter (core only): spot balances live on the
  account's spot route (`account.assets`), so a buy first moves USDC perps → spot with `SignTransfer` to the same account
  (route 0 → 1, trading key, no wallet signature); IOC at best ask/bid ± 3%, no integrator fee (the approval covers perps
  only). The chart uses the venue's own candles (`spotToken.book`), the card shows "Order book" instead of liquidity.
- Spot pairs (`lib/spot/listings.ts`, `lib/spot/server.ts`, `GET /api/spot/listings` cached 2 min, `/api/spot/search`):
  live from the venues' pools, never a fixed list. Jupiter `toptraded`/`toporganicscore` (24h and 6h) + `toptrending/24h` (100 each, the cap) + `tag=stocks` (the
  whole cached list must stay under unstable_cache's 2 MB item limit, so check its size before adding big lists),
  Arcus stock/index/commodity tokens priced from the same asset's perp quote. Dollar tokens (Jupiter tags `stable`,
  or `yb` named after USD) stay listed but sort last. An asset without a token of its own ticker (BTC on Solana)
  trades as the most traded verified token that represents it (24h volume first, pool liquidity second: WBTC parks
  more liquidity, cbBTC trades ~4x more) (`representsAsset`: same
  ticker, a wrapper named "wrapped"/"bridged" or after the asset, a tokenized stock; staked/leveraged versions never)
  — `/api/jup/token` falls back to it, so BTC → cbBTC or WBTC by live volume; /swap and /spot `preload` the list's
  core part (`SPOT_LISTINGS_PATH` = `?part=core`: Jupiter, Arcus, order-book spot) with the HTML so the search and chart
  don't wait for hydration (keep `loadSpotListings`'s fetch on the same URL and credentials, or the preload goes
  unused); the EVM tokens (`?part=evm`, ~90% of the bytes) load right after it and join the list, and readers that
  look an EVM token up wait for them (`useSpotListings(…, { waitForEvm: true })`). Token lookups that fail (Jupiter
  `useSpotToken`, the EVM chain read in `useEvmToken`) are retried with backoff and stay "loading", never "no venue
  lists it"; the order panel says "Finding X…" until the swap lookup settles, and `/api/jup/token` asks Jupiter
  uncached before calling a mint unknown (fresh launches), and the order panel fetches the swap card's
  chunk alongside the token lookup; the watchlist highlights that token. Unverified tokens never win: Jupiter's
  search for "BTC" returns a dozen scam "BTC" tokens with millions in liquidity (`fixtures/jup-search-btc.json`).
  `assetSymbolOf` maps a token back to the terminal asset (WBTC → BTC) so picking it moves the chart and news.
- Spot charts: on /swap the chart header and candles are the traded token's (`use-spot-chart-token.ts`: cbBTC with its
  logo, price, liquidity, volume, market cap), not the asset's. Candles come from the token's busiest DEX pool via
  `GET /api/spot/candles` (`lib/spot/pool-candles*.ts`: GeckoTerminal; CoinGecko's on-chain API with
  `COINGECKO_API_KEY`, `COINGECKO_API_PLAN=pro` for paid plans). Calls are scarce (free: ~10/min site-wide; keyed:
  monthly credits possibly shared with the Angler API), so the server fetches 1000 base candles per pool and timeframe
  once every 5 minutes and slices them for every interval and refresh, pools are cached an hour, and a keyed setup
  stops at `COINGECKO_DAILY_BUDGET` calls a day (`takeDailyBudget`, Redis); past it, or when the key is refused
  or rate limited, `onchainJson` falls back to GeckoTerminal's free API (same paths). The spot list's GeckoTerminal
  stats run once per chain every 3 hours per instance (`geckoStatsDue`), pool lists (Pons, `poolTop`) every 30 minutes. Between fetches `applyLivePrice` moves the
  last candle with the token's live price. The browser asks GeckoTerminal itself first (`lib/spot/pool-direct.ts`: it
  answers any origin without a key, so each visitor spends their own IP's allowance; same parsers, base candles kept 3
  minutes so the chart's 30s refresh costs nothing) for the chart and the Swaps tab, and calls our routes only when that
  fails: a launch crowd opening many tokens no longer drains the site's CoinGecko plan. Any failure falls back to the asset's market chart. Intervals
  GeckoTerminal lacks (3m, 30m, 2h, 8h, 3d, 1w, 1M) merge smaller candles (`resampleCandles`).
- Market search (`components/terminal/asset-search.tsx`, Ctrl/⌘+K or the chart header's symbol button): perp
  markets of the enabled venues, or spot pairs + live Jupiter search ("Verified only" on by default), category tabs,
  a network filter on the right of the tabs (spot only; `network-filter.tsx`: one "All networks" button opening a
  searchable panel grouped into Chains, Launchpads and Order books & stock tokens, with row counts; one at a time;
  only networks present, `networkOptions` / `rowOnNetwork` in `market-rows.tsx`). Launchpads come from Jupiter's
  `launchpad` (only Pump.fun in `LAUNCHPADS`; the small ones read as noise) and Pons (`launchpad: "pons"`, chain
  Robinhood; its last good list kept in Redis, `ponsTokens`). Launchpad tokens are all unverified, so in a launchpad view
  ("Launchpads" tab or a launchpad filter) "Verified only" becomes All / On curve / Graduated (`launchStage`: Jupiter's
  `graduatedPool`, Pons's `pons`) and rows are tagged by stage. The list renders 50 rows and adds 50 as it scrolls (`PAGE_ROWS`).
  Symbols may be any script (`ASSET_SYMBOL`, so 龙虾 can be picked); tiny prices print as "$0.0₁₃246" (`formatPrice`), sortable columns, the venue column as logos with a chain badge (`VenueMarks`: up to four logos, past that three and a "+N" chip whose press lists every venue with its name, `splitVenues`; same venue order on every row), ★ favorites (Ctrl+S) stored as the `watchlist` preference (`lib/watchlist.ts`, validated on read). Rows come from
  `market-rows.tsx`, shared with the optional Watchlist panel (`panels.watchlist`, off by default, on in the Pro
  preset): a column left of the chart with All / Yours (perp positions or Solana tokens) / Starred.
- History (positions bar tabs, loaded on demand from `history-tables.tsx`): Order history = Hyperliquid
  `historicalOrders` (open ones dropped, they have their own tab) + Lighter `accountInactiveOrders` (auth token:
  only a browser holding the account's trading key can read it), mapped in `lib/trading/order-history.ts`. Position
  history is rebuilt from the 30-day fills (`lib/trading/position-history.ts`): flat → flat per venue and asset,
  seeded from Hyperliquid's `startPosition` (exact even when the venue caps fills at 2000; checked against a live
  market maker: closed + still-open PnL equals the venue's total to the cent) or current size minus the window.
- Tooltips (`components/app/tooltip-layer.tsx`): every `title` shows as the app's own bubble (moved to `data-tip` on hover).
  Its MutationObserver re-takes a title React puts back under a resting mouse; it must never react to its own title
  changes. Once it did: with a titled element inside another (venue logo in a titled row), moving the title between
  them woke it endlessly (275k title writes in 1.5 s from one page change), which froze the whole browser on /swap.
  Now its own changes go through `own()` (`takeRecords`), the element already taken counts as under the pointer
  (`[data-tip]`), and it checks once per animation frame.
- Freeze recorder (`lib/debug/trail.ts`, `components/app/debug-trail.tsx`): off unless
  `localStorage["angler:debug"] = "1"`; then it writes the last 90 seconds (memory, DOM size, sockets, timers, listener
  counts, requests in flight by path, the market shown) to `localStorage["angler:debug:trail"]`, readable after a
  freeze that DevTools can't record. Paths only, never query strings.
- Loading: `components/app/loading-state.tsx` (`LoadingState`) for every wait the user sees (markets, search, watchlist,
  prediction, the order panel's skeleton as an overlay): spinner at once, "still loading" after 6s, Reload after 20s,
  so a slow connection never reads as a broken page.
- Controls: no native `<select>` or range input. Dropdowns are `SelectField` (`size`: md settings rows, sm form
  fields, xs panel headers, ghost inline text); sliders are `RangeSlider` (native input drawn by `.range-slider` in
  `globals.css`, `marks` as breaks in the track).
- Shell: same layout as news.angler.network. `components/app/sidebar.tsx` (Perp, Swap, Spot, CEX (Soon badge, `/cex` is
  a coming-soon page until the view exists; `soon` in `market-nav.ts`), Prediction, Markets, Vaults, Pro order,
  Bridge (no news-site mark; community links stay in the account menu, phone menu and home page); the rail scrolls on short screens; Layout and
  Settings are icons in the top bar next to the account control (`LayoutMenu placement="below-end"`, `SettingsButton` in
  `app-frame.tsx`), desktop only: phones use More; nav links pass `prefetch={false}` (eight prefetches were eight server renders racing every page load); the portfolio is only in the account menu, top right; wallets are only the top bar's Connect button) and the settings
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
- No onboarding: the first visit opens straight on the terminal with the defaults (oled theme, liquid surface, the
  default panels). The four-step welcome (look, layout presets, alpha notice) was removed so phones aren't covered by a
  full-screen dialog before they see anything; theme, layout presets and navigation stay in the Layout menu and
  Settings.
- Wallets: one Connect button opens `wallet-modal.tsx`, a single screen with no venue step ("Connect Wallet"): one row of wallet
  tiles in an inner panel, faint chain logos behind the card, connected addresses with Disconnect under the tiles.
  Every detected wallet (EVM via EIP-6963, Solana via Wallet Standard) is merged by name, so a wallet with both
  (Phantom, Backpack) is one tile and one press connects both chains; the modal closes once no other wallet could
  add a missing chain. The user rejected a rotating venue orbit (generic) and a plug-in port design (overdone):
  keep it this plain.
  Install links when none is found. One wallet per chain serves every venue on that chain. No embedded-wallet SDK
  (Privy was tried and dropped: it would load for everyone; if added later it must load only on demand). The account panel (`account-panel.tsx`: balances, trading key) and
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
- The disclaimer "Not financial advice. Scores are model outputs." lives in Settings (Trading, About); the user asked
  to keep it off the trading screen.
- Wallets never connect on page load unless the user clicked Connect in this app before (wallet permissions are per
  origin and may come from another app on the same origin).
- Chart engine: the `chart` preference (Settings → General) picks the Angler chart (Lightweight Charts, news markers)
  or the TradingView advanced chart widget from angler-news, opened on the selected asset (`lib/chart/tradingview.ts`:
  crypto → `BINANCE:<SYM>USDT.P`, stocks → ticker). The widget has its own interval bar, so ours is hidden.
- Chart intervals: `lib/chart/candles.ts` lists the 14 intervals Binance and Hyperliquid both accept (1m–1M);
  `components/chart/interval-picker.tsx` shows starred ones (`chartFavoriteIntervals`) as quick buttons. In the
  terminal the chart header measures what's left after the market stats and passes `maxQuick` (`lib/chart/interval-fit.ts`):
  narrow headers keep only the active interval, the rest stay in the dropdown.
- Selected asset lives in `components/terminal/selected-asset.tsx`; news chips call `selectAsset`. A pick carries the
  swap venue when the asset has several (`spotVenue: "arcus"` from an Arcus search/watchlist row, else a Solana mint):
  the swap card opens on it instead of its first venue, Solana (picking TSLA under Arcus used to land on TSLAx). Clicking a ticker
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
  accepted for 10 minutes; no gas, no login). Points: 10 per $100,000 traded through Angler (`pointsFor`, 0.01 per $100; 2x during the closed beta; a position-holding multiplier is planned; levels set by volume, Perch $1k to Whale $100M) (`levels.ts`, ten fishing
  levels Minnow → Whale), only from the venues' own records (`volume.ts`, `server.ts`): Hyperliquid fills whose
  `builderFee` matches our builder rate (`userFillsByTime`, the last 10,000 fills on first sync), Lighter trades whose
  own side's client order index ends in `ANGLER_CLIENT_TAG` (`lighter/pricing.ts`; counted from 2026-10-07, earlier
  orders weren't tagged), Solana swaps whose transaction pays our Jupiter referral token account (PDA
  `referral_ata` + account + mint) or Titan fee USDC account, volume = the signer's USDC change, each transaction
  once. EVM swaps (`claimEvmSwapPoints` → `POST /api/profile/evm-swap`, `evm-swap.ts` + `evm-swap-server.ts`): the
  server reads the transaction on that chain's public RPC and counts it when our fee recipient is in it (in the calldata
  for Uniswap `UNISWAP_FEE_RECIPIENT` and 0x/KyberSwap `AGGREGATOR_FEE_RECIPIENT`, as a token transfer to
  `ARCUS_FEE_RECIPIENT` for Arcus; unset, no points) and the wallet took part; volume is the wallet's side priced (the
  chain's dollars at $1, else DefiLlama). Solana swaps that didn't touch USDC (SOL → token) take their volume from what
  our referral account received, priced by Jupiter, over our rate. Polymarket (`polymarket-volume.ts`): the public
  `clob.polymarket.com/builder/trades?builder_code=` (one shared read a minute), trades whose `maker` is the wallet's
  Deposit Wallet (`lib/venues/polymarket/deposit-wallet.ts`, CREATE2 as the SDK does, both proxy kinds, pinned by a test
  against the SDK bundle), rate `POLYMARKET_BUILDER_FEE_BPS`. Relay and LI.FI (`bridge-points.ts` +
  `bridge-points-server.ts`, `POST /api/profile/bridge`): their fee isn't paid in the transaction (Relay accrues app fees,
  LI.FI's fee collector holds them), so the proof is their record: Relay `/requests/v2?id=` with `status: success` and an
  app fee to `RELAY_FEE_RECIPIENT` (volume `currencyIn.amountUsd`, rate the fee's bps), LI.FI `/v1/status?txHash=` with
  `DONE` and `metadata.integrator` = `LIFI_INTEGRATOR` (volume `sending.amountUSD`, rate `LIFI_FEE_BPS`). Claimed from
  `relayRequestState` / `lifiTxState` when they report filled (every bridge leg and direct swap goes through them) and
  after a same-chain LI.FI swap; the server retries the record a few times, once per route. Across (`acrossFilled`
  claims `<originChainId>:<depositId>` when filled): the indexer's `/deposit/status?depositId=` (filled, origin tx) and
  `/deposit?depositTxHash=` (input token and amount), and the origin transaction's calldata must carry
  `ACROSS_APP_FEE_RECIPIENT` (Across pays the app fee on the destination chain, but the recipient rides in the origin
  call); rate `ACROSS_APP_FEE` × 10,000 bps. Points scale with our fee (`pointsShareFor`: our bps / 3.5,
  `POINTS_BASE_FEE_BPS`, capped at 1x; the rest stored as `less:{venue}`), volume always counts in full. Perp volume syncs when the profile loads (`GET /api/profile/{id}?sync=1`, at most once a minute per profile,
  cursors per venue); swaps are claimed after they confirm (`claimSwapPoints` → `POST /api/profile/swap`). A Solana
  wallet can be linked to an EVM profile (signed by the Solana wallet): its volume moves over and later swaps count
  there. Stored in Redis per deployment (`store.ts`, memory without Redis): the one place wallet addresses are kept.
  Referrals: `?ref=<username or address>` is kept in localStorage; the profile page applies it with a signed
  "Use referral code" message (`POST /api/profile/referral`, once, never changed). The referrer earns 10% of the
  referred profile's volume after joining as points (`refUsd`, `REFERRAL_SHARE`), never a referrer's own bonus.
  The top bar has one account control (`profile-button.tsx`): Connect, then a dropdown with Profile, Portfolio, Referrals, Wallets (Layout is an icon in the top bar).
  Aster (builder trades) and Orderly (broker leaderboard, closed days) count too. Lighter and Lighter RH volume from a
  Standard account (the trade's own-side `maker_fee`/`taker_fee` is zero or absent: no Lighter fee, so none of ours)
  earns half points (`STANDARD_POINTS_SHARE`, stored as `half:{venue}`; the volume itself counts in full for totals,
  VIP and invites). Trades placed while the closed beta is on earn `BETA_POINTS_MULTIPLIER` (2x) points by the trade's own time
  (`lib/profile/beta-points.ts`: one event from `BETA_POINTS_SINCE`, the admin switch's release, until the beta first
  opens, recorded once in `angler:ops:<deployment>:closed-beta:points-ended`; closing it again doesn't restart it,
  `readBetaWindow`); each
  sync splits its volume into `betaUsd` (HL fill time, Lighter/Aster trade time, Orderly days the beta touched, swap
  block time): the extra is stored as `bonusUsd` (+ per day in `bd:{id}`), so volume, VIP, invites and referrers' shares stay
  1x; volume moved from a linked wallet carries its bonus but earns none again. The account panel's Lighter section shows a "Switch to Plus" card on Standard accounts
  (`LighterTierCard`): `changeAccountTier` with `new_tier: "plus"` (confirmed by Lighter's own lighter-ts `UserTier`; `accountLimits.user_tier` reads "std" / "plus" / "premium") and the browser key's auth token, then `approveLighterIntegrator` again (Standard
  approved a zero fee; `integratorState` asks again once the tier is paid). The setup state carries `tier` from
  `accountLimits`. Arcus volume counts with `ARCUS_FEE_RECIPIENT` set (see EVM swaps above). The portfolio lives under the profile (`/portfolio` redirects).
  VIP (`lib/profile/vip.ts`): the 30-day volume sets a share of the configured fee (base 3.5 bps: VIP 1-4 pay 3.25 / 3 /
  2.75 / 2.5). It applies only where the order carries our fee and the browser signs it: the Hyperliquid builder fee
  (perps, spot, HIP-4), the Lighter and Lighter RH integrator fees and the Aster builder fee. Swaps, bridges, Orderly
  (one broker rate) and Polymarket charge everyone their fixed rate; the user chose to keep it that way, and the
  profile says the discount is on perp fees.
- Discord roles (Profile → Overview, `components/profile/discord-roles-card.tsx`; `lib/discord/roles.ts` pure + tested,
  `lib/discord/server.ts`, routes `app/api/discord/{link,callback,roles}`): opt-in. The signed-in owner connects Discord
  (`GET /api/discord/link` → Discord's consent page, `identify` only, with a one-time `state` in Redis that names the
  profile, so the callback needs no cookie; the code is exchanged once and the token dropped). One profile per Discord
  account (`discord:<id>` index), stored as `discordId`/`discordName` on the profile and named to its owner only
  (`ProfileView.discord`; `enabled` is public so the card can ask to sign in). "Claim roles" (`POST /api/discord/roles`,
  once per 20s) has the bot give the role of the current level and 30-day VIP tier and take back managed roles moved
  past (`roleChanges`: roles the feature doesn't manage are never touched); unlinking takes them all back. After a
  claim the alerts tick keeps them current (`lib/discord/auto.ts`, every 5 minutes: linked profiles in the `dlinked`
  set, roles worked out from stored points and 30-day volume, Discord called only when they differ from `discordRoles`,
  at most 15 a run; a failure waits 6 hours). No gateway
  or always-on bot: plain REST calls with `DISCORD_BOT_TOKEN`. Env in `.env.example` (`DISCORD_CLIENT_ID/SECRET`,
  `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_LEVEL_ROLES`, `DISCORD_VIP_ROLES`); unset, or on the testnet site
  (`readDiscordConfig` checks `NEXT_PUBLIC_DEPLOYMENT`), the card is hidden.
  Errors read plainly: 10007 = not in the server ("join first"), 50013 = the bot's role is too low or lacks Manage Roles.
- Community links (`components/app/social-links.tsx`): Discord, Telegram and X from `NEXT_PUBLIC_DISCORD_URL`,
  `NEXT_PUBLIC_TELEGRAM_URL`, `NEXT_PUBLIC_X_URL` (https only; an unset one is hidden everywhere). Shown at the bottom of
  the account menu (top navigation has no rail), in the phone menu, in
  the home page footer, and on the invite gate as "Get an invite on Discord".
- Closed beta gate (`components/profile/access-gate.tsx`, root layout): every page but `/` and `/vaults` needs a wallet
  with `access` (admin, accepted invite or referral, or past volume). Admins switch it (Profile → Admin → Closed beta,
  `POST /api/admin/beta`; `lib/ops/beta.ts`, Redis `angler:ops:<deployment>:closed-beta`, unset = closed, read with a
  15s per-instance copy; rules in `lib/profile/beta.ts`). Closed: only admins get invite codes (`createAdminInvite`;
  volume earns none, `invites.paused`, codes from before wait) and only an admin's code is accepted (`setReferrer`).
  Open: no gate, volume earns codes again and any trader's code works as a referral. The layout renders the gate with
  the server's value and `/api/status` (`closedBeta`, `useClosedBeta`) carries a switch to open tabs within a minute. Mainnet only: on the testnet site the gate never shows
  and `readProfile` reports `access: true`. Profiles, invites and referrals are stored per deployment (Redis prefix
  `angler:profile:<deployment>`), so a testnet code never unlocks mainnet and the two never collide.
- Alerts (Profile → Alerts, `components/profile/alerts-view.tsx`; `lib/alerts/settings.ts`, `rules.ts`, `sources.ts`,
  `channels.ts`, `store.ts`, `tick.ts`; routes `app/api/alerts/*`): Telegram and/or Discord messages for positions
  (opened, added, reduced, flipped, closed; TP/SL and liquidations read as closes), liquidation distance (5/10/20%,
  once, re-armed past 1.5×), price levels (each fires once; the coin picker is `GET /api/alerts/coins`, `alertCoins` in
  `sources.ts`: the form picks a venue first, then its coin: Hyperliquid mids (main + HIP-3 dexes) as named there, and
  every Lighter / Lighter RH / Aster market as `lighter:` / `lighterrh:` / `aster:` + symbol, priced from their market
  lists; `readAlertCoins`) and news at or above
  an impact on the positions' coins and a coin list. Settings need the profile session cookie (sign in once); the
  Telegram chat is only set by the bot (`/start <code>` from a t.me link made by `/api/alerts/telegram/link`, `/stop`
  unlinks), never from the page. Discord webhooks are checked against Discord's hosts (the server posts to them),
  mentions are off. `GET /api/alerts/tick` (Bearer `CRON_SECRET`, Redis lock, 60s) runs once a minute from a scheduler
  (Vercel Cron on Pro, else a free one like cron-job.org; no always-on worker): one HGETALL each for settings and
  state whatever the user count (Upstash free tier), shared reads (mids, one news page with a cursor; the first tick
  only seeds it), then per EVM profile public position reads (HL `clearinghouseState` per dex, Lighter/Lighter RH
  `account?by=index`, account index cached, unknown ones looked up hourly). A venue read that fails keeps its last
  positions so a timeout never reads as a close; the first look after enabling only records. Aster/Orderly need signed
  reads, so they aren't watched. Env: `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
  `TELEGRAM_WEBHOOK_SECRET` (setWebhook once per deployment, `.env.example`). Hyperliquid's and Lighter's per-IP limits
  cap this at a few hundred watched wallets per tick; beyond that, rotate profiles across ticks.
- Out of scope: Supabase auth, memberships, payments, admin, referrals, Telegram. The terminal has no login.

- First load stays light: the Hyperliquid SDK (`hyperliquid/clients.ts`), viem's wallet client (`getWalletClient`),
  the Arcus SDK (`arcus/venue.ts`; lookups in `arcus/catalog.ts`) and the settings/setup dialogs (`lazy-dialogs.tsx`)
  load on demand. Don't import them statically from components on the first screen. The ticker bar streams its
  server-fetched prices through Suspense so the page shell never waits on market APIs. Also on demand: Aster's and
  Orderly's signing code (`onboarding.ts`, viem accounts / secp256k1 / keccak / ed25519; the first screen reads setup
  state from each venue's `store.ts`), the news socket client (`centrifuge`, imported with the first ticket), and the
  panels of the other views (`next/dynamic` in `order-panel.tsx`, `account-panel.tsx`, `terminal-shell.tsx`: the swap
  cards, the Dex Spot form, the panels under the chart on /swap and /spot), so /perp doesn't download them. Also
  loaded when first needed: the market search window (`asset-search-dialog.tsx`; `asset-search.tsx` keeps the provider,
  hook and types), the wallet window (`wallet-modal-window.tsx`), the hold-to-place button (only with a wallet), the
  position TP/SL and close dialogs and the watchlist panel. `VenueLogo` lives in `venue-logo.tsx` so the positions bar
  doesn't pull in the market lists. The navigation icons' paths are a sprite the root layout puts in the HTML
  (`nav-icon-sprite.tsx`, server component); `nav-icons.tsx` draws them with `<use>` (12 KB gzipped out of the JS). Aster's
  market list comes from `/api/aster/markets` (Aster's three lists fetched server-side, revalidated every 30s; the
  browser calls Aster directly only when the route fails). The Markets table renders 60 rows and adds 60 per scroll
  (`PAGE_ROWS`), and waits up to `SETTLE_MS` for every venue so rows don't land above the ones shown.
  Measured with Lighthouse on a production build (`npm run build` + `npm start`, mobile): Markets 42 → 99, Swap 71 →
  ~79, Prediction 71 → 80, /perp 68 → ~75 with its JS 452 → 344 KB (775 KB uncompressed; Next and React are 214 KB of it); the invite gate sits first in the body (on mainnet, a first visit's largest paint) and it rises without fading in (a paint at opacity 0 doesn't count).
- Security headers (`next.config.mjs`, every path): `frame-ancestors 'none'` + `X-Frame-Options: DENY` (a trading
  screen with one-click orders must never load in another site's frame), `nosniff`, `Referrer-Policy`,
  `Permissions-Policy` (no camera, microphone, geolocation, payment, USB) and HSTS. `htmlLimitedBots: /.*/` keeps
  title/description/robots in `<head>` for every visitor (Next streams them into the body otherwise, Googlebot
  included); all metadata is static or reads only the URL, so blocking on it costs nothing. `/api/favicon` asks
  Google's 64px icon first (a few hundred bytes) and DuckDuckGo's .ico second (lighter.xyz's is 60 KB).
- Rate limits (`lib/rate-limit.ts`, `rateLimited(request, scope, tier)` at the top of a handler): every route that
  spends our keys or quotas (Jupiter, Titan, Uniswap, Arcus, Relay, LI.FI, Across, aggregators, Solana RPC, spot
  candles/trades/search/holders, news, ws-ticket) answers 429 above `RATE_LIMITS` per IP per minute (read 240, send 30,
  heavy 30). In memory per instance (no Redis cost or latency on quotes); the Origin check alone can be faked by a
  script. Add it to any new proxy that carries a key.
- Load per open tab (checked for ~1k concurrent traders): `/api/news` answers from a 5s per-instance copy and the CDN
  (`s-maxage=5`, cursor pages 60s), since tabs without a live socket poll it every 15s. The profile syncs (server reads of
  every venue's fills) once per wallet, after each trade and every 5 min on profile pages only (`profile-provider.tsx`),
  not on a timer everywhere. Solana balances go through `readSolanaBalances` (`jupiter/balance-cache.ts`: one shared read
  per owner + mints for 10s, cleared by a trade; `fresh` before trading) and the route keeps a 4s copy (`fresh=1`
  skips it). Swap quotes (`use-spot-quotes.ts`, the EVM card) pause after 2 min without input (`lib/activity.ts`) and
  refresh when the user is back. Still to size against the plans: swap quote keys, Solana RPC, Upstash, Vercel.
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
  overlay dialogs (`useModalEnter` on the backdrop), native dialogs and popovers (`riseIn`), toasts
  (enter, collapse on dismiss), news arrivals and new position/order rows (`useListEnter`: never the first render,
  at most `MAX_ANIMATED_ARRIVALS` at once) and mobile view switches.
- Chart refresh: every 30s the chart fetches only from the last closed candle (`since`) and merges it
  (`lib/chart/merge-candles.ts`). The chart key follows the first venue only, so a fallback venue's market list
  arriving later doesn't clear the chart and refetch. Loading states keep their final size (order panel skeleton,
  mobile stats row, interval fit measured before paint) so nothing shifts when data lands.

## Checks

`npm test` (vitest, `*.test.ts` next to the module), `npm run typecheck`, `npm run lint` (ESLint 9 with Next's rules,
`eslint.config.mjs`; clean, keep it at zero warnings) and `npm run build` must pass before pushing. Pure logic (pricing, parsing, error mapping, storage) gets unit tests; network and wallet code does not.

In Claude Code cloud sessions, Node's built-in fetch ignores `HTTPS_PROXY`: start the app (or any script that calls
external APIs) with `NODE_USE_ENV_PROXY=1`. Delete `.next/cache` after running against mocks, since `unstable_cache`
persists responses across builds.
