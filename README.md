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

## How the news feed works

1. `GET /api/news` loads recent history (proxied to `/v1/news`, paginated with `next_cursor`).
2. `POST /api/ws-ticket` mints a single-use realtime ticket on the server.
3. The browser connects to Centrifugo with the ticket as connection data, minting a new ticket on every reconnect,
   and subscribes to `news.raw` and `news.enriched`.
4. Raw headlines show immediately; the enriched version (coins, sentiment, impact predictions, summary, importance)
   replaces it in place, matched by news id.

The API key never reaches the browser.

## Layout

Top bar (logo, ticker tape, Connect) · chart · order panel · live news column · positions/orders bar.
Built on the theme, news components, chart and market data of [angler-news](https://news.angler.network).
