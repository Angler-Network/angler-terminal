"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTrading } from "@/components/terminal/trading-provider";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { useWallet } from "@/components/terminal/wallet-provider";
import { useT } from "@/lib/i18n/client";
import { FitLabel } from "./fit-label";
import { LayoutMenu } from "./layout-menu";
import { marketNav } from "./market-nav";
import { SOCIALS, SocialIcon } from "./social-links";
import { BridgeIcon, MarketsIcon, NewsIcon, ProOrderIcon, VaultsIcon, type NavIcon } from "./nav-icons";

function NavLabel({ children }: { children: React.ReactNode }) {
  return (
    <FitLabel
      maxSize={11}
      minSize={10}
      className="[@media(max-height:600px)]:sr-only [@media(max-height:660px)]:[html:not([data-frame=off])_&]:sr-only"
    >
      {children}
    </FitLabel>
  );
}

function navItemClass(active: boolean) {
  return `relative flex flex-col items-center gap-[clamp(0.125rem,0.7vh,0.375rem)] rounded-xl px-1 py-[clamp(0.25rem,1vh,0.625rem)] text-[11px] transition-colors ${
    active
      ? "bg-app-card text-app-ink shadow-[inset_0_0_0_1px_rgb(var(--app-hairline-strong)),0_2px_8px_rgba(19,35,58,0.08)] before:absolute before:-left-1.5 before:top-1/4 before:bottom-1/4 before:w-[3px] before:rounded-r-full before:bg-app-accent"
      : "text-app-muted hover:bg-app-card/60 hover:text-app-ink"
  }`;
}

/** The open page's icon: Solar's bold duotone in gold. */
function iconClass(active: boolean) {
  return `size-[22px] transition-colors ${active ? "text-app-accent" : ""}`;
}

const smallMark = "flex size-6 items-center justify-center rounded-md text-app-faint transition-colors hover:bg-app-card/60 hover:text-app-ink";

function NavButton({ label, icon: Icon, active = false, onClick }: { label: string; icon: NavIcon; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-haspopup="dialog" aria-expanded={active} className={navItemClass(active)}>
      <Icon className={iconClass(active)} active={active} />
      <NavLabel>{label}</NavLabel>
    </button>
  );
}

/**
 * The rail: market views (perp, swap, spot, CEX soon, prediction), markets, vaults, layout, then pro order, bridge
 * and small marks for the news site and the community links. It scrolls when a short screen can't fit it. Wallets, the profile and the
 * portfolio sit in the top bar's account menu.
 */
export function Sidebar() {
  const t = useT();
  const pathname = usePathname();
  const wallets = useWalletModal();
  const { address } = useWallet();
  const { openDeposit, openProOrder, isProOrderOpen } = useTrading();

  return (
    <aside className="app-sidebar surface-chrome hidden w-[76px] shrink-0 flex-col overflow-x-hidden border-r border-app-hairline px-1.5 pb-8 pt-[clamp(0.5rem,2vh,1rem)] scrollbar-none overflow-y-auto lg:flex [html[data-frame=off]_&]:pb-[clamp(0.5rem,2vh,1rem)]">
      <Link href="/" className="mb-[clamp(0.5rem,2.5vh,1.5rem)] flex shrink-0 justify-center" aria-label={t("nav.home")}>
        <Image src="/blacklogo.png" alt="Angler" width={30} height={30} className="[html[data-tone=dark]_&]:hidden" />
        <Image src="/whitelogo.png" alt="" aria-hidden width={30} height={30} priority className="hidden [html[data-tone=dark]_&]:block" />
      </Link>

      <nav aria-label={t("nav.primary")} className="flex flex-col gap-1">
        {marketNav.map(({ href, label, title, icon: Icon, soon, isActive }) => (
          <Link key={href} href={href} title={title} aria-current={isActive(pathname) ? "page" : undefined} className={navItemClass(isActive(pathname))}>
            <span className="relative">
              <Icon className={iconClass(isActive(pathname))} active={isActive(pathname)} />
              {soon && (
                <span className="absolute -right-4 -top-1.5 rounded-[4px] bg-app-accent px-1 py-px text-[8px] font-bold uppercase leading-none tracking-wide text-app-on-accent">
                  Soon
                </span>
              )}
            </span>
            <NavLabel>{label}</NavLabel>
          </Link>
        ))}
        <span aria-hidden className="mx-3 my-1 h-px bg-app-hairline" />
        <Link href="/markets" title="Markets" aria-current={pathname === "/markets" ? "page" : undefined} className={navItemClass(pathname === "/markets")}>
          <MarketsIcon className={iconClass(pathname === "/markets")} active={pathname === "/markets"} />
          <NavLabel>Markets</NavLabel>
        </Link>
        <Link href="/vaults" title="Vaults across the perp venues" aria-current={pathname === "/vaults" ? "page" : undefined} className={navItemClass(pathname === "/vaults")}>
          <VaultsIcon className={iconClass(pathname === "/vaults")} active={pathname === "/vaults"} />
          <NavLabel>Vaults</NavLabel>
        </Link>
        <LayoutMenu className={navItemClass(false)} iconClassName="size-[22px]" labelNode={<NavLabel>Layout</NavLabel>} />
      </nav>

      <nav aria-label={t("nav.secondary")} className="mt-auto flex flex-col gap-1 pt-[clamp(0.5rem,2vh,1rem)]">
        {/* Pro order stands out in yellow: multi and hedge orders across venues. */}
        <button
          type="button"
          onClick={openProOrder}
          title="Pro order: multi and hedge orders across venues"
          aria-haspopup="dialog"
          aria-expanded={isProOrderOpen}
          className={`${navItemClass(false)} text-app-accent hover:text-app-accent ${isProOrderOpen ? "bg-app-accent/15" : "hover:bg-app-accent/10"}`}
        >
          <ProOrderIcon className="size-[22px]" active={isProOrderOpen} />
          <NavLabel>Pro order</NavLabel>
        </button>
        <NavButton label="Bridge" icon={BridgeIcon} onClick={() => (address ? openDeposit("lighter", "move") : wallets.open())} />
        <span aria-hidden className="mx-3 my-1 h-px bg-app-hairline" />
        {/* The news site and the community links as small marks, two a row in the rail's width. */}
        <div className="flex flex-wrap justify-center gap-0.5">
          <a href="https://news.angler.network" target="_blank" rel="noopener noreferrer" title="Angler News" aria-label="Angler News" className={smallMark}>
            <NewsIcon className="size-3.5" />
          </a>
          {SOCIALS.map((social) => (
            <a key={social.id} href={social.url} target="_blank" rel="noopener noreferrer" title={`Angler on ${social.label}`} aria-label={`Angler on ${social.label}`} className={smallMark}>
              <SocialIcon id={social.id} className="size-3.5" />
            </a>
          ))}
        </div>
      </nav>
    </aside>
  );
}
