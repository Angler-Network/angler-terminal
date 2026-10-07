import { Target } from "lucide-react";
import type { Metadata } from "next";
import { StatusScreen } from "@/components/app/status-screen";

export const metadata: Metadata = {
  title: "Prediction",
  description: "Prediction markets are coming to Angler Terminal.",
  alternates: { canonical: "/prediction" },
};

export default function PredictionPage() {
  return (
    <StatusScreen
      icon={Target}
      badge="Coming soon"
      title="Prediction markets"
      description="Trade the outcome of the events behind the news, from the same screen as your perps and spot."
      primary={{ href: "/perp", label: "Trade perps" }}
      secondary={{ href: "/spot", label: "Trade spot" }}
    />
  );
}
