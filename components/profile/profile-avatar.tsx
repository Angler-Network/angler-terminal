/** A gradient avatar drawn from the wallet address, so every profile has a stable face without uploads. */
export function ProfileAvatar({ id, size = 28, className = "" }: { id: string; size?: number; className?: string }) {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  const hue = Math.abs(hash) % 360;
  const second = (hue + 40 + (Math.abs(hash >> 8) % 100)) % 360;
  const angle = Math.abs(hash >> 4) % 360;
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ring-1 ring-app-hairline-strong ${className}`}
      style={{ width: size, height: size, background: `linear-gradient(${angle}deg, hsl(${hue} 75% 58%), hsl(${second} 70% 42%))` }}
    />
  );
}
