import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { preconnect, preload } from "react-dom";
import { AlphaNotice } from "@/components/app/alpha-notice";
import { PreferencesProvider } from "@/components/app/preferences-provider";
import { LazyDialogs } from "@/components/app/lazy-dialogs";
import { LayoutRevealButtons } from "@/components/app/layout-toggles";
import { Sidebar } from "@/components/app/sidebar";
import { AppFrame } from "@/components/app/app-frame";
import { ServerTape } from "@/components/app/ticker-bar";
import { ToastProvider } from "@/components/app/toast-provider";
import { UpdateNotice } from "@/components/app/update-notice";
import { SelectedAssetProvider } from "@/components/terminal/selected-asset";
import { TradeTicketProvider } from "@/components/terminal/trade-ticket";
import { ProfileProvider } from "@/components/profile/profile-provider";
import { ReferralInvite } from "@/components/profile/referral-invite";
import { TradingProvider } from "@/components/terminal/trading-provider";
import { SolanaWalletProvider } from "@/components/terminal/solana-wallet-provider";
import { WalletModalProvider } from "@/components/terminal/wallet-modal";
import { WalletProvider } from "@/components/terminal/wallet-provider";
import { I18nProvider } from "@/lib/i18n/client";
import { CHART_COOKIE, parseChartCookie } from "@/lib/markets/model";
import { onboardingScript, openOnboardingScript } from "@/lib/onboarding";
import { preferencesScript } from "@/lib/preferences";
import { isIndexable, siteUrl } from "@/lib/site";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import "./globals.css";

const title = "Angler Terminal";
const description =
  "Trade Hyperliquid and Lighter perps, Solana tokens and tokenized stocks from one screen, with AI-scored crypto news you can trade in two taps.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { template: "%s · Angler Terminal", default: title },
  description,
  applicationName: title,
  // Both sites are indexed (`isIndexable`), each with its own canonical origin; dev builds stay out of search results.
  robots: isIndexable() ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: { type: "website", siteName: title, title, description },
  twitter: { card: "summary_large_image", title, description },
  icons: { icon: "/logo.png", shortcut: "/logo.png", apple: "/logo.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the bottom tab bar sit above the home indicator (env(safe-area-inset-bottom)).
  viewportFit: "cover",
  themeColor: "#000000",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The first screen loads coin icons and Hyperliquid candles/books before anything else from these hosts.
  preconnect("https://app.hyperliquid.xyz");
  preconnect(hlConfig.apiUrl, { crossOrigin: "anonymous" });
  // Sent with the HTML (as a Link header), so the text font loads in parallel with the CSS instead of after it.
  preload("/fonts/sora-latin.3dc379dc.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  const chart = parseChartCookie((await cookies()).get(CHART_COOKIE)?.value);
  return (
    <html lang="en-US" data-theme="oled" data-surface="liquid" data-tone="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferencesScript }} />
        <script dangerouslySetInnerHTML={{ __html: onboardingScript }} />
      </head>
      <body className="app-frame h-dvh overflow-hidden font-sans antialiased">
        <I18nProvider>
          <PreferencesProvider initial={chart ? { chartSymbol: chart.symbol, chartMarket: chart.market, tapeSource: chart.source } : undefined}>
            <ToastProvider>
              <WalletProvider>
              <SolanaWalletProvider>
                <SelectedAssetProvider>
                  <TradingProvider>
                  <WalletModalProvider>
                  <TradeTicketProvider>
                  <ProfileProvider>
                    <div className="app-shell relative flex h-full overflow-hidden bg-linear-to-b from-app-shell-top to-app-shell-bottom text-app-ink">
                      <LayoutRevealButtons />
                      <Sidebar />
                      <AppFrame tape={<ServerTape />}>{children}</AppFrame>
                    </div>
                    <LazyDialogs />
                    <AlphaNotice />
                    <script dangerouslySetInnerHTML={{ __html: openOnboardingScript }} />
                    <UpdateNotice />
                    <ReferralInvite />
                  </ProfileProvider>
                  </TradeTicketProvider>
                  </WalletModalProvider>
                  </TradingProvider>
                </SelectedAssetProvider>
              </SolanaWalletProvider>
              </WalletProvider>
            </ToastProvider>
          </PreferencesProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
