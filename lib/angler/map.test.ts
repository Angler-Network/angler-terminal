import { describe, expect, it } from "vitest";
import newsPage from "./fixtures/news-page.json";
import sources from "./fixtures/sources.json";
import enrichedMessage from "./fixtures/stage-enriched.json";
import translatedItem from "./fixtures/news-translated.json";
import rawMessage from "./fixtures/stage-raw.json";
import {
  fromApiNewsItem,
  readApiNewsItem,
  mergeFeedNews,
  readApiNewsPage,
  readNewsPage,
  readSources,
  readStageMessage,
  sentimentValue,
  severityFor,
  sourceNames,
  toNewsItem,
} from "./map";

// Fixtures are live API responses (2026-10-05) with article bodies shortened and exposure lists cut to two.
const NOW = Date.parse("2026-10-05T15:20:00Z");
const names = sourceNames(readSources(sources));

describe("GET /v1/news", () => {
  it("reads a page and drops article content", () => {
    const page = readApiNewsPage(newsPage);
    expect(page.items).toHaveLength(5);
    expect(page.next_cursor).toBe(newsPage.next_cursor);
    expect(page.items[0]).toMatchObject({ id: 231787, source_id: 102, importance_score: 28, published_at: "2026-10-05T15:10:53Z" });
    expect(page.items.every((item) => !("content" in item))).toBe(true);
  });

  it("reads the last page, whose cursor is null", () => {
    expect(readApiNewsPage({ items: [], next_cursor: null })).toEqual({ items: [], next_cursor: null });
  });

  it("re-reads its own output (the /api/news response) unchanged", () => {
    const page = readApiNewsPage(newsPage);
    expect(readApiNewsPage(JSON.parse(JSON.stringify(page)))).toEqual(page);
  });

  it("maps REST items: numeric id, source by id, score and coins, no enrichment", () => {
    const { items, nextCursor } = readNewsPage(readApiNewsPage(newsPage));
    expect(nextCursor).toBe(newsPage.next_cursor);
    const item = toNewsItem(items[0], NOW, names);
    expect(item).toMatchObject({
      id: "231787",
      headline: newsPage.items[0].title,
      sources: ["CryptoBriefing"],
      sourceDomain: "cryptobriefing.com",
      score: 28,
      severity: "notable",
      sentiment: 0,
      hasSentiment: false,
      enriched: true,
      publishedAt: Date.parse("2026-10-05T15:10:53Z"),
      minutesAgo: 9,
    });
    // Tweets relayed by Tree of Alpha: the favicon follows the article URL, the name the source.
    expect(toNewsItem(items[1], NOW, names)).toMatchObject({ sources: ["Tree of Alpha"], sourceDomain: "x.com" });
  });

  it("parses every published_at precision the API sends", () => {
    const base = Date.parse("2026-10-05T15:10:51Z");
    const cases: [string, number][] = [
      ["2026-10-05T15:10:51Z", 0],
      ["2026-10-05T15:10:51.75Z", 750],
      ["2026-10-05T15:10:51.757Z", 757],
      ["2026-10-05T15:10:51.757123Z", 757],
      ["2026-10-05T15:10:51.757123456Z", 757],
    ];
    for (const [published_at, millis] of cases) {
      const news = fromApiNewsItem({ ...readApiNewsPage(newsPage).items[0], published_at });
      expect(toNewsItem(news, NOW).publishedAt).toBe(base + millis);
    }
  });

  it("skips items that miss required fields", () => {
    const [first] = newsPage.items;
    const page = readApiNewsPage({ items: [{ ...first, id: "x" }, { ...first, title: " " }, { ...first, importance_score: undefined }], next_cursor: null });
    expect(page.items).toEqual([]);
  });
});

describe("translations and summaries", () => {
  // Live /v1/news item (2026-10-06): Chinese original with its English translation, bodies shortened.
  const translated = readApiNewsItem(translatedItem)!;

  it("keeps the English title of a translated REST item and drops the bodies", () => {
    expect(translated.title).toBe(translatedItem.title);
    expect(translated.translations).toEqual({ en: { title: translatedItem.translations.en.title } });
    expect("content" in translated).toBe(false);
    expect(readApiNewsItem(JSON.parse(JSON.stringify(translated)))).toEqual(translated);
  });

  it("shows the English headline and keeps the original for its tooltip", () => {
    const item = toNewsItem(fromApiNewsItem(translated), NOW, names);
    expect(item).toMatchObject({ headline: translatedItem.translations.en.title, originalHeadline: translatedItem.title, lang: "zh" });
    const original = toNewsItem(fromApiNewsItem(translated), NOW, names, false);
    expect(original.headline).toBe(translatedItem.title);
    expect(original.originalHeadline).toBeUndefined();
  });

  it("ignores missing or untranslated titles", () => {
    const body = { ...translatedItem, translations: { en: { content: "<p>…</p>" } } };
    expect(readApiNewsItem(body)?.translations).toBeUndefined();
    expect(toNewsItem(fromApiNewsItem(readApiNewsItem(body)!), NOW).headline).toBe(translatedItem.title);
  });

  it("reads summary_short on REST items", () => {
    const news = fromApiNewsItem(readApiNewsItem({ ...newsPage.items[0], summary_short: " Short take. " })!);
    expect(toNewsItem(news, NOW).summary).toBe("Short take.");
  });

  it("reads translations.en on news.enriched, null parts and the deprecated title_en", () => {
    const base = { ...enrichedMessage, item: { ...enrichedMessage.item, title: "原标题", lang: "zh" } };
    expect(readStageMessage({ ...base, item: { ...base.item, translations: { en: { title: "English title", content: null } } } })?.titleEn).toBe("English title");
    expect(readStageMessage({ ...base, item: { ...base.item, translations: { en: { title: null, content: "x" } } } })?.titleEn).toBeUndefined();
    expect(readStageMessage({ ...base, item: { ...base.item, translations: null, title_en: "Old field" } })?.titleEn).toBe("Old field");
    // English items carry translations: null.
    expect(readStageMessage(enrichedMessage)?.titleEn).toBeUndefined();
  });

  it("keeps the translation when a later stage arrives without it", () => {
    const raw = readStageMessage(rawMessage)!;
    const enriched = { ...readStageMessage(enrichedMessage)!, titleEn: "English title" };
    expect(mergeFeedNews(enriched, raw).titleEn).toBe("English title");
  });
});

describe("realtime stage messages", () => {
  it("reads news.raw: id from news_item_id, source slug, not scored", () => {
    const news = readStageMessage(rawMessage)!;
    expect(news).toMatchObject({ id: "231801", sourceSlug: "seekingalpha-market", importanceScore: undefined, coins: [] });
    expect(toNewsItem(news, NOW, names)).toMatchObject({ enriched: false, sources: ["SeekingAlpha Market Currents"], sourceDomain: "seekingalpha.com" });
  });

  it("reads news.enriched: empty item id, coin objects, sentiment label", () => {
    expect(enrichedMessage.item.id).toBe("");
    const news = readStageMessage(enrichedMessage)!;
    expect(news).toMatchObject({ id: "231800", importanceScore: 20, coins: ["ETH", "BTC"], sentiment: { label: "positive" } });
    expect(news.summaryShort).toBe(enrichedMessage.item.summary_short);
    const item = toNewsItem(news, NOW, names);
    expect(item).toMatchObject({ enriched: true, symbol: "ETH", direction: "up", sources: ["Bitcoin.com News"], sourceDomain: "news.bitcoin.com" });
    expect(item.sentiment).toBeCloseTo(enrichedMessage.item.sentiment.confidence);
    expect(item.hasSentiment).toBe(true);
  });

  it("leads with the strongest impact prediction", () => {
    const withPredictions = {
      ...enrichedMessage,
      item: {
        ...enrichedMessage.item,
        importance_score: 84,
        impact_predictions: [
          { symbol: "BTC", direction: "+", magnitude: 30 },
          { symbol: "ETH", direction: "-", magnitude: 65 },
        ],
      },
    };
    const item = toNewsItem(readStageMessage(withPredictions)!, NOW);
    expect(item).toMatchObject({ symbol: "ETH", direction: "down", severity: "breaking", coins: ["ETH", "BTC"] });
    expect(item.predictions).toEqual([
      { symbol: "ETH", direction: "-", magnitude: 65 },
      { symbol: "BTC", direction: "+", magnitude: 30 },
    ]);
  });

  it("rejects messages without news_item_id or title", () => {
    expect(readStageMessage(enrichedMessage.item)).toBeNull();
    expect(readStageMessage({ ...rawMessage, item: { ...rawMessage.item, title: "" } })).toBeNull();
  });
});

describe("raw → enriched upsert", () => {
  it("keeps enrichment when a late raw duplicate arrives", () => {
    const raw = readStageMessage({ ...rawMessage, news_item_id: 231800, item: { ...rawMessage.item, source: "bitcoin-com-news" } })!;
    const enriched = readStageMessage(enrichedMessage)!;
    const merged = mergeFeedNews(mergeFeedNews(raw, enriched), raw);
    expect(merged).toMatchObject({ importanceScore: 20, coins: ["ETH", "BTC"], sentiment: { label: "positive" }, publishedAt: raw.publishedAt });
    expect(toNewsItem(merged, NOW).enriched).toBe(true);
  });

  it("enriches a REST item in place", () => {
    const rest = fromApiNewsItem({ ...readApiNewsPage(newsPage).items[0], id: 231800, coins: ["ETH", "BTC"] });
    const merged = mergeFeedNews(rest, readStageMessage(enrichedMessage)!);
    expect(merged).toMatchObject({ id: "231800", sourceId: 102, sourceSlug: "bitcoin-com-news", summaryShort: enrichedMessage.item.summary_short });
  });
});

describe("helpers", () => {
  it("turns the sentiment label into -1..1", () => {
    expect(sentimentValue({ label: "negative", confidence: 0.7 })).toBe(-0.7);
    expect(sentimentValue({ label: "neutral", confidence: 0.9 })).toBe(0);
    expect(sentimentValue(undefined)).toBe(0);
  });

  it("derives severity", () => {
    expect(severityFor(80)).toBe("breaking");
    expect(severityFor(60)).toBe("important");
    expect(severityFor(59)).toBe("notable");
  });

  it("indexes sources by id and slug", () => {
    expect(names.byId.get(87)).toBe("Bitcoin.com News");
    expect(names.bySlug.get("treealpha")).toBe("Tree of Alpha");
  });
});
