/**
 * Navigation icons from Solar by 480 Design (https://www.figma.com/community/file/1166831539721848736), licensed
 * CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Each has a linear look and, for the page that's open, the
 * bold duotone one. Their paths live in the sprite `nav-icon-sprite.tsx` puts in the HTML (root layout); these draw
 * from it with `<use>`, so they render with the HTML and add almost nothing to the JavaScript.
 */

export interface NavIconProps {
  className?: string;
  /** The open page: bold duotone instead of linear. */
  active?: boolean;
  /** Accepted for drop-in use where lucide icons were; Solar draws its own weights. */
  strokeWidth?: number;
  "aria-hidden"?: boolean;
}

export type NavIcon = (props: NavIconProps) => React.JSX.Element;

function solar(id: string): NavIcon {
  return function SolarIcon({ className, active = false }: NavIconProps) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden className={className}>
        <use href={`#ni-${id}${active ? "-on" : ""}`} />
      </svg>
    );
  };
}

/** Perp Dex (solar:graph-new-up). */
export const PerpDexIcon = solar("perp-dex");

/** Swap (solar:dollar). */
export const SwapIcon = solar("swap");

/** Spot Dex (solar:book-2). */
export const SpotDexIcon = solar("spot-dex");

/** CEX: centralized exchanges (a Solar-style exchange building). */
export const CexIcon = solar("cex");

/** Prediction (solar:target). */
export const PredictionIcon = solar("prediction");

/** Vaults (a safe in Solar's style; see the sprite). */
export const VaultsIcon = solar("vaults");

/** Copy trading (solar:copy). */
export const CopyIcon = solar("copy");

/** Markets (solar:chart-2). */
export const MarketsIcon = solar("markets");

/** Layout (solar:widget-2). */
export const LayoutIcon = solar("layout");

/** News (solar:document-text). */
export const NewsIcon = solar("news");

/** Pro order (solar:layers). */
export const ProOrderIcon = solar("pro-order");

/** Bridge (solar:transfer-horizontal). */
export const BridgeIcon = solar("bridge");

/** Settings (solar:settings). */
export const SettingsIcon = solar("settings");

/** Chart, the phone tab (solar:chart-square). */
export const ChartIcon = solar("chart");

/** Trade, the phone tab (solar:pen-new-square). */
export const TradeIcon = solar("trade");

/** Portfolio, the phone tab (solar:case-round). */
export const PortfolioIcon = solar("portfolio");

/** More, the phone menu (solar:hamburger-menu). */
export const MenuIcon = solar("menu");

/** Profile & points (solar:cup-star). */
export const ProfileIcon = solar("profile");

/** Full portfolio (solar:pie-chart-2). */
export const PieChartIcon = solar("pie-chart");
