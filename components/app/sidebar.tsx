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
import { BridgeIcon, MarketsIcon, NewsIcon, ProOrderIcon, SettingsIcon, type NavIcon } from "./nav-icons";

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
      ? "bg-app-card text-app-ink shadow-[inset_0_0_0_1px_rgb(var(--app-hairline-strong)),0_2px_8px_rgba(19,35,58,0.08)] before:absolute before:-left-1.5 before:top-1/4 before:bottom-1/4 before:w-[3px] before:rounded-r-full before:bg-[#f5c97b]"
      : "text-app-muted hover:bg-app-card/60 hover:text-app-ink"
  }`;
}

/** The open page's icon: Solar's bold duotone in gold. */
function iconClass(active: boolean) {
  return `size-[22px] transition-colors ${active ? "text-[#f5c97b]" : ""}`;
}

function NavButton({ label, icon: Icon, active = false, onClick }: { label: string; icon: NavIcon; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-haspopup="dialog" aria-expanded={active} className={navItemClass(active)}>
      <Icon className={iconClass(active)} active={active} />
      <NavLabel>{label}</NavLabel>
    </button>
  );
}

/**
 * The rail: market views (perp, swap, prediction), markets, the news site and settings. Wallets, the profile and the
 * portfolio sit in the top bar's account menu.
 */
export function Sidebar() {
  const t = useT();
  const pathname = usePathname();
  const isSettingsOpen = pathname.startsWith("/settings");
  const wallets = useWalletModal();
  const { address } = useWallet();
  const { openDeposit, openProOrder, isProOrderOpen } = useTrading();

  return (
    <aside className="app-sidebar surface-chrome hidden w-[76px] shrink-0 flex-col overflow-hidden border-r border-app-hairline px-1.5 pb-8 pt-[clamp(0.5rem,2vh,1rem)] lg:flex [html[data-frame=off]_&]:pb-[clamp(0.5rem,2vh,1rem)]">
      <Link href="/" className="mb-[clamp(0.5rem,2.5vh,1.5rem)] flex shrink-0 justify-center" aria-label={t("nav.home")}>
        <Image src="/blacklogo.png" alt="Angler" width={30} height={30} className="[html[data-tone=dark]_&]:hidden" />
        <Image src="/whitelogo.png" alt="" aria-hidden width={30} height={30} priority className="hidden [html[data-tone=dark]_&]:block" />
      </Link>

      <nav aria-label={t("nav.primary")} className="flex flex-col gap-1">
        {marketNav.map(({ href, label, title, icon: Icon, soon, isActive }) => (
          <Link key={href} href={href} title={title} aria-current={isActive(pathname) ? "page" : undefined} className={navItemClass(isActive(pathname))}>
            <span className="relative">
              <Icon className={iconClass(isActive(pathname))} active={isActive(pathname)} />
              {soon && <span aria-hidden className="absolute -right-1 -top-0.5 size-1.5 rounded-full bg-[#f5c97b]" />}
            </span>
            <NavLabel>{label}</NavLabel>
          </Link>
        ))}
        <span aria-hidden className="mx-3 my-1 h-px bg-app-hairline" />
        <Link href="/markets" title="Markets" aria-current={pathname === "/markets" ? "page" : undefined} className={navItemClass(pathname === "/markets")}>
          <MarketsIcon className={iconClass(pathname === "/markets")} active={pathname === "/markets"} />
          <NavLabel>Markets</NavLabel>
        </Link>
        <LayoutMenu className={navItemClass(false)} iconClassName="size-[22px]" labelNode={<NavLabel>Layout</NavLabel>} />
        <a href="https://news.angler.network" target="_blank" rel="noopener noreferrer" title="Angler News" className={navItemClass(false)}>
          <NewsIcon className={iconClass(false)} />
          <NavLabel>News</NavLabel>
        </a>
      </nav>

      <nav aria-label={t("nav.secondary")} className="mt-auto flex flex-col gap-1 pt-[clamp(0.5rem,2vh,1rem)]">
        {/* Pro order stands out in yellow: multi and hedge orders across venues. */}
        <button
          type="button"
          onClick={openProOrder}
          title="Pro order: multi and hedge orders across venues"
          aria-haspopup="dialog"
          aria-expanded={isProOrderOpen}
          className={`${navItemClass(false)} text-[#f5c97b] hover:text-[#f5c97b] ${isProOrderOpen ? "bg-[#f5c97b]/15" : "hover:bg-[#f5c97b]/10"}`}
        >
          <ProOrderIcon className="size-[22px]" active={isProOrderOpen} />
          <NavLabel>Pro order</NavLabel>
        </button>
        <NavButton label="Bridge" icon={BridgeIcon} onClick={() => (address ? openDeposit("lighter", "move") : wallets.open())} />
        <Link href="/settings" title={t("nav.settings")} aria-current={isSettingsOpen ? "page" : undefined} className={navItemClass(isSettingsOpen)}>
          <SettingsIcon className={iconClass(isSettingsOpen)} active={isSettingsOpen} />
          <NavLabel>{t("nav.settings")}</NavLabel>
        </Link>
      </nav>
    </aside>
  );
}
