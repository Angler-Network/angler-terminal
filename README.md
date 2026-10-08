<p align="center">
  <img src="public/brand/angler-banner.jpg" alt="Angler Terminal" width="100%" />
</p>

# Angler Terminal

**Trade every major on-chain market from one screen, with the news that moves it.**

Perps, token swaps, spot order books and prediction markets across Hyperliquid, Lighter, Aster, Orderly, Jupiter,
Uniswap, Polymarket and more. Next to the chart runs a live news feed scored by AI, so you see why a market moves
and can act on it in two taps.

**[Open the app →](https://trade.angler.network)** · [Try it on testnet](https://testnet-trade.angler.network) ·
[Angler News](https://news.angler.network)

> **Alpha.** Angler Terminal is new and still changing. Start small, or practice on the testnet site with free test
> funds. Not financial advice: news scores and predictions are model outputs.

## What you can do

### Perp Dex: perpetual futures on every venue

- Long or short crypto, stocks and indices on **Hyperliquid, Lighter, Aster and Orderly** from one order panel:
  market and limit orders, leverage, cross or isolated margin, take profit and stop loss.
- **Best price, automatically.** Before a market order, the terminal reads the live order books of every venue that
  lists the asset, adds each venue's fees and sends your order to the cheapest one. Large orders can be split across
  venues when that fills cheaper.
- **One order book for all venues**, colored by venue, so you see the real depth of the market.
- **Funding rates side by side**, and a one-click funding trade that goes long where funding is low and short where
  it's high.

### Swap: any token, any chain

- Swap Solana tokens through **Jupiter** and **Titan**, and EVM tokens on Ethereum, Base, Arbitrum and Robinhood Chain
  through **Uniswap, 0x and Odos**. The terminal asks several sources and executes the best quote.
- Go **cross-chain in one step** with Relay, LI.FI and Across: pay with USDC on one chain, receive a token on another.
- An optional **Private** mode only uses routes that skip the public mempool, to protect you from front-running.

### Spot Dex: order books and stock tokens

- Spot trading on **Hyperliquid and Lighter** order books, with limit orders and open-order management.
- **Tokenized stocks and indices** (TSLA, NVDA and more) on Robinhood Chain through **Arcus**, trading 24/7.

### Prediction markets

- Browse and trade **Polymarket** and **Hyperliquid** outcome markets (elections, sports, crypto prices) from one
  page, with live trades as they happen.

### News that you can trade

- Headlines from news sites, X and Telegram arrive in real time, each scored for **importance, sentiment and the assets it
  affects**. News in other languages is translated to English.
- Important news shows **Long / Short buttons** for the assets it mentions. One press arms the order, a second press
  places it.
- **What happened last time:** important news shows how the asset moved 1 hour, 4 hours and 24 hours after similar
  news in the past weeks.
- **News rules:** "alert me when bearish BTC news scores 80+" or "close my position on bad news about it". Rules ask
  you before trading unless you choose otherwise.
- Filter by asset, sentiment and impact, and get notified when big news breaks.

### Your portfolio, your profile

- **All your positions and orders across venues** in one table, with liquidation distance, account value per venue
  and close-all.
- **Move funds between venues and chains** from one window: deposit, withdraw, or bridge USDC from Hyperliquid to
  Lighter in a single flow.
- **Earn points** for the volume you trade through Angler, climb ten levels from Minnow to Whale, appear on the
  leaderboard and invite friends with your referral link.

### Make it yours

- Choose your layout: hide panels, drag them around, resize columns, or start from the News trader, Pro trader or
  Minimal preset.
- Pick a theme and an accent color, sidebar or top navigation, and the built-in chart (with news on the candles) or
  TradingView.
- Works on your phone, and can be installed as an app.

## Your keys, your funds

Angler Terminal is **non-custodial**. It never holds your money or your private keys.

- **Your funds stay with you and the venues.** There is no Angler deposit contract or pooled account. Every deposit
  and withdrawal is signed by your own wallet.
- **Trading keys live only in your browser.** To trade without a wallet popup on every order, Hyperliquid, Lighter,
  Aster and Orderly use a trading key created in your browser. It can place orders but can't withdraw your funds,
  it never leaves your device, and you can revoke it at any time.
- **Nothing trades by surprise.** Orders need two presses by default, automatic rules are off until you turn them
  on, and swaps are re-quoted right before you sign and refused if the price impact is too high.
- **No account, no login.** Connect a wallet and trade. Your settings stay in your browser. The only thing linked to
  your wallet address is your profile: points, level and an optional username.
- **Open source.** Every line of the code that signs your orders is public in this repository.

## Get started

1. Open **[trade.angler.network](https://trade.angler.network)**.
2. Press **Connect** and choose your wallet. EVM wallets (MetaMask, Rabby, Coinbase Wallet…) and Solana wallets
   (Phantom, Backpack, Solflare…) both work, and wallets that support both chains connect both at once.
3. Pick a market and trade. The first time you use a perp venue, a short setup creates your trading key with a
   wallet signature or two.

**Want to practice first?** Open the **[testnet site](https://testnet-trade.angler.network)**, where everything runs
with free test money. The terminal hands it out for you: **Get test USDC** for Lighter, **Mint mUSDG** for Arcus
stock tokens, and a link to Hyperliquid's faucet.

## FAQ

**Does it cost anything to use?**
The app is free. You pay each venue's normal trading fees, plus a small Angler fee on some trades, the way other
trading front ends do. The order summary shows the fees before you confirm.

**Which markets are available where I live?**
Each venue sets its own rules. Some venues, Polymarket for example, are not available in every country, and the
terminal tells you when a venue is blocked for you.

**Where does the news come from?**
From [Angler News](https://news.angler.network), which collects headlines from news sites, X, Telegram and data
feeds and scores each one with AI models. The scores are a guide, not a promise: models can be wrong.

**What's the difference between the two sites?**
[trade.angler.network](https://trade.angler.network) trades real funds on mainnet.
[testnet-trade.angler.network](https://testnet-trade.angler.network) is the same app on test networks with free
test money.

**I found a bug or a security issue.**
Bugs and ideas are welcome as [GitHub issues](https://github.com/Angler-Network/angler-terminal/issues). Please
report security issues privately to the maintainers, not in a public issue.

## For developers

Angler Terminal is a Next.js app written in TypeScript. Setup, configuration, scripts and the project layout are in
**[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.

## Disclaimer

This software is provided as is, without warranty. Trading perpetual futures, tokens and prediction markets carries
a high risk of loss. News scores, sentiment and predictions are model outputs, not financial advice. You are
responsible for every trade you place.
