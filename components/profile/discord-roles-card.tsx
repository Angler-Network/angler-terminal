"use client";

import { useEffect, useState } from "react";
import { SocialIcon } from "@/components/app/social-links";
import { vipFor } from "@/lib/profile/vip";
import { useProfile } from "./profile-provider";

const card = "rounded-2xl border border-app-hairline bg-app-card/60";

/** What `/api/discord/callback` reports back in `?discord=` after Discord's consent page. */
const LINK_RESULTS: Record<string, { tone: "ok" | "error"; text: string }> = {
  linked: { tone: "ok", text: "Discord connected. Claim your roles below." },
  taken: { tone: "error", text: "That Discord account is linked to another wallet. Unlink it there first." },
  expired: { tone: "error", text: "That link expired. Press Connect Discord again." },
  cancelled: { tone: "error", text: "Discord wasn't connected." },
  failed: { tone: "error", text: "Discord didn't answer. Try again in a minute." },
  signin: { tone: "error", text: "Sign in with your wallet first, then connect Discord." },
  off: { tone: "error", text: "Discord roles aren't set up on this site yet." },
};

/**
 * Discord roles for the level and VIP tier, opt-in: connect the Discord account once (Discord's own consent page,
 * identify only), then "Claim roles" asks the bot for the current ones (it also takes back the ones moved past). Hidden
 * when the site has no Discord bot set up (`lib/discord/roles.ts`).
 */
export function DiscordRolesCard() {
  const { profile, signIn, refresh } = useProfile();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<"signin" | "claim" | "unlink" | null>(null);

  // Back from Discord: say how it went, then drop the parameter so a reload doesn't repeat it.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("discord");
    if (!result) return;
    setMessage(LINK_RESULTS[result] ?? null);
    url.searchParams.delete("discord");
    window.history.replaceState(null, "", url.toString());
    if (result === "linked") refresh();
  }, [refresh]);

  if (!profile?.discord.enabled) return null;
  // Invites reach only the signed-in owner, so they double as "this browser is signed in to this profile".
  const signedIn = profile.invites !== null;
  const linked = profile.discord.name;
  const vip = vipFor(profile.recentVolume.d30).level;

  const run = async (kind: "claim" | "unlink") => {
    setBusy(kind);
    setMessage(null);
    const response = await fetch(kind === "claim" ? "/api/discord/roles" : "/api/discord/link", { method: kind === "claim" ? "POST" : "DELETE" }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: string; level?: string; vip?: number; added?: number; removed?: number } | null;
    if (!response?.ok) setMessage({ tone: "error", text: body?.error ?? "Couldn't reach the server." });
    else if (kind === "unlink") {
      setMessage({ tone: "ok", text: "Discord unlinked and its Angler roles taken back." });
      refresh();
    } else {
      const changed = (body?.added ?? 0) + (body?.removed ?? 0);
      setMessage({ tone: "ok", text: changed ? `Roles updated: ${body?.level}${body?.vip ? ` and VIP ${body.vip}` : ""}.` : "Your roles are already up to date." });
    }
    setBusy(null);
  };

  return (
    <section id="discord" className={`${card} flex scroll-mt-4 flex-wrap items-center gap-x-4 gap-y-2 p-4`}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#5865F2]/15 text-[#8b93ff]">
        <SocialIcon id="discord" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[13px] font-semibold text-app-ink">Discord roles</h2>
        <p className="mt-0.5 text-[12px] text-app-muted">
          Optional: a role on our Discord for your level (<span className="text-app-ink">{profile.level.name}</span>)
          {vip > 0 ? (
            <>
              {" "}
              and VIP tier (<span className="text-app-ink">VIP {vip}</span>)
            </>
          ) : (
            " and, from VIP 1, your VIP tier"
          )}
          . Claim again after you level up.
          {linked && <span className="text-app-faint"> Connected as {linked}.</span>}
        </p>
        {message && <p className={`mt-1 text-[12px] ${message.tone === "ok" ? "text-app-up" : "text-app-down"}`}>{message.text}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!signedIn ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("signin");
              const error = await signIn();
              if (error) setMessage({ tone: "error", text: error });
              setBusy(null);
            }}
            className="h-9 rounded-xl border border-app-hairline-strong px-3.5 text-[13px] font-semibold text-app-ink hover:bg-app-selected/70 disabled:opacity-60"
          >
            {busy === "signin" ? "Sign in your wallet…" : "Sign in to connect"}
          </button>
        ) : !linked ? (
          // A plain link: the route sends the browser to Discord's consent page and back.
          <a href="/api/discord/link" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5865F2] px-3.5 text-[13px] font-semibold text-white hover:opacity-90">
            Connect Discord
          </a>
        ) : (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("claim")}
              className="h-9 rounded-xl bg-[#5865F2] px-3.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy === "claim" ? "Asking the bot…" : "Claim roles"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("unlink")}
              className="h-9 rounded-xl border border-app-hairline-strong px-3 text-[12px] font-semibold text-app-muted hover:text-app-ink disabled:opacity-60"
            >
              {busy === "unlink" ? "Unlinking…" : "Unlink"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
