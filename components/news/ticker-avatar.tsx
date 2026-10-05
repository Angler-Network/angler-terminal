import { assets } from "@/lib/data";

interface TickerAvatarProps {
  symbol: string;
  size?: number;
}

export function TickerAvatar({ symbol, size = 36 }: TickerAvatarProps) {
  const asset = assets[symbol];

  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
        backgroundColor: asset?.color ?? "#657387",
      }}
    >
      {asset?.glyph ?? symbol.charAt(0)}
    </span>
  );
}
