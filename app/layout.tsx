import type { Metadata, Viewport } from "next";
import { Sora } from "next/font/google";
import { AlphaNotice } from "@/components/app/alpha-notice";
import { PreferencesProvider } from "@/components/app/preferences-provider";
import { LazyDialogs } from "@/components/app/lazy-dialogs";
import { Sidebar } from "@/components/app/sidebar";
import { TickerBar } from "@/components/app/ticker-bar";
import { ToastProvider } from "@/components/app/toast-provider";
import { UpdateNotice } from "@/components/app/update-notice";
import { SelectedAssetProvider } from "@/components/terminal/selected-asset";
import { TradeTicketProvider } from "@/components/terminal/trade-ticket";
import { TradingProvider } from "@/components/terminal/trading-provider";
import { SolanaWalletProvider } from "@/components/terminal/solana-wallet-provider";
import { WalletModalProvider } from "@/components/terminal/wallet-modal";
import { WalletProvider } from "@/components/terminal/wallet-provider";
import { I18nProvider } from "@/lib/i18n/client";
import { preferencesScript } from "@/lib/preferences";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sora",
  display: "swap",
});

const title = "Angler Terminal";
const description = "News-driven trading terminal: live Angler news next to the chart and the order ticket.";

export const metadata: Metadata = {
  title: { template: "%s · Angler", default: title },
  description,
  applicationName: title,
  robots: { index: false, follow: false },
  icons: { icon: "/logo.png", shortcut: "/logo.png", apple: "/logo.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-US" className={sora.variable} data-theme="oled" data-surface="liquid" data-tone="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferencesScript }} />
      </head>
      <body className="app-frame h-dvh overflow-hidden font-sans antialiased">
        <I18nProvider>
          <PreferencesProvider>
            <ToastProvider>
              <WalletProvider>
              <SolanaWalletProvider>
                <SelectedAssetProvider>
                  <TradingProvider>
                  <WalletModalProvider>
                  <TradeTicketProvider>
                    <div className="app-shell relative flex h-full overflow-hidden bg-gradient-to-b from-app-shell-top to-app-shell-bottom text-app-ink">
                      <Sidebar />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <TickerBar />
                        <main className="min-h-0 flex-1 p-2">{children}</main>
                      </div>
                    </div>
                    <LazyDialogs />
                    <AlphaNotice />
                    <UpdateNotice />
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
