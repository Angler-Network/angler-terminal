"use client";

import { BarChart3, BriefcaseBusiness, CandlestickChart, ChartPie, ExternalLink, Menu, Newspaper, Settings, SquarePen, Wallet, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { useMobileView, type MobileView } from "./mobile-view";
import { usePreferences } from "./preferences-provider";

const tabs: Array<{ view: MobileView; label: string; icon: LucideIcon }> = [
  { view: "chart", label: "Chart", icon: CandlestickChart },
  { view: "trade", label: "Trade", icon: SquarePen },
  { view: "news", label: "News", icon: Newspaper },
  { view: "portfolio", label: "Portfolio", icon: BriefcaseBusiness },
];

const tabClass = (active: boolean) =>
  `flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${active ? "text-app-ink" : "text-app-muted"}`;

const sheetItem = "flex h-12 items-center gap-3 rounded-xl px-3 text-[15px] text-app-ink hover:bg-app-chip";

/**
 * Bottom tab bar on phones and tablets: the terminal's four views, plus a menu with Markets, Wallets, Settings and
 * the news site (the rail's items). Hidden from `lg` up, where the rail and the full grid take over.
 */
export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { view, setView } = useMobileView();
  const { openSettings } = usePreferences();
  const wallets = useWalletModal();
  const [menuOpen, setMenuOpen] = useState(false);
  const onTerminal = pathname === "/";

  useEffect(() => setMenuOpen(false), [pathname]);

  const show = (next: MobileView) => {
    setView(next);
    if (!onTerminal) router.push("/");
  };

  return (
    <>
      <nav
        aria-label="Primary"
        className="surface-chrome flex h-[calc(3.5rem+env(safe-area-inset-bottom))] shrink-0 items-stretch border-t border-app-hairline pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {tabs.map(({ view: tab, label, icon: Icon }) => {
          const active = onTerminal && view === tab;
          return (
            <button key={tab} type="button" aria-current={active ? "page" : undefined} onClick={() => show(tab)} className={tabClass(active)}>
              <Icon className={`size-5 ${active ? "text-app-accent" : ""}`} strokeWidth={1.75} aria-hidden />
              {label}
            </button>
          );
        })}
        <button type="button" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} className={tabClass(!onTerminal || menuOpen)}>
          <Menu className="size-5" strokeWidth={1.75} aria-hidden />
          More
        </button>
      </nav>
      {menuOpen && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/50 lg:hidden" role="presentation" onClick={() => setMenuOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            onClick={(event) => event.stopPropagation()}
            className="surface-menu w-full rounded-t-3xl border border-b-0 border-app-hairline-strong bg-app-dialog p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          >
            <div className="flex items-center justify-between px-3 pb-2 pt-1">
              <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-app-muted">Menu</span>
              <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className="rounded-lg p-1.5 text-app-faint hover:text-app-ink">
                <X className="size-5" />
              </button>
            </div>
            <Link href="/markets" className={`${sheetItem} ${pathname === "/markets" ? "bg-app-chip" : ""}`}>
              <BarChart3 className="size-5 text-app-muted" strokeWidth={1.75} aria-hidden />
              Markets & funding
            </Link>
            <Link href="/portfolio" className={`${sheetItem} ${pathname === "/portfolio" ? "bg-app-chip" : ""}`}>
              <ChartPie className="size-5 text-app-muted" strokeWidth={1.75} aria-hidden />
              Full portfolio
            </Link>
            <button
              type="button"
              className={`${sheetItem} w-full`}
              onClick={() => {
                setMenuOpen(false);
                wallets.open();
              }}
            >
              <Wallet className="size-5 text-app-muted" strokeWidth={1.75} aria-hidden />
              Wallets
            </button>
            <button
              type="button"
              className={`${sheetItem} w-full`}
              onClick={() => {
                setMenuOpen(false);
                openSettings();
              }}
            >
              <Settings className="size-5 text-app-muted" strokeWidth={1.75} aria-hidden />
              Settings
            </button>
            <a href="https://news.angler.network" target="_blank" rel="noopener noreferrer" className={sheetItem}>
              <Newspaper className="size-5 text-app-muted" strokeWidth={1.75} aria-hidden />
              Angler News
              <ExternalLink className="ml-auto size-4 text-app-faint" aria-hidden />
            </a>
          </div>
        </div>
      )}
    </>
  );
}
