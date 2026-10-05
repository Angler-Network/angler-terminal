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

## Secrets

- The repository is shared with hackathon judges. Never commit secrets, keys, tickets or real `.env` files.
- `.env.example` holds placeholders only. Real values live in `.env.local` (gitignored).
- `ANGLER_API_KEY` is read only on the server (`lib/angler/env.ts`, imported by route handlers). Never expose it to the
  browser and never prefix it with `NEXT_PUBLIC_`.

## Architecture

- Theme: `app/globals.css` CSS variables + `app.*` tokens in `tailwind.config.ts`, Sora font in `app/layout.tsx`, copied
  from angler-news. Default theme is `deepnavy`. Keep Next.js, React and Tailwind on the same versions as angler-news.
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
- Selected asset lives in `components/terminal/selected-asset.tsx`; news chips call `selectAsset`.
- Out of scope: Supabase auth, memberships, payments, admin, referrals, Telegram. The terminal has no login.

## Checks

`npm run typecheck` and `npm run build` must pass before pushing.
