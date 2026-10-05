import type { Metadata, Viewport } from "next";
import { Sora } from "next/font/google";
import { PreferencesProvider } from "@/components/app/preferences-provider";
import { TickerBar } from "@/components/app/ticker-bar";
import { SelectedAssetProvider } from "@/components/terminal/selected-asset";
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
  themeColor: "#030c15",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-US" className={sora.variable} data-theme="deepnavy" data-tone="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferencesScript }} />
      </head>
      <body className="app-frame h-dvh overflow-hidden font-sans antialiased">
        <I18nProvider>
          <PreferencesProvider>
            <SelectedAssetProvider>
              <div className="app-shell relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-app-shell-top to-app-shell-bottom text-app-ink">
                <TickerBar />
                <main className="min-h-0 flex-1 p-2">{children}</main>
              </div>
            </SelectedAssetProvider>
          </PreferencesProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
