import { ArrowLeftRight, Brain, LayoutDashboard, Sparkles, Zap, type LucideIcon } from "lucide-react";

/**
 * Copy for the welcome tour shown before the alpha notice. Edit freely: slides show in this order, and the alpha
 * notice always comes last. Bump ACK_KEY in alpha-notice.tsx when the copy should be shown again to everyone.
 */
export interface WelcomeSlide {
  id: string;
  icon: LucideIcon;
  title: string;
  intro: string;
  points: string[];
}

export const welcomeSlides: WelcomeSlide[] = [
  {
    id: "welcome",
    icon: Sparkles,
    title: "Welcome to Angler Terminal",
    intro: "Trade the news the moment it breaks: live, AI-scored headlines next to your chart, with the order one tap away.",
    points: [],
  },
  {
    id: "features",
    icon: LayoutDashboard,
    title: "What the terminal does",
    intro: "One screen from headline to position.",
    points: [
      "A live news stream from hundreds of sources, scored for impact and sentiment as it arrives.",
      "Important news shows a size grid per asset: Long or Short, four sizes, confirm and done.",
      "Hyperliquid and Lighter perps, Jupiter spot on Solana, routed to the venue that lists the asset.",
      "A chart that marks headlines on the candles, plus filters by asset, sentiment and importance.",
      "Positions, orders and balances for every connected venue in one place.",
    ],
  },
  {
    id: "vs-terminals",
    icon: Zap,
    title: "How it differs from other trading terminals",
    intro: "Most terminals start from a chart and an order form. Angler starts from the news.",
    points: [
      "The headline is the order ticket: no hunting for the symbol, the market or the right venue.",
      "Several venues from one screen, perps and spot, with automatic fallback when one doesn't list the asset.",
      "Self-custodial: no account, no deposit to us. Trading keys are created and kept in your browser.",
      "Keyboard first: L / S to trade the selected headline, 1-4 for size, Enter to confirm.",
    ],
  },
  {
    id: "vs-news",
    icon: Brain,
    title: "How it differs from other news terminals",
    intro: "Other news terminals stop at the headline. Angler reads it for you and lets you act on it.",
    points: [
      "AI enrichment on every item: impact score, sentiment, the assets it moves and an expected direction.",
      "Raw headlines show first, then the enriched version replaces them in place seconds later.",
      "High-impact alerts with an optional sound, so nothing important scrolls by unnoticed.",
      "From reading to a placed order in two presses, without switching apps.",
    ],
  },
  {
    id: "vs-news-app",
    icon: ArrowLeftRight,
    title: "Terminal vs. news.angler.network",
    intro: "Same feed, same look, different job.",
    points: [
      "news.angler.network is for reading: research, alerts, saved views and Telegram delivery.",
      "The terminal is for trading: connect a wallet and act on the headline directly.",
      "Settings, themes and the news feed feel the same in both, so you can move between them.",
    ],
  },
];
