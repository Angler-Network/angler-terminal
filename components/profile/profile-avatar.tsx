import { avatarSpec } from "@/lib/profile/avatar";

/**
 * A soft "aura" avatar drawn from the wallet address (`avatarSpec`): blurred blobs from a curated palette, so every
 * profile has a stable, distinct face without uploads.
 */
export function ProfileAvatar({ id, size = 28, className = "" }: { id: string; size?: number; className?: string }) {
  const spec = avatarSpec(id);
  // Same address, same art: avatars that repeat on a page can share their defs.
  const key = `pa-${id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-16)}`;
  return (
    <svg
      aria-hidden
      viewBox="0 0 80 80"
      width={size}
      height={size}
      className={`inline-block shrink-0 rounded-full ring-1 ring-app-hairline-strong ${className}`}
    >
      <defs>
        <clipPath id={`${key}-clip`}>
          <circle cx="40" cy="40" r="40" />
        </clipPath>
        <filter id={`${key}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <g clipPath={`url(#${key}-clip)`}>
        <rect width="80" height="80" fill={spec.background} />
        <g filter={`url(#${key}-blur)`} transform={`rotate(${spec.rotation} 40 40)`}>
          {spec.blobs.map((blob, index) => (
            <circle key={index} cx={blob.cx} cy={blob.cy} r={blob.r} fill={blob.color} opacity={0.9} />
          ))}
        </g>
      </g>
    </svg>
  );
}
