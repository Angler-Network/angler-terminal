"use client";

import { ArrowLeftRight, BarChart3, ChartPie, Layers, Newspaper, Settings, type LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { openBridge } from "@/components/terminal/bridge-shortcut";
import { useTrading } from "@/components/terminal/trading-provider";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { useWallet } from "@/components/terminal/wallet-provider";
import { useT } from "@/lib/i18n/client";
import { FitLabel } from "./fit-label";
import { LayoutMenu } from "./layout-menu";
import { marketNav } from "./market-nav";

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
  return `flex flex-col items-center gap-[clamp(0.125rem,0.7vh,0.375rem)] rounded-xl px-1 py-[clamp(0.25rem,1vh,0.625rem)] text-[11px] transition-colors ${
    active ? "bg-app-card text-app-ink shadow-[0_2px_8px_rgba(19,35,58,0.08)]" : "text-app-muted hover:bg-app-card/60 hover:text-app-ink"
  }`;
}

function NavButton({ label, icon: Icon, active = false, onClick }: { label: string; icon: LucideIcon; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-haspopup="dialog" aria-expanded={active} className={navItemClass(active)}>
      <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      <NavLabel>{label}</NavLabel>
    </button>
  );
}

/** The rail: market views (perp, spot, prediction), markets, portfolio, the news site and settings (wallets and the
 * profile sit in the top bar). */
export function Sidebar() {
  const t = useT();
  const pathname = usePathname();
  const isSettingsOpen = pathname.startsWith("/settings");
  const wallets = useWalletModal();
  const { address } = useWallet();
  const { openProOrder, isProOrderOpen } = useTrading();
  const router = useRouter();

  return (
    <aside className="app-sidebar surface-chrome hidden w-[76px] shrink-0 flex-col overflow-hidden border-r border-app-hairline px-1.5 pb-8 pt-[clamp(0.5rem,2vh,1rem)] lg:flex [html[data-frame=off]_&]:pb-[clamp(0.5rem,2vh,1rem)]">
      <Link href="/perp" className="mb-[clamp(0.5rem,2.5vh,1.5rem)] flex shrink-0 justify-center" aria-label={t("nav.home")}>
        <Image src="/blacklogo.png" alt="Angler" width={30} height={30} className="[html[data-tone=dark]_&]:hidden" />
        <Image src="/whitelogo.png" alt="" aria-hidden width={30} height={30} priority className="hidden [html[data-tone=dark]_&]:block" />
      </Link>

      <nav aria-label={t("nav.primary")} className="flex flex-col gap-1">
        {marketNav.map(({ href, label, title, icon: Icon, soon, isActive }) => (
          <Link key={href} href={href} title={title} aria-current={isActive(pathname) ? "page" : undefined} className={navItemClass(isActive(pathname))}>
            <span className="relative">
              <Icon className="size-5" strokeWidth={1.75} aria-hidden />
              {soon && <span aria-hidden className="absolute -right-1 -top-0.5 size-1.5 rounded-full bg-[#f5c97b]" />}
            </span>
            <NavLabel>{label}</NavLabel>
          </Link>
        ))}
        <span aria-hidden className="mx-3 my-1 h-px bg-app-hairline" />
        <Link href="/markets" title="Markets" aria-current={pathname === "/markets" ? "page" : undefined} className={navItemClass(pathname === "/markets")}>
          <BarChart3 className="size-5" strokeWidth={1.75} aria-hidden />
          <NavLabel>Markets</NavLabel>
        </Link>
        <Link href="/profile/portfolio" title="Portfolio" aria-current={pathname === "/profile/portfolio" ? "page" : undefined} className={navItemClass(pathname === "/profile/portfolio")}>
          <ChartPie className="size-5" strokeWidth={1.75} aria-hidden />
          <NavLabel>Portfolio</NavLabel>
        </Link>
        <LayoutMenu className={navItemClass(false)} labelNode={<NavLabel>Layout</NavLabel>} />
        <a href="https://news.angler.network" target="_blank" rel="noopener noreferrer" title="Angler News" className={navItemClass(false)}>
          <Newspaper className="size-5" strokeWidth={1.75} aria-hidden />
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
          <Layers className="size-5" strokeWidth={1.75} aria-hidden />
          <NavLabel>Pro order</NavLabel>
        </button>
        <NavButton label="Bridge" icon={ArrowLeftRight} onClick={() => openBridge(router.push)} />
        <Link href="/settings" title={t("nav.settings")} aria-current={isSettingsOpen ? "page" : undefined} className={navItemClass(isSettingsOpen)}>
          <Settings className="size-5" strokeWidth={1.75} aria-hidden />
          <NavLabel>{t("nav.settings")}</NavLabel>
        </Link>
      </nav>
    </aside>
  );
}
