import type { Metadata } from "next";
import { StatusScreen } from "@/components/app/status-screen";

export const metadata: Metadata = { title: "Page not found" };

/** 404 inside the app shell (sidebar and top bar stay), so the way back is one click. */
export default function NotFound() {
  return (
    <StatusScreen
      mark="404"
      title="Page not found"
      description="This page doesn't exist or has moved."
      primary={{ href: "/perp", label: "Trade perp" }}
      secondary={{ href: "/swap", label: "Swap tokens" }}
    />
  );
}
