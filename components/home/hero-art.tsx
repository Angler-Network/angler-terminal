/**
 * The home page's hero illustration: a fishing line drops out of the dark and hooks the top candle of a rising chart.
 * Pure SVG with CSS motion (the line sways, the catch glows), and it holds still under prefers-reduced-motion.
 */

const CANDLES: Array<{ x: number; open: number; close: number; high: number; low: number }> = [
  { x: 40, open: 214, close: 196, high: 190, low: 222 },
  { x: 66, open: 196, close: 204, high: 188, low: 210 },
  { x: 92, open: 204, close: 180, high: 172, low: 208 },
  { x: 118, open: 180, close: 188, high: 174, low: 196 },
  { x: 144, open: 188, close: 160, high: 150, low: 192 },
  { x: 170, open: 160, close: 166, high: 152, low: 174 },
  { x: 196, open: 166, close: 138, high: 128, low: 170 },
  { x: 222, open: 138, close: 146, high: 130, low: 154 },
  { x: 248, open: 146, close: 116, high: 104, low: 150 },
  { x: 274, open: 116, close: 124, high: 108, low: 132 },
  { x: 300, open: 124, close: 92, high: 82, low: 128 },
];

/** Where the hook catches: just above the last candle's wick. */
const HOOK = { x: 300, y: 70 };

export function HeroArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 440 260" role="img" aria-label="A fishing line hooking the top of a rising candlestick chart" className={className}>
      <style>{`
        .ha-sway { transform-origin: ${HOOK.x}px -40px; animation: ha-sway 6s ease-in-out infinite; }
        .ha-glow { animation: ha-glow 3s ease-in-out infinite; }
        .ha-float { animation: ha-float 7s ease-in-out infinite; }
        .ha-float-slow { animation: ha-float 10s ease-in-out infinite reverse; }
        @keyframes ha-sway { 0%, 100% { transform: rotate(-1.4deg); } 50% { transform: rotate(1.4deg); } }
        @keyframes ha-glow { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.9; } }
        @keyframes ha-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @media (prefers-reduced-motion: reduce) { .ha-sway, .ha-glow, .ha-float, .ha-float-slow { animation: none; } }
      `}</style>
      <defs>
        <radialGradient id="ha-catch" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#f5c97b" stopOpacity="0.55" />
          <stop offset="1" stopColor="#f5c97b" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ha-depth" cx="0.7" cy="0.25" r="0.8">
          <stop offset="0" stopColor="#1d3b4f" stopOpacity="0.55" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ha-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34d399" stopOpacity="0.22" />
          <stop offset="1" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="ha-line" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f5c97b" stopOpacity="0" />
          <stop offset="0.35" stopColor="#f5c97b" stopOpacity="0.7" />
          <stop offset="1" stopColor="#f5c97b" />
        </linearGradient>
        <pattern id="ha-grid" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M26 0H0V26" fill="none" stroke="currentColor" strokeOpacity="0.07" />
        </pattern>
      </defs>

      <rect width="440" height="260" fill="url(#ha-depth)" />
      <rect width="440" height="260" fill="url(#ha-grid)" className="text-app-ink" />

      {/* Water lines drifting behind the chart. */}
      <g fill="none" stroke="#5fb4d9" strokeLinecap="round">
        <path className="ha-float-slow" d="M0 236 C 60 226, 110 246, 170 236 S 290 226, 350 238 S 420 244, 440 236" strokeOpacity="0.18" strokeWidth="1.5" />
        <path className="ha-float" d="M0 250 C 70 242, 130 258, 200 250 S 320 242, 380 252 S 430 256, 440 250" strokeOpacity="0.12" strokeWidth="1.5" />
      </g>

      {/* The trend under the candles. */}
      <path
        d={`M${CANDLES[0].x} ${CANDLES[0].close} ${CANDLES.map((candle) => `L${candle.x} ${candle.close}`).join(" ")} L${CANDLES[CANDLES.length - 1].x} 232 L${CANDLES[0].x} 232 Z`}
        fill="url(#ha-area)"
      />

      <g className="ha-float">
        {CANDLES.map((candle, index) => {
          const up = candle.close < candle.open;
          const color = up ? "#34d399" : "#f87171";
          const top = Math.min(candle.open, candle.close);
          const height = Math.max(4, Math.abs(candle.open - candle.close));
          const last = index === CANDLES.length - 1;
          return (
            <g key={candle.x} opacity={0.55 + (index / CANDLES.length) * 0.45}>
              <line x1={candle.x} x2={candle.x} y1={candle.high} y2={candle.low} stroke={color} strokeWidth="1.5" />
              <rect x={candle.x - 7} y={top} width="14" height={height} rx="2.5" fill={color} stroke={last ? "#f5c97b" : "none"} strokeWidth="1.5" />
            </g>
          );
        })}
      </g>

      {/* The catch: a glow where the hook meets the top candle, and a few sparks. */}
      <circle className="ha-glow" cx={HOOK.x} cy={HOOK.y + 14} r="46" fill="url(#ha-catch)" />
      <g fill="#f5c97b" className="ha-glow">
        <circle cx={HOOK.x + 30} cy={HOOK.y - 6} r="2" />
        <circle cx={HOOK.x - 28} cy={HOOK.y + 2} r="1.5" />
        <circle cx={HOOK.x + 22} cy={HOOK.y + 30} r="1.5" />
      </g>

      {/* Line and hook. */}
      <g className="ha-sway" fill="none" strokeLinecap="round">
        <path d={`M${HOOK.x} -40 L${HOOK.x} ${HOOK.y - 18}`} stroke="url(#ha-line)" strokeWidth="1.5" />
        <circle cx={HOOK.x} cy={HOOK.y - 30} r="5" fill="#f5c97b" stroke="none" />
        <path
          d={`M${HOOK.x} ${HOOK.y - 18} L${HOOK.x} ${HOOK.y + 2} C ${HOOK.x} ${HOOK.y + 16}, ${HOOK.x - 18} ${HOOK.y + 16}, ${HOOK.x - 18} ${HOOK.y + 4} L${HOOK.x - 14} ${HOOK.y}`}
          stroke="#f5c97b"
          strokeWidth="3"
        />
      </g>

      {/* A floating price tag on the catch. */}
      <g className="ha-float-slow">
        <rect x={HOOK.x + 34} y={HOOK.y + 10} width="74" height="26" rx="8" fill="#0b0f14" stroke="#f5c97b" strokeOpacity="0.5" />
        <text x={HOOK.x + 71} y={HOOK.y + 27} textAnchor="middle" fontSize="12" fontWeight="600" fill="#34d399" fontFamily="inherit">
          +12.4%
        </text>
      </g>
    </svg>
  );
}
