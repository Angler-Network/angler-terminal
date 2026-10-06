"use client";

import { ArrowLeftRight, BarChart3, CandlestickChart, ChartPie, Layers, Newspaper, Settings, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTrading } from "@/components/terminal/trading-provider";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { useWallet } from "@/components/terminal/wallet-provider";
import { LayoutMenu } from "./layout-menu";
import { usePreferences } from "./preferences-provider";

function itemClass(active: boolean) {
  return `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium transition-colors ${
    active ? "bg-app-card text-app-ink shadow-[0_2px_8px_rgba(19,35,58,0.08)]" : "text-app-muted hover:bg-app-card/60 hover:text-app-ink"
  }`;
}

const label = "hidden xl:inline";

/** The sidebar's navigation laid out in the top bar (`navMode: "top"`); shown by CSS when html[data-nav=top]. */
export function TopNav() {
  const pathname = usePathname();
  const { isSettingsOpen, openSettings } = usePreferences();
  const wallets = useWalletModal();
  const { address } = useWallet();
  const { openDeposit, openProOrder } = useTrading();
  return (
    <nav aria-label="Primary" className="app-topnav shrink-0 items-center gap-0.5">
      <Link href="/" title="Terminal" aria-current={pathname === "/" ? "page" : undefined} className={itemClass(pathname === "/")}>
        <CandlestickChart className="size-[18px]" strokeWidth={1.75} aria-hidden />
        <span className={label}>Terminal</span>
      </Link>
      <Link href="/markets" title="Markets" aria-current={pathname === "/markets" ? "page" : undefined} className={itemClass(pathname === "/markets")}>
        <BarChart3 className="size-[18px]" strokeWidth={1.75} aria-hidden />
        <span className={label}>Markets</span>
      </Link>
      <Link href="/portfolio" title="Portfolio" aria-current={pathname === "/portfolio" ? "page" : undefined} className={itemClass(pathname === "/portfolio")}>
        <ChartPie className="size-[18px]" strokeWidth={1.75} aria-hidden />
        <span className={label}>Portfolio</span>
      </Link>
      <LayoutMenu placement="below" className={itemClass(false)} iconClassName="size-[18px]" labelNode={<span className={label}>Layout</span>} />
      <a href="https://news.angler.network" target="_blank" rel="noopener noreferrer" title="Angler News" className={itemClass(false)}>
        <Newspaper className="size-[18px]" strokeWidth={1.75} aria-hidden />
        <span className={label}>News</span>
      </a>
      <button
        type="button"
        title="Pro order: multi and hedge orders across venues"
        onClick={openProOrder}
        className={`${itemClass(false)} text-[#f5c97b] hover:bg-[#f5c97b]/10 hover:text-[#f5c97b]`}
      >
        <Layers className="size-[18px]" strokeWidth={1.75} aria-hidden />
        <span className={label}>Pro order</span>
      </button>
      <button type="button" title="Bridge" onClick={() => (address ? openDeposit("lighter", "move") : wallets.open())} className={itemClass(false)}>
        <ArrowLeftRight className="size-[18px]" strokeWidth={1.75} aria-hidden />
        <span className={label}>Bridge</span>
      </button>
      <button type="button" title="Wallets" onClick={wallets.open} className={itemClass(wallets.isOpen)}>
        <Wallet className="size-[18px]" strokeWidth={1.75} aria-hidden />
        <span className={label}>Wallets</span>
      </button>
      <button type="button" title="Settings" onClick={() => openSettings()} className={itemClass(isSettingsOpen)}>
        <Settings className="size-[18px]" strokeWidth={1.75} aria-hidden />
        <span className={label}>Settings</span>
      </button>
    </nav>
  );
}
