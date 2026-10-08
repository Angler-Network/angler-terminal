import qrcode from "qrcode-generator";
import { dataLabel, DESIGNS, leverageText, normalizeData, signedMoney, signedPercent, type DesignId, type TradeData, type TradeInput } from "./format";
import { paletteFor, recolorArt, type PaletteId } from "./palettes";

/**
 * The PnL share card, drawn on a canvas at a fixed 1600×1000 so the preview and the exported PNG are the same pixels.
 * The artwork has no text: every word and number is drawn here, after the artwork is recolored. Ported from the design
 * kit (design-kits/share-cards/src/render.js) with two changes: the UI type is Sora (the app's font) instead of Geist,
 * and a QR code to the site sits bottom right.
 */

export const CARD_WIDTH = 1600;
export const CARD_HEIGHT = 1000;
export const ASSET_BASE = "/angler-pnl/";

/** The app's own Sora files (app/globals.css), so the card is set in the same type as the site. */
const SORA = [
  {
    url: "/fonts/sora-latin.3dc379dc.woff2",
    unicodeRange:
      "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  },
  {
    url: "/fonts/sora-latin-ext.c5f10e9e.woff2",
    unicodeRange: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
  },
];

const WHITE = "#f2f5fa";
const MUTED = "#818ca1";
const RED = "#ff8d9a";

type Ctx = CanvasRenderingContext2D;

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Couldn't load ${url}`));
    image.src = url;
  });
}

let resources: Promise<Record<string, HTMLImageElement>> | null = null;

/** Fonts and the six textures, loaded once per page; a failure is thrown, not drawn in fallback type. */
export function loadResources() {
  if (resources) return resources;
  const loading = (async () => {
    const faces = [
      ...SORA.map(({ url, unicodeRange }) => new FontFace("AnglerUI", `url("${url}")`, { weight: "100 800", style: "normal", unicodeRange })),
      new FontFace("AnglerDisplay", `url("${ASSET_BASE}fonts/BarlowCondensed-ExtraBoldItalic.ttf")`, { weight: "800", style: "italic" }),
    ];
    await Promise.all(
      faces.map(async (face) => {
        await face.load();
        document.fonts.add(face);
      }),
    );
    const images = await Promise.all(DESIGNS.map(async (design) => [design.asset, await loadImage(ASSET_BASE + design.asset)] as const));
    return Object.fromEntries(images);
  })();
  resources = loading;
  loading.catch(() => {
    if (resources === loading) resources = null;
  });
  return loading;
}

function font(c: Ctx, size: number, family = "AnglerUI", weight = 500, italic = false) {
  c.font = `${italic ? "italic " : ""}${weight} ${size}px "${family}"`;
}

interface TextOptions {
  family?: string;
  weight?: number;
  italic?: boolean;
  maxWidth?: number;
  align?: CanvasTextAlign;
}

/** Draws a line, shrinking it until it fits `maxWidth`. */
function text(c: Ctx, value: string, x: number, y: number, size = 28, color = WHITE, { family = "AnglerUI", weight = 500, italic = false, maxWidth = Infinity, align = "left" }: TextOptions = {}) {
  let s = size;
  font(c, s, family, weight, italic);
  while (c.measureText(value).width > maxWidth && s > 8) {
    s *= 0.97;
    font(c, s, family, weight, italic);
  }
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = "alphabetic";
  c.fillText(value, x, y);
  return c.measureText(value).width;
}

function circle(c: Ctx, x: number, y: number, r: number, color: string) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
}

function polygon(c: Ctx, points: Array<[number, number]>, color: string | CanvasGradient) {
  c.beginPath();
  points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fillStyle = color;
  c.fill();
}

function gradient(c: Ctx, x1: number, y1: number, x2: number, y2: number, stops: Array<[number, string]>) {
  const g = c.createLinearGradient(x1, y1, x2, y2);
  stops.forEach(([p, color]) => g.addColorStop(p, color));
  return g;
}

function shadeLeft(c: Ctx, { start = 570, end = 1080, opacity = 0.66 } = {}) {
  c.fillStyle = gradient(c, start, 0, end, 0, [
    [0, `rgba(8,11,17,${opacity})`],
    [1, "rgba(8,11,17,0)"],
  ]);
  c.fillRect(0, 150, end, 710);
}

function token(c: Ctx, symbol: string, x: number, y: number, size = 48) {
  c.save();
  c.translate(x, y);
  const k = size / 48;
  if (symbol === "BTC") {
    circle(c, 0, 0, size / 2, "#f7931a");
    c.rotate(0.22);
    font(c, size * 0.69, "AnglerUI", 750);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "#fff";
    c.fillText("B", 0, size * 0.025);
    c.fillRect(-7 * k, -19 * k, 3 * k, 7 * k);
    c.fillRect(-1 * k, -19 * k, 3 * k, 7 * k);
    c.fillRect(-7 * k, 13 * k, 3 * k, 7 * k);
    c.fillRect(-1 * k, 13 * k, 3 * k, 7 * k);
  } else if (symbol === "ETH") {
    circle(c, 0, 0, size / 2, "#202533");
    polygon(c, [[0, -18 * k], [-12 * k, 1 * k], [0, 7 * k]], "#c8d0ee");
    polygon(c, [[0, -18 * k], [12 * k, 1 * k], [0, 7 * k]], "#8c9abf");
    polygon(c, [[0, 19 * k], [-12 * k, 4 * k], [0, 10 * k]], "#a3b1d6");
    polygon(c, [[0, 19 * k], [12 * k, 4 * k], [0, 10 * k]], "#7180a4");
  } else if (symbol === "SOL") {
    circle(c, 0, 0, size / 2, "#121320");
    for (let i = 0; i < 3; i++) {
      const y0 = -12 * k + i * 9 * k;
      const fill = gradient(c, -10, 0, 10, 10, [
        [0, "#6ce1c3"],
        [1, "#8b63ef"],
      ]);
      polygon(c, [[-11 * k, y0], [13 * k, y0], [8 * k, y0 + 5 * k], [-16 * k, y0 + 5 * k]], fill);
    }
  } else {
    circle(c, 0, 0, size / 2, "#27344a");
    text(c, symbol.slice(0, 3), 0, size * 0.13, size * 0.3, "#dce7fa", { weight: 650, align: "center" });
  }
  c.restore();
}

function brand(c: Ctx, x = 80, y = 113, size = 52) {
  text(c, "Angler", x, y, size, WHITE, { weight: 550 });
}

function market(c: Ctx, d: TradeData, x: number, y: number, { size = 26, icon = 46 } = {}) {
  token(c, d.symbol, x + icon / 2, y - icon * 0.3, icon);
  text(c, `${d.symbol}—${d.market}`, x + icon + 18, y, size, WHITE, { weight: 600, maxWidth: 360 });
}

function direction(c: Ctx, d: TradeData, x: number, y: number, color: string, size = 26) {
  text(c, `${d.direction.toUpperCase()} / ${leverageText(d.leverage)}`, x, y, size, color, { weight: 570 });
}

const QR_SIZE = 136;
const QR_RIGHT = 1520;
const QR_BOTTOM = 930;

/** A QR code to the site on a white tile (dark on light scans with every camera), bottom right. */
function qr(c: Ctx, url: string) {
  const code = qrcode(0, "M");
  code.addData(url);
  code.make();
  const count = code.getModuleCount();
  const x = QR_RIGHT - QR_SIZE;
  const y = QR_BOTTOM - QR_SIZE;
  const pad = 10;
  c.beginPath();
  c.roundRect(x, y, QR_SIZE, QR_SIZE, 14);
  c.fillStyle = WHITE;
  c.fill();
  const cell = (QR_SIZE - pad * 2) / count;
  c.fillStyle = "#0a0d14";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      // A hair oversized, so neighboring cells meet without seams when the card is scaled.
      if (code.isDark(row, col)) c.fillRect(x + pad + col * cell, y + pad + row * cell, cell + 0.4, cell + 0.4);
    }
  }
}

const VENUE_ICON = 34;

function footer(c: Ctx, d: TradeData, venueIcon: HTMLImageElement | null) {
  text(c, d.domain, 80, 920, 24, MUTED, { maxWidth: 850 });
  if (d.showVenue) {
    const right = QR_RIGHT - QR_SIZE - 28;
    const width = text(c, d.venue, right, 920, 24, MUTED, { align: "right", maxWidth: 400 });
    if (venueIcon) {
      // A round logo left of the name, centered on its x-height.
      const x = right - width - 12 - VENUE_ICON;
      const y = 920 - 9 - VENUE_ICON / 2;
      c.save();
      c.beginPath();
      c.arc(x + VENUE_ICON / 2, y + VENUE_ICON / 2, VENUE_ICON / 2, 0, Math.PI * 2);
      c.clip();
      c.drawImage(venueIcon, x, y, VENUE_ICON, VENUE_ICON);
      c.restore();
    }
  }
  qr(c, d.url);
}

const venueIcons = new Map<string, Promise<HTMLImageElement | null>>();

/** The venue logo, or null when it doesn't load: a missing logo leaves just the name. */
function loadVenueIcon(url: string) {
  let icon = venueIcons.get(url);
  if (!icon) venueIcons.set(url, (icon = loadImage(url).catch(() => null)));
  return icon;
}

function dollars(c: Ctx, d: TradeData, x: number, y: number, size: number, color = WHITE, width = 900) {
  text(c, d.hidePnl ? "••••••" : signedMoney(d.pnl), x, y, size, d.pnl < 0 && !d.hidePnl ? RED : color, { maxWidth: width, weight: 470 });
}

function roi(c: Ctx, d: TradeData, x: number, y: number, width: number, size: number, color = WHITE, weight = 500) {
  text(c, signedPercent(d.roi), x, y, size, d.roi < 0 ? RED : color, { weight, maxWidth: width });
}

/** The big condensed return: sign, number and % at their own sizes, shrunk together to fit. */
function splitScore(c: Ctx, d: TradeData, { x = 80, baseline = 620, width = 950, size = 465 } = {}) {
  const value = Math.abs(d.roi).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = d.roi < 0 ? "−" : d.roi > 0 ? "+" : "";
  const spans: Array<[string, number]> = [
    [sign, 0.61],
    [value, 1],
    ["%", 0.59],
  ];
  const measure = (s: number) =>
    spans.reduce((sum, [v, k]) => {
      font(c, s * k, "AnglerDisplay", 800, true);
      return sum + c.measureText(v).width;
    }, 0);
  let s = size;
  while (measure(s) > width && s > 12) s *= 0.975;
  let cursor = x;
  for (const [v, k] of spans) {
    font(c, s * k, "AnglerDisplay", 800, true);
    c.fillStyle = d.roi < 0 ? RED : WHITE;
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
    c.fillText(v, cursor, baseline);
    cursor += c.measureText(v).width;
  }
}

type Painter = (c: Ctx, d: TradeData, accent: string, venueIcon: HTMLImageElement | null) => void;

/** Each design's layout on top of its (recolored) artwork, in the kit's 1600×1000 coordinates. */
const painters: Record<DesignId, Painter> = {
  velocity(c, d, accent, venueIcon) {
    brand(c);
    market(c, d, 1065, 113, { size: 29 });
    splitScore(c, d, { baseline: 624, width: 950, size: 510 });
    direction(c, d, 80, 705, accent, 30);
    dollars(c, d, 80, 811, 96, WHITE, 800);
    footer(c, d, venueIcon);
  },
  polar(c, d, accent, venueIcon) {
    brand(c, 80, 113, 52);
    market(c, d, 80, 282, { size: 30 });
    direction(c, d, 80, 340, "#9aaec9", 24);
    roi(c, d, 68, 577, 930, 272, accent, 550);
    dollars(c, d, 80, 683, 82, WHITE, 800);
    footer(c, d, venueIcon);
  },
  eclipse(c, d, accent, venueIcon) {
    brand(c, 80, 113, 48);
    market(c, d, 80, 283, { size: 28 });
    dollars(c, d, 68, 568, 225, WHITE, 930);
    roi(c, d, 80, 688, 770, 100, accent, 420);
    direction(c, d, 80, 787, "#8f96b4", 27);
    footer(c, d, venueIcon);
  },
  orbit(c, d, accent, venueIcon) {
    shadeLeft(c, { start: 520, end: 1100, opacity: 0.82 });
    brand(c, 80, 113, 52);
    market(c, d, 80, 281, { size: 29 });
    splitScore(c, d, { x: 74, baseline: 612, width: 840, size: 485 });
    direction(c, d, 80, 701, accent, 28);
    dollars(c, d, 80, 800, 88, WHITE, 760);
    footer(c, d, venueIcon);
  },
  relay(c, d, accent, venueIcon) {
    shadeLeft(c, { start: 610, end: 1000, opacity: 0.5 });
    brand(c, 80, 113, 52);
    market(c, d, 80, 281, { size: 29 });
    direction(c, d, 80, 342, accent, 25);
    roi(c, d, 68, 586, 930, 274, WHITE, 550);
    dollars(c, d, 80, 707, 94, accent, 870);
    footer(c, d, venueIcon);
  },
  mono(c, d, accent, venueIcon) {
    brand(c, 80, 113, 48);
    market(c, d, 80, 281, { size: 29 });
    dollars(c, d, 70, 543, 220, WHITE, 890);
    roi(c, d, 80, 681, 820, 110, accent, 420);
    direction(c, d, 80, 791, "#939dad", 27);
    footer(c, d, venueIcon);
  },
};

export interface RenderOptions {
  design?: DesignId;
  palette?: PaletteId;
  /** 2 exports 3200×2000. */
  scale?: number;
}

export async function renderCard(canvas: HTMLCanvasElement, input: TradeInput, { design = "velocity", palette = "native", scale = 1 }: RenderOptions = {}) {
  const spec = DESIGNS.find((entry) => entry.id === design);
  if (!spec) throw new RangeError(`Unknown design: ${design}`);
  if (!Number.isFinite(scale) || scale < 0.1 || scale > 4) throw new RangeError("scale must be between 0.1 and 4");
  const d = normalizeData(input);
  const [images, venueIcon] = await Promise.all([loadResources(), d.showVenue && d.venueIcon ? loadVenueIcon(d.venueIcon) : null]);
  const colors = paletteFor(palette, spec.accent);
  const art = recolorArt(images[spec.asset], colors, spec.hue);
  canvas.width = Math.round(CARD_WIDTH * scale);
  canvas.height = Math.round(CARD_HEIGHT * scale);
  const c = canvas.getContext("2d");
  if (!c) throw new Error("2D canvas is unavailable");
  c.setTransform(canvas.width / CARD_WIDTH, 0, 0, canvas.height / CARD_HEIGHT, 0, 0);
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  c.drawImage(art, 0, 0, CARD_WIDTH, CARD_HEIGHT);
  painters[design](c, d, colors.accent, venueIcon);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", dataLabel(d));
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))), "image/png"));
}

/** The card as a PNG, drawn by the same painter as the preview. */
export async function exportCard(input: TradeInput, options: RenderOptions = {}) {
  const canvas = document.createElement("canvas");
  await renderCard(canvas, input, options);
  return canvasToBlob(canvas);
}
