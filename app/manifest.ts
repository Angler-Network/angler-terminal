import type { MetadataRoute } from "next";

/** Installable on phones and desktops ("Add to Home Screen"): opens full screen like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Angler Terminal",
    short_name: "Angler",
    description: "Every perp DEX on one screen, with AI-scored news you can trade in two taps.",
    start_url: "/perp",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/logo.png", sizes: "1000x1000", type: "image/png", purpose: "any" },
      { src: "/whitelogo.png", sizes: "500x500", type: "image/png", purpose: "maskable" },
    ],
  };
}
