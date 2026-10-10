/**
 * Angler's community links (Discord, Telegram, X), from public env vars so they change without a code edit. A link
 * that isn't set is left out everywhere: the sidebar, the account menu, the phone menu, the home page and the gate.
 */

type SocialId = "discord" | "telegram" | "x";

export interface Social {
  id: SocialId;
  label: string;
  /** Text next to the icon: X's logo already says "X", so its button reads "Follow". */
  text: string;
  url: string;
}

// Next.js inlines NEXT_PUBLIC_* only when accessed by their full name.
const URLS: Record<SocialId, string | undefined> = {
  discord: process.env.NEXT_PUBLIC_DISCORD_URL,
  telegram: process.env.NEXT_PUBLIC_TELEGRAM_URL,
  x: process.env.NEXT_PUBLIC_X_URL,
};

const LABELS: Record<SocialId, string> = { discord: "Discord", telegram: "Telegram", x: "X" };
const TEXTS: Record<SocialId, string> = { discord: "Discord", telegram: "Telegram", x: "Follow" };

export const SOCIALS: Social[] = (Object.keys(URLS) as SocialId[]).flatMap((id) => {
  const url = URLS[id]?.trim();
  return url && /^https:\/\//.test(url) ? [{ id, label: LABELS[id], text: TEXTS[id], url }] : [];
});

export const DISCORD = SOCIALS.find((social) => social.id === "discord") ?? null;

/** Brand marks, single-color (currentColor) so they follow the theme like the other nav icons. */
export function SocialIcon({ id, className = "size-4" }: { id: SocialId; className?: string }) {
  if (id === "discord") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
        <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    );
  }
  if (id === "telegram") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
        <path d="M21.94 4.3 18.7 19.59c-.24 1.08-.88 1.35-1.79.84l-4.94-3.64-2.38 2.29c-.26.26-.48.48-.99.48l.35-5.03 9.15-8.27c.4-.35-.09-.55-.62-.2L6.17 13.17 1.3 11.65c-1.06-.33-1.08-1.06.22-1.57L20.6 2.73c.88-.33 1.65.2 1.34 1.57z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** A row of icon links, e.g. at the bottom of the sidebar. Renders nothing when no link is set. */
export function SocialIcons({ className = "", itemClassName = "", iconClassName = "size-4" }: { className?: string; itemClassName?: string; iconClassName?: string }) {
  if (SOCIALS.length === 0) return null;
  return (
    <div className={`flex items-center ${className}`}>
      {SOCIALS.map((social) => (
        <a key={social.id} href={social.url} target="_blank" rel="noopener noreferrer" title={`Angler on ${social.label}`} aria-label={`Angler on ${social.label}`} className={itemClassName}>
          <SocialIcon id={social.id} className={iconClassName} />
        </a>
      ))}
    </div>
  );
}
