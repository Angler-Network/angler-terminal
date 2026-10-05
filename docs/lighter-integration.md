# Lighter integration notes

Research behind Lighter as the second perp venue (a `PerpVenue` next to Hyperliquid), implemented in
`lib/venues/lighter/` (see CLAUDE.md for the summary). Findings checked live on testnet on 2026-10-05 are listed
under "Verified on testnet".
Source of truth: https://apidocs.lighter.xyz (index: `/llms.txt`; append `.md` to any docs page). Read
`/docs/agent-instructions.md` first: it lists the rules that prevent the common mistakes.

## Environments

| | Testnet (default) | Mainnet |
| --- | --- | --- |
| REST | `https://testnet.zklighter.elliot.ai/api/v1/` | `https://mainnet.zklighter.elliot.ai/api/v1/` |
| WebSocket | `wss://testnet.zklighter.elliot.ai/stream` | `wss://mainnet.zklighter.elliot.ai/stream` |
| Chain id (signing) | `300` | `304` |
| App | testnet.app.lighter.xyz | app.lighter.xyz |

Testnet perps on 2026-10-05: SOL (`market_id` 4097), ETH (4095), BTC (4096). Never hard-code ids: read
`GET /orderBookDetails` (fields used: `market_id`, `symbol`, `status`, `size_decimals`, `price_decimals`,
`min_base_amount`, `min_quote_amount`, `min_initial_margin_fraction` → max leverage = 10000 / it, `mark_price`,
`last_trade_price`, `daily_price_change`). Cache it server-side like `/api/hl/markets`.

## Signer (WASM)

Lighter uses its own signature scheme (not EIP-712). The official signer is Go, compiled to WASM:

```sh
git clone https://github.com/elliottech/lighter-go && cd lighter-go
GOOS=js GOARCH=wasm go build -trimpath -o build/lighter-signer.wasm ./wasm/
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" build/   # or misc/wasm on older Go
```

- `wasm_exec.js` must come from the same Go version as the `.wasm`. Go 1.24 is installed in cloud sessions.
- Plan: commit both under `public/lighter/` with a `scripts/build-lighter-signer.sh` that records the lighter-go
  commit, and load them lazily in the browser only when Lighter is used.
- All `Sign*` functions are positional globals; the last two args are always `apiKeyIndex, accountIndex`; pass `0`
  for unused args; check `result.error` on every call.
- Do all HTTP from JS: `CreateClient("", privateKey, chainId, apiKeyIndex, accountIndex)`, explicit nonces from
  `GET /nextNonce`, never `CheckClient` or `nonce = -1`.

## Onboarding (self-custodial frontend pattern)

1. Account: created by the first deposit. `GET /accountsByL1Address?l1_address=` → `sub_accounts[0].index`;
   code `21100` = no account yet (show a deposit link).
2. API key: `GenerateAPIKey()` in the browser → `CreateClient` → `SignChangePubKey(publicKey, 0, nonce, keyIdx,
   acct)` → user `personal_sign`s `messageToSign` with their EVM wallet → set `txInfo.L1Sig` → `POST /sendTx`
   (form-urlencoded `tx_type`, `tx_info`) → poll `GET /apikeys?account_index=&api_key_index=` until it returns the
   public key (no `0x`). Use a dedicated key index for the app (4–254; 0–3 reserved); registering replaces the key
   at that index. Store the private key per network + L1 address + account index (docs recommend encrypting at rest
   with a non-extractable WebCrypto key).
3. Partner fee (optional): `SignApproveIntegrator(integratorIdx, maxPerpsTaker, maxPerpsMaker, maxSpotTaker,
   maxSpotMaker, expiryMs, 0, nonce, keyIdx, acct)`; needs the L1 signature when the integrator account has a
   different owner and any fee > 0. Fee unit: value / 1e6 of trade size (1000 = 10 bps). Testnet caps
   (`/systemConfig`): perps 10000, spot 20000. Non-zero fees only work when the client is on the Plus or Premium
   tier (`GET /accountLimits` → `user_tier`); on Standard send zero fees (attribution still works). Non-zero fees
   cannot be combined with non-default self-trade modes (error 21159). Max 4 integrators per client.

## Orders

- `SignCreateOrder(marketIndex, clientOrderIndex, baseAmount, price, isAsk, orderType, timeInForce, reduceOnly,
  triggerPrice, orderExpiry, integratorAccountIndex, integratorTakerFee, integratorMakerFee,
  selfTradeBehaviorMode, selfTradeEqualityMode, skipNonce, nonce, apiKeyIndex, accountIndex)`.
- Market order: `orderType` 1, `timeInForce` 0 (IOC), `orderExpiry` 0, `price` = worst acceptable price (best ask
  × 1.0x for buys). Integers: `size × 10^size_decimals`, `price × 10^price_decimals`. Enforce the larger of
  `min_base_amount` and `min_quote_amount`.
- `clientOrderIndex` unique across markets, ≤ 2^48 − 1.
- Leverage: `SignUpdateLeverage(market, 10000 / leverage, 0 cross | 1 isolated, 0, nonce, keyIdx, acct)`.
- Cancel: `SignCancelOrder(market, orderIndex, 0, nonce, keyIdx, acct)`.
- `sendTx` `code: 200` means accepted, not executed: confirm with `GET /tx?by=hash&value=` or WebSocket
  `account_tx/{account}`.
- Nonces are per API key: serialize sends, keep a local counter, refetch on `21104`. Before re-signing after an
  unknown outcome, check tx status and `nextNonce` (re-signing can place the order twice).

## Account data

WebSocket (send `{"type":"ping"}` at least every 2 minutes; reconnect and resubscribe):
`account_all/{account}` (positions, trades, funding) and `account_all_orders/{account}` (open orders), both with
`"auth": <token>` from `CreateAuthToken(deadlineUnixSeconds ≤ 8h, keyIdx, acct)`. Payload shapes:
`/docs/websocket-reference.md`. Error codes and tx statuses: `/docs/data-structures-constants-and-errors.md`;
common causes: `/docs/troubleshooting.md`.

## Verified on testnet (2026-10-05)

- `sendTx` answers HTTP 400 with `{ code, message }` on rejection (e.g. 21100 account not found, 21109 api key not
  found, 21504 "fail to l1 signature" for a ChangePubKey signed by the wrong wallet).
- `account_all` and `user_stats` need no auth; `account_all_orders` and `account_tx` answer
  `{"error":{"code":20001,"message":"invalid param : auth field is required: ..."}}` without it.
- `update/account_all` only carries the markets that changed; positions have an unsigned `position` plus `sign`,
  and `initial_margin_fraction` is a percentage ("5.00" = 20x).
- `accountOrders` with an auth token from an unregistered key answers 401 `{"code":20013,"message":"invalid auth:
  couldnt find account"}`.
- REST CORS allows any origin (credentials and the `authorization` header included); the WebSocket accepts any
  `Origin`.
- `SignCreateOrder` takes `price` as uint32 (max 2^32 - 1) and refuses values above it.
- No funded testnet account was available, so a real fill was not exercised: register a key with a funded testnet
  wallet and place a $10 SOL order to complete the end-to-end check.

## Rate limits

Standard accounts get 60 REST requests/minute: prefer WebSocket, cache markets on the server, authenticate requests
(counts against the L1 address instead of the IP). Back off on HTTP 429/405.

## App integration plan

- `lib/venues/lighter/`: `config.ts` (`NEXT_PUBLIC_LIGHTER_NETWORK`, `NEXT_PUBLIC_LIGHTER_API_KEY_INDEX`,
  `NEXT_PUBLIC_LIGHTER_INTEGRATOR_ACCOUNT`, fees), `markets.ts`, `pricing.ts`, `errors.ts`, `key-store.ts` (pure,
  unit-tested), `signer.ts` (WASM loader), `onboarding.ts`, `venue.ts` (`PerpVenue`).
- `/api/lighter/markets` cached 60s (network param like `/api/hl/markets`).
- `VenueMarket` gains `venue`, `priceDecimals`, `minBaseAmount`, `minQuoteAmount`.
- Settings → Venues: enable Lighter, network, preferred perp venue (default Hyperliquid; fall back to the other venue
  when the preferred one doesn't list the asset). The trade ticket carries the perp venue id.
- Positions bar merges both venues with a venue badge; close/cancel route by venue. Account panel gets a Lighter
  section; setup dialog: deposit check → register key → approve integrator.
