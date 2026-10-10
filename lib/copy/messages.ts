import { formatPrice } from "@/lib/format";
import { coinSymbol, type LeaderEvent } from "./events";
import { FOLLOW_SOURCE_NAMES, followId, followName, type WatchedWallet } from "./follows";

/** Alert text for one change of a followed wallet, with a link that opens the copy window on that trade. */

const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const amount = (value: number) => Number(Math.abs(value).toPrecision(6)).toString();
const side = (size: number) => (size > 0 ? "long" : "short");

/** The /copy link for a leader trade: the page offers that coin and side at the follower's own size. */
export function copyLink(site: string, wallet: Pick<WatchedWallet, "source" | "address">, event: Pick<LeaderEvent, "coin" | "after">) {
  const params = new URLSearchParams({ follow: followId(wallet.source, wallet.address), coin: event.coin, side: event.after > 0 ? "long" : "short" });
  return `${site}/copy?${params}`;
}

export function leaderMessage(event: LeaderEvent, wallet: WatchedWallet, site: string) {
  const who = `🐋 ${followName(wallet)}`;
  const coin = coinSymbol(event.coin);
  const where = `${coin} on ${FOLLOW_SOURCE_NAMES[wallet.source]}`;
  const value = (size: number) => compactUsd.format(Math.abs(size) * event.price);
  const link = (text: string) => `${text}\n${copyLink(site, wallet, event)}`;
  switch (event.kind) {
    case "open":
      return link(`${who} opened ${side(event.after)} ${amount(event.after)} ${where} at ${formatPrice(event.price)} (${value(event.after)})`);
    case "add":
      return link(`${who} added to ${side(event.after)} ${where}: ${amount(event.before)} → ${amount(event.after)} at about ${formatPrice(event.price)}`);
    case "reduce":
      return `${who} reduced ${side(event.after)} ${where}: ${amount(event.before)} → ${amount(event.after)} at about ${formatPrice(event.price)}`;
    case "close":
      return `${who} closed ${side(event.before)} ${amount(event.before)} ${where} near ${formatPrice(event.price)}`;
    case "flip":
      return link(`${who} flipped ${where} to ${side(event.after)} ${amount(event.after)} at ${formatPrice(event.price)}`);
  }
}
