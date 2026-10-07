import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Angler Terminal: every perp DEX on one screen, with AI-scored news";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const venues = ["Hyperliquid", "Lighter", "Jupiter", "Arcus"];

/** Link preview card, rendered once at build time. */
export default async function OpenGraphImage() {
  const logo = await readFile(join(process.cwd(), "public", "whitelogo.png"));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "radial-gradient(circle at 85% 15%, #0d2a3d 0%, #000000 60%)",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${logo.toString("base64")}`} width={96} height={96} alt="" />
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1.5 }}>Angler Terminal</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ fontSize: 44, lineHeight: 1.25, maxWidth: 960, color: "#e6edf5" }}>
            Every perp DEX on one screen, with AI-scored news you can trade in two taps.
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            {venues.map((venue) => (
              <div
                key={venue}
                style={{ display: "flex", padding: "10px 22px", borderRadius: 999, border: "2px solid #2a3a4a", fontSize: 26, color: "#9fb3c8" }}
              >
                {venue}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
