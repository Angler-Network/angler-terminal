"use client";

import { Copy, Download, Share2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Toggle } from "@/components/app/form-controls";
import { useToast } from "@/components/app/toast-provider";
import { useModalEnter } from "@/components/app/use-motion";
import { DESIGNS, type DesignId, type TradeInput } from "@/lib/share-card/format";
import { PALETTES, type PaletteId } from "@/lib/share-card/palettes";
import { ASSET_BASE, exportCard, renderCard } from "@/lib/share-card/render";
import { siteUrl } from "@/lib/site";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import { venueLogoUrl } from "./market-rows";
import type { VenuePosition } from "@/lib/venues/types";

const STORAGE_KEY = "angler.share-card";
/** Exports at 3200×2000. */
const EXPORT_SCALE = 2;

interface Choice {
  design: DesignId;
  palette: PaletteId;
  hidePnl: boolean;
  showVenue: boolean;
}

const DEFAULT_CHOICE: Choice = { design: "velocity", palette: "native", hidePnl: false, showVenue: true };

/** The last design and options, a per-browser convenience. */
function readChoice(): Choice {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Choice>;
    return {
      design: DESIGNS.some((d) => d.id === stored.design) ? stored.design! : DEFAULT_CHOICE.design,
      palette: PALETTES.some((p) => p.id === stored.palette) ? stored.palette! : DEFAULT_CHOICE.palette,
      hidePnl: typeof stored.hidePnl === "boolean" ? stored.hidePnl : DEFAULT_CHOICE.hidePnl,
      showVenue: typeof stored.showVenue === "boolean" ? stored.showVenue : DEFAULT_CHOICE.showVenue,
    };
  } catch {
    return DEFAULT_CHOICE;
  }
}

/** The card's record for a live position: ROE and unrealized PnL exactly as the venue reports them. */
export function positionTrade(position: VenuePosition, url = siteUrl()): TradeInput {
  // HIP-3 markets carry their dex ("xyz:TSLA"); the card shows the asset.
  const symbol = position.symbol.split(":").pop() || position.symbol;
  return {
    symbol,
    symbolIcon: `/api/token-icon?symbol=${encodeURIComponent(symbol)}`,
    market: "PERP",
    direction: position.size >= 0 ? "long" : "short",
    leverage: position.leverage,
    roi: position.returnOnEquity * 100,
    pnl: position.unrealizedPnl,
    venue: PERP_VENUE_NAMES[position.venue],
    venueIcon: venueLogoUrl(PERP_VENUE_NAMES[position.venue]) ?? undefined,
    domain: new URL(url).host,
    url,
  };
}

/** A position's PnL card: six designs, six code-driven colors, PNG download, copy and the system share sheet. */
export function SharePositionDialog({ position, onClose }: { position: VenuePosition; onClose: () => void }) {
  const toast = useToast();
  const backdropRef = useModalEnter(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [choice, setChoice] = useState<Choice>(DEFAULT_CHOICE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"download" | "copy" | "share" | null>(null);
  const trade = useMemo(
    () => positionTrade(position),
    // Follows the live PnL, without redrawing for every unrelated change to the position object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [position.symbol, position.size >= 0, position.leverage, position.returnOnEquity, position.unrealizedPnl, position.venue],
  );
  const data = useMemo(() => ({ ...trade, hidePnl: choice.hidePnl, showVenue: choice.showVenue }), [trade, choice.hidePnl, choice.showVenue]);

  useEffect(() => setChoice(readChoice()), []);
  const update = (patch: Partial<Choice>) =>
    setChoice((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const target = canvas.current;
    if (!target) return;
    renderCard(target, data, { design: choice.design, palette: choice.palette })
      .then(() => !cancelled && setError(null))
      .catch((reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      cancelled = true;
    };
  }, [data, choice.design, choice.palette]);

  const filename = `angler-${trade.symbol.toLowerCase()}-${choice.design}.png`;
  const png = () => exportCard(data, { design: choice.design, palette: choice.palette, scale: EXPORT_SCALE });
  const run = async (kind: "download" | "copy" | "share", action: () => Promise<void>) => {
    setBusy(kind);
    try {
      await action();
    } catch (reason) {
      // Closing the share sheet isn't a failure.
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        toast({ tone: "error", title: "Couldn't export the card", message: reason instanceof Error ? reason.message : String(reason) });
      }
    } finally {
      setBusy(null);
    }
  };

  const download = () =>
    run("download", async () => {
      const url = URL.createObjectURL(await png());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const canCopy = typeof window !== "undefined" && "ClipboardItem" in window && Boolean(navigator.clipboard?.write);
  const copy = () =>
    run("copy", async () => {
      // Safari wants the item created inside the click, with the blob still pending.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png() })]);
      toast({ tone: "success", title: "Card copied", message: "Paste it into a post or a chat." });
    });
  const canShare = typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([], "card.png", { type: "image/png" })] });
  const share = () =>
    run("share", async () => {
      const file = new File([await png()], filename, { type: "image/png" });
      await navigator.share({ files: [file], text: `${trade.symbol} on Angler`, url: trade.url });
    });

  const designNames = Object.fromEntries(DESIGNS.map((d) => [d.id, d.name]));
  const buttonBase = "inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold disabled:opacity-50";

  // On the body: the positions table animates its rows with transforms, which would pin a fixed overlay to the row.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" ref={backdropRef} role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-card-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu scrollbar-subtle flex max-h-[calc(100dvh-2rem)] w-full max-w-[760px] flex-col gap-4 overflow-y-auto rounded-2xl border border-app-hairline-strong bg-app-card p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] sm:p-5"
      >
        <header className="flex items-center gap-3">
          <h2 id="share-card-title" className="min-w-0 flex-1 text-[16px] font-semibold text-app-ink">
            Share {trade.symbol} position
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-lg text-app-muted hover:bg-app-chip hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>

        <div className="shrink-0 overflow-hidden rounded-xl border border-app-hairline bg-[#05070c]">
          <canvas ref={canvas} width={1600} height={1000} className="block aspect-[8/5] h-auto w-full" />
        </div>
        {error && (
          <p role="alert" className="-mt-2 text-[12px] text-app-down">
            {error}
          </p>
        )}

        <section className="flex shrink-0 flex-col gap-2">
          <span className="text-[12px] font-medium text-app-muted">Design · {designNames[choice.design]}</span>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {DESIGNS.map((design) => (
              <button
                key={design.id}
                type="button"
                aria-pressed={choice.design === design.id}
                onClick={() => update({ design: design.id })}
                className={`group relative aspect-[8/5] overflow-hidden rounded-lg border bg-cover bg-center transition ${
                  choice.design === design.id ? "border-app-accent ring-2 ring-app-accent/40" : "border-app-hairline hover:border-app-hairline-strong"
                }`}
                style={{ backgroundImage: `url(${ASSET_BASE}${design.asset})` }}
              >
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-3 text-left text-[11px] font-semibold text-white">
                  {design.name}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2" role="radiogroup" aria-label="Color">
            <span className="mr-1 text-[12px] font-medium text-app-muted">Color</span>
            {PALETTES.map((palette) => (
              <button
                key={palette.id}
                type="button"
                role="radio"
                aria-checked={choice.palette === palette.id}
                aria-label={palette.name}
                title={palette.name}
                onClick={() => update({ palette: palette.id })}
                className={`size-6 rounded-full border transition ${
                  choice.palette === palette.id ? "border-app-ink ring-2 ring-app-ink/30 ring-offset-2 ring-offset-app-card" : "border-white/15 hover:scale-110"
                }`}
                style={{ background: palette.id === "native" ? `conic-gradient(${DESIGNS.map((d) => d.accent).join(",")})` : palette.swatch }}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-[12px] font-medium text-app-muted">
            <Toggle label="Show dollar PnL" checked={!choice.hidePnl} onChange={(on) => update({ hidePnl: !on })} />
            Dollar PnL
          </label>
          <label className="flex items-center gap-2 text-[12px] font-medium text-app-muted">
            <Toggle label="Show venue" checked={choice.showVenue} onChange={(on) => update({ showVenue: on })} />
            Venue
          </label>
        </section>

        <footer className="flex flex-wrap gap-2">
          <button type="button" onClick={download} disabled={busy !== null || Boolean(error)} className={`${buttonBase} bg-app-accent text-app-on-accent hover:opacity-90`}>
            <Download className="size-4" />
            {busy === "download" ? "Exporting…" : "Download PNG"}
          </button>
          {canCopy && (
            <button type="button" onClick={copy} disabled={busy !== null || Boolean(error)} className={`${buttonBase} border border-app-hairline-strong bg-app-chip text-app-ink hover:bg-app-card`}>
              <Copy className="size-4" />
              {busy === "copy" ? "Copying…" : "Copy image"}
            </button>
          )}
          {canShare && (
            <button type="button" onClick={share} disabled={busy !== null || Boolean(error)} className={`${buttonBase} border border-app-hairline-strong bg-app-chip text-app-ink hover:bg-app-card`}>
              <Share2 className="size-4" />
              Share
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
