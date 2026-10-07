import type { PredictionCategory, PredictionEvent, PredictionMarket } from "./types";

/**
 * Hyperliquid HIP-4 outcome markets (`outcomeMeta`). Every outcome is a binary market whose two sides trade as
 * coins `#<10 × outcome + side>` (side 0 = Yes); orders use asset id 100,000,000 + that number. Deployers create
 * them from templates whose parameters sit in a pipe-separated description ("perp:BTC|target:90000|time:…"), so
 * titles are built here: questions (one winner among named outcomes) become one event each, and standalone outcomes
 * are grouped by what they're about (one asset and date, one game, one IPO deadline).
 */

export interface Hip4Outcome {
  outcome: number;
  name: string;
  description: string;
  sideSpecs: Array<{ name: string }>;
  venue?: string;
}

export interface Hip4Question {
  question: number;
  name: string;
  description: string;
  fallbackOutcome: number;
  namedOutcomes: number[];
  settledNamedOutcomes: number[];
}

export interface Hip4Meta {
  outcomes: Hip4Outcome[];
  questions: Hip4Question[];
}

/** Every outcome's contract size is a whole number; orders are worth at least 10 USDC. */
export const HIP4_MIN_ORDER_USD = 10;
export const HIP4_ASSET_OFFSET = 100_000_000;

export function hip4Coin(outcome: number, side: 0 | 1) {
  return `#${outcome * 10 + side}`;
}

/** The order asset id for a `#N` coin, or null when it isn't one. */
export function hip4AssetId(coin: string) {
  const match = /^#(\d+)$/.exec(coin);
  return match ? HIP4_ASSET_OFFSET + Number(match[1]) : null;
}

/** "a:1|b:x" → { a: "1", b: "x" }; values may contain colons. */
export function readFields(description: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of description.split("|")) {
    const at = part.indexOf(":");
    if (at > 0) fields[part.slice(0, at)] = part.slice(at + 1);
  }
  return fields;
}

/** "20261031-2359" (UTC) → ms, null when malformed. */
export function readStamp(value: string | undefined): number | null {
  const match = value ? /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute);
}

function stampText(ms: number | null, withTime: boolean) {
  if (ms === null) return "";
  const date = new Date(ms);
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (!withTime || minutes === 0 || minutes === 23 * 60 + 59) return day;
  return `${day}, ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}

/** Index names end in digits (XYZ100) and are points, not dollars. */
function priceText(asset: string, value: string | undefined) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value ?? "";
  const text = number.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return /\d$/.test(asset) ? text : `$${text}`;
}

function billions(value: string | undefined) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value ?? "";
  return number >= 1000 ? `$${Number((number / 1000).toFixed(2))}T` : `$${number}B`;
}

/** "xyz:XYZ100" → "XYZ100"; external instruments use their short name. */
function assetOf(fields: Record<string, string>) {
  const perp = fields.perp ?? fields.underlying;
  if (perp) return perp.includes(":") ? perp.slice(perp.indexOf(":") + 1) : perp;
  return fields.shortName ?? fields.instrument ?? "?";
}

/** Crypto perps on Hyperliquid's main dex; HIP-3 (xyz) perps and external feeds are stocks and indices. */
function priceCategory(fields: Record<string, string>): PredictionCategory {
  const perp = fields.perp ?? fields.underlying ?? "";
  return fields.feed || fields.instrument || perp.includes(":") ? "stocks" : "crypto";
}

function sideLabel(spec: { name: string } | undefined, fields: Record<string, string>, fallback: string) {
  const name = (spec?.name ?? fallback).replace(/^template:/, "");
  const placeholder = /^\{(\w+)\}$/.exec(name);
  return placeholder ? (fields[placeholder[1]] ?? fallback) : name;
}

type Mids = Record<string, string | number | undefined>;

function price(mids: Mids, coin: string) {
  const value = Number(mids[coin]);
  return Number.isFinite(value) && mids[coin] !== undefined ? value : null;
}

function market(outcome: Hip4Outcome, label: string, mids: Mids): PredictionMarket {
  const fields = readFields(outcome.description);
  const yes = hip4Coin(outcome.outcome, 0);
  const no = hip4Coin(outcome.outcome, 1);
  return {
    id: `hl:${outcome.outcome}`,
    label: label.trim(),
    question: null,
    outcomes: [
      { label: sideLabel(outcome.sideSpecs[0], fields, "Yes").trim(), price: price(mids, yes), asset: yes },
      { label: sideLabel(outcome.sideSpecs[1], fields, "No").trim(), price: price(mids, no), asset: no },
    ],
    acceptingOrders: true,
    tickSize: 0.00001,
    minSize: 1,
    volume24h: null,
    change24h: null,
  };
}

function event(id: string, title: string, subtitle: string | null, category: PredictionCategory, endsAt: number | null, markets: PredictionMarket[]): PredictionEvent {
  return { id: `hl:${id}`, source: "hyperliquid", title: title.replace(/\s+/g, " ").trim(), subtitle, image: null, category, endsAt, volume24h: null, volume: null, url: null, exclusive: id.startsWith("q"), markets };
}

const templateOf = (name: string) => name.replace(/^template:/, "");

function bucketLabels(thresholds: string | undefined, asset: string) {
  const values = (thresholds ?? "").split(",").filter(Boolean);
  return (index: number) => {
    if (index === 0) return `Under ${priceText(asset, values[0])}`;
    if (index >= values.length) return `Over ${priceText(asset, values[values.length - 1])}`;
    return `${priceText(asset, values[index - 1])} – ${priceText(asset, values[index])}`;
  };
}

function questionEvent(question: Hip4Question, byId: Map<number, Hip4Outcome>, mids: Mids): PredictionEvent | null {
  const fields = readFields(question.description);
  const template = templateOf(question.name);
  const settled = new Set(question.settledNamedOutcomes);
  const named = question.namedOutcomes.filter((id) => !settled.has(id)).map((id) => byId.get(id)).filter((outcome): outcome is Hip4Outcome => Boolean(outcome));
  if (named.length === 0) return null;
  const asset = assetOf(fields);
  const bucket = bucketLabels(fields.priceThresholds, asset);
  const labelOf = (outcome: Hip4Outcome) => {
    const own = readFields(outcome.description);
    const name = templateOf(outcome.name);
    if (own.participant) return own.participant;
    if (own.candidate) return own.candidate;
    if (name === "sportsContestDraw2") return "Draw";
    if (name === "policyRateNoChange") return "No change";
    if (name === "policyRateDecrease") return "Cut";
    if (name === "policyRateIncrease") return "Hike";
    if (name === "Recurring Named Outcome" && own.index !== undefined) return bucket(Number(own.index));
    return name;
  };
  const markets = named.map((outcome) => market(outcome, labelOf(outcome), mids));
  // The catch-all "Other" outcome mostly has no book (its mid sits at the 0.5 placeholder): shown only when traded.
  const fallback = byId.get(question.fallbackOutcome);
  const fallbackMid = fallback ? price(mids, hip4Coin(fallback.outcome, 0)) : null;
  if (fallback && fallbackMid !== null && fallbackMid !== 0.5) markets.push(market(fallback, "Other", mids));

  const id = `q${question.question}`;
  if (template === "sportsTournamentWinner") {
    return event(id, `${fields.competition ?? "Tournament"} ${fields.season ?? ""} winner`.replace(/\s+winner$/, " winner").trim(), null, "sports", readStamp(fields.resolutionDeadline), markets);
  }
  if (template === "policyRateDecision") {
    const institution = /federal/i.test(fields.institution ?? "") ? "Fed" : (fields.institution ?? "Rate");
    const label = (fields.decisionLabel ?? "").replace(/\s*FOMC$/, "");
    return event(id, `${institution} decision: ${label}`, fields.policyMeasure ?? null, "economy", readStamp(fields.scheduledDecision), markets);
  }
  if (template === "sportsContestResult") {
    const subtitle = [fields.competition, fields.stage].filter(Boolean).join(" · ") || null;
    return event(id, `${fields.participantA} vs ${fields.participantB}`, subtitle, "sports", readStamp(fields.scheduledStart), markets);
  }
  if (template === "awardWinner") {
    return event(id, `${fields.award ?? "Award"} ${fields.period ?? ""}`.trim(), fields.awardingBody ?? null, fields.field ? "sports" : "culture", readStamp(fields.resolutionDeadline), markets);
  }
  if (fields.class === "priceBucket") {
    return event(id, `${asset} price on ${stampText(readStamp(fields.expiry), true)}`, null, priceCategory(fields), readStamp(fields.expiry), markets);
  }
  return event(id, template, null, guessCategory(template), null, markets);
}

/** Questions written by hand (no template) are filed by the words in their title. */
export function guessCategory(title: string): PredictionCategory {
  if (/\b(vs\.?|cup|champion|league|nba|nfl|mlb|nhl|match|tournament|grand prix|open)\b/i.test(title)) return "sports";
  if (/\b(cpi|fed|fomc|rate|inflation|gdp|jobs|unemployment|payrolls)\b/i.test(title)) return "economy";
  if (/\b(btc|bitcoin|eth|ethereum|sol|solana|hype|crypto)\b/i.test(title)) return "crypto";
  if (/\b(election|president|senate|parliament|minister)\b/i.test(title)) return "politics";
  return "other";
}

interface Group {
  key: string;
  title: string;
  subtitle: string | null;
  category: PredictionCategory;
  endsAt: number | null;
  markets: Array<{ sort: number; market: PredictionMarket }>;
}

/** Where a standalone outcome belongs and what it's called inside its group. */
function placeStandalone(outcome: Hip4Outcome) {
  const fields = readFields(outcome.description);
  const template = templateOf(outcome.name);
  const asset = assetOf(fields);
  if (template === "binaryPrice" || template === "binaryPriceExternal" || fields.class === "priceBinary") {
    const time = fields.time ?? fields.expiry;
    const target = fields.threshold ?? fields.targetPrice;
    return {
      key: `above:${asset}:${time}`,
      title: `${asset} above ___ on ${stampText(readStamp(time), true)}?`,
      subtitle: fields.priceDescription ?? null,
      category: priceCategory(fields),
      endsAt: readStamp(time),
      label: priceText(asset, target),
      sort: Number(target),
    };
  }
  if (template === "priceTouch") {
    return {
      key: `touch:${asset}:${fields.time}`,
      title: `${asset} hits ___ by ${stampText(readStamp(fields.time), true)}?`,
      subtitle: fields.priceDescription ?? null,
      category: priceCategory(fields),
      endsAt: readStamp(fields.time),
      label: priceText(asset, fields.target),
      sort: Number(fields.target),
    };
  }
  if (template === "companyIpoConfirmed") {
    return {
      key: `ipo:${fields.dateTime}`,
      title: `IPO by ${stampText(readStamp(fields.dateTime), false)}?`,
      subtitle: null,
      category: "companies" as const,
      endsAt: readStamp(fields.dateTime),
      label: fields.company ?? "?",
      sort: 0,
    };
  }
  if (template === "companyIpoFirstDayMarketCap") {
    return {
      key: `ipocap:${fields.company}:${fields.listingDeadline}`,
      title: `${fields.company} IPO: first-day market cap above ___?`,
      subtitle: `If it lists by ${stampText(readStamp(fields.listingDeadline), false)}`,
      category: "companies" as const,
      endsAt: readStamp(fields.listingDeadline),
      label: billions(fields.marketCapThresholdB),
      sort: Number(fields.marketCapThresholdB),
    };
  }
  if (template === "sportsContestWinner" || template === "sportsTotal" || template === "sportsSpread") {
    const teams = [fields.participantA, fields.participantB].sort().join("|");
    const label =
      template === "sportsContestWinner"
        ? "Winner"
        : template === "sportsTotal"
          ? `Total ${fields.measure ?? ""} ${fields.line ?? ""}`.replace(/\s+/g, " ").trim()
          : `${fields.shortNameA ?? fields.participantA} ${fields.spread ?? ""}`.trim();
    return {
      key: `game:${teams}:${fields.scheduledStart}`,
      title: `${fields.participantA} vs ${fields.participantB}`,
      subtitle: [fields.competition, fields.stage].filter(Boolean).join(" · ") || null,
      category: "sports" as const,
      endsAt: readStamp(fields.scheduledStart),
      label,
      sort: template === "sportsContestWinner" ? 0 : template === "sportsTotal" ? 1 : 2,
    };
  }
  return null;
}

/** Events that ended this long ago and still aren't settled are dropped (testnet keeps months of them). */
const STALE_AFTER_MS = 3 * 86_400_000;

/**
 * Turns `outcomeMeta` plus `allMids` into events, soonest first. Outcomes no template explains are left out, and so
 * are events that ended more than three days before `now`.
 */
export function buildHip4Events(meta: Hip4Meta, mids: Mids, now = Date.now()): PredictionEvent[] {
  return groupHip4Events(meta, mids).filter((entry) => entry.endsAt === null || entry.endsAt > now - STALE_AFTER_MS);
}

function groupHip4Events(meta: Hip4Meta, mids: Mids): PredictionEvent[] {
  const byId = new Map(meta.outcomes.map((outcome) => [outcome.outcome, outcome]));
  const inQuestion = new Set(meta.questions.flatMap((question) => [question.fallbackOutcome, ...question.namedOutcomes]));
  const events: PredictionEvent[] = meta.questions.map((question) => questionEvent(question, byId, mids)).filter((entry): entry is PredictionEvent => entry !== null);

  const groups = new Map<string, Group>();
  for (const outcome of meta.outcomes) {
    if (inQuestion.has(outcome.outcome)) continue;
    const place = placeStandalone(outcome);
    if (!place) continue;
    const group = groups.get(place.key) ?? { key: place.key, title: place.title, subtitle: place.subtitle, category: place.category, endsAt: place.endsAt, markets: [] };
    group.markets.push({ sort: place.sort, market: market(outcome, place.label, mids) });
    groups.set(place.key, group);
  }
  for (const group of groups.values()) {
    const markets = group.markets.sort((a, b) => a.sort - b.sort).map((entry) => entry.market);
    events.push(event(group.key, group.title, group.subtitle, group.category, group.endsAt, markets));
  }
  return events.sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity));
}
