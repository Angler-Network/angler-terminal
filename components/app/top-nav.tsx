"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTrading } from "@/components/terminal/trading-provider";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { useWallet } from "@/components/terminal/wallet-provider";
import { LayoutMenu } from "./layout-menu";
import { marketNav } from "./market-nav";
import { BridgeIcon, MarketsIcon, NewsIcon, ProOrderIcon, SettingsIcon } from "./nav-icons";

function itemClass(active: boolean) {
  return `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium transition-colors ${
    active ? "bg-app-card text-app-ink shadow-[0_2px_8px_rgba(19,35,58,0.08)]" : "text-app-muted hover:bg-app-card/60 hover:text-app-ink"
  }`;
}

const label = "hidden xl:inline";

/** The sidebar's navigation laid out in the top bar (`navMode: "top"`); shown by CSS when html[data-nav=top]. */
export function TopNav() {
  const pathname = usePathname();
  const isSettingsOpen = pathname.startsWith("/settings");
  const wallets = useWalletModal();
  const { address } = useWallet();
  const { openDeposit, openProOrder } = useTrading();
  return (
    <nav aria-label="Primary" className="app-topnav shrink-0 items-center gap-0.5">
      {marketNav.map(({ href, label: text, title, icon: Icon, soon, isActive }) => (
        <Link key={href} href={href} title={title} aria-current={isActive(pathname) ? "page" : undefined} className={itemClass(isActive(pathname))}>
          <Icon className={`size-[18px] ${isActive(pathname) ? "text-[#f5c97b]" : ""}`} active={isActive(pathname)} />
          <span className={label}>{text}</span>
          {soon && <span className="hidden rounded bg-[#f5c97b]/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-[#f5c97b] xl:inline">Soon</span>}
        </Link>
      ))}
      <span aria-hidden className="mx-1 h-5 w-px bg-app-hairline" />
      <Link href="/markets" title="Markets" aria-current={pathname === "/markets" ? "page" : undefined} className={itemClass(pathname === "/markets")}>
        <MarketsIcon className={`size-[18px] ${pathname === "/markets" ? "text-[#f5c97b]" : ""}`} active={pathname === "/markets"} />
        <span className={label}>Markets</span>
      </Link>
      <LayoutMenu placement="below" className={itemClass(false)} iconClassName="size-[18px]" labelNode={<span className={label}>Layout</span>} />
      <a href="https://news.angler.network" target="_blank" rel="noopener noreferrer" title="Angler News" className={itemClass(false)}>
        <NewsIcon className="size-[18px]" />
        <span className={label}>News</span>
      </a>
      <button
        type="button"
        title="Pro order: multi and hedge orders across venues"
        onClick={openProOrder}
        className={`${itemClass(false)} text-[#f5c97b] hover:bg-[#f5c97b]/10 hover:text-[#f5c97b]`}
      >
        <ProOrderIcon className="size-[18px]" />
        <span className={label}>Pro order</span>
      </button>
      <button type="button" title="Bridge" onClick={() => (address ? openDeposit("lighter", "move") : wallets.open())} className={itemClass(false)}>
        <BridgeIcon className="size-[18px]" />
        <span className={label}>Bridge</span>
      </button>
      <Link href="/settings" title="Settings" aria-current={isSettingsOpen ? "page" : undefined} className={itemClass(isSettingsOpen)}>
        <SettingsIcon className={`size-[18px] ${isSettingsOpen ? "text-[#f5c97b]" : ""}`} active={isSettingsOpen} />
        <span className={label}>Settings</span>
      </Link>
    </nav>
  );
}
