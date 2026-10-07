import type { Metadata } from "next";
import { PredictionView } from "@/components/prediction/prediction-view";

export const metadata: Metadata = {
  title: "Prediction",
  description: "Polymarket and Hyperliquid prediction markets in one terminal: live odds, order books and trading.",
  alternates: { canonical: "/prediction" },
};

export default function PredictionPage() {
  return <PredictionView />;
}
