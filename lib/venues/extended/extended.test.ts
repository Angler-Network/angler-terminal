import { describe, expect, it } from "vitest";
import rows from "./fixtures/markets.json";
import { applyAccountMessage, emptyAccountState } from "./account-stream";
import { marketOrderPrice, numberText, roundToStep, settlementAmounts, settlementExpiration, stepDecimals } from "./amounts";
import { readExtendedConfig } from "./config";
import { extendedRestricted } from "./geo";
import { extendedSymbol, oidOf, readExtendedAccount, readExtendedCandles, readExtendedMarkets, type ExtendedMarketRow } from "./markets";
import { extendedProxyDecision } from "./proxy";

describe("Extended settlement amounts", () => {
  // Expected values from the SDK's own Decimal math (x10/signing/order_object_settlement.py).
  it("rounds a buy up and negates its collateral", () => {
    const amounts = settlementAmounts({ side: "buy", qty: "0.0001", price: "83594", takerFee: "0.0005", builderFee: "0.00035", syntheticResolution: 1_000_000, collateralResolution: 1_000_000 });
    expect(amounts).toEqual({ synthetic: 100n, collateral: -8_359_400n, fee: 7_106n });
  });

  it("rounds a sell down, negates its synthetic, and the fee always up", () => {
    const amounts = settlementAmounts({ side: "sell", qty: "0.123", price: "2506.47", takerFee: "0.00025", builderFee: "0", syntheticResolution: 10_000, collateralResolution: 1_000_000 });
    expect(amounts).toEqual({ synthetic: -1_230n, collateral: 308_295_810n, fee: 77_074n });
  });

  it("stays exact where floats wouldn't (0.1 × 3)", () => {
    expect(settlementAmounts({ side: "buy", qty: "0.1", price: "3", takerFee: "0", builderFee: "0", syntheticResolution: 10, collateralResolution: 1_000_000 }).collateral).toBe(-300_000n);
  });

  it("signs the expiry plus 14 days, in whole seconds rounded up", () => {
    expect(settlementExpiration(1_000_000_500)).toBe(1_000_001 + 14 * 86_400);
  });

  it("rounds to the market's steps and prices market orders inside the band", () => {
    expect(stepDecimals("0.00001")).toBe(5);
    expect(stepDecimals("1")).toBe(0);
    expect(roundToStep(0.123456, "0.001", "down")).toBe("0.123");
    expect(roundToStep(83594.6, "1")).toBe("83595");
    expect(numberText(1e-7)).toBe("0.0000001");
    expect(marketOrderPrice({ side: "buy", reference: 100, mark: 100, tick: "0.1", cap: 0.05, floor: 0.05 })).toBe("101.5");
    expect(marketOrderPrice({ side: "sell", reference: 100, mark: 100, tick: "0.1", cap: 0.05, floor: 0.05 })).toBe("98.5");
    // A book far off the mark is held to the band.
    expect(marketOrderPrice({ side: "buy", reference: 120, mark: 100, tick: "0.1", cap: 0.05, floor: 0.05 })).toBe("105.0");
  });
});

describe("Extended markets", () => {
  const { markets, info } = readExtendedMarkets(rows as ExtendedMarketRow[]);

  it("keeps active perps, drops the 24/5 suffix and reads steps and stats", () => {
    expect(markets.map((market) => market.symbol).sort()).toEqual(["BTC", "ETH", "TSLA", "XAU"]);
    const btc = markets.find((market) => market.coin === "BTC-USD")!;
    expect(btc).toMatchObject({ venue: "extended", symbol: "BTC", kind: "crypto", szDecimals: 5, priceDecimals: 0, maxLeverage: 50 });
    expect(btc.markPx).toBeGreaterThan(0);
    expect(markets.find((market) => market.symbol === "TSLA")?.kind).toBe("stock");
    expect(info.get("BTC-USD")).toMatchObject({ sizeStep: "0.00001", tick: "1", syntheticResolution: 1_000_000, collateralId: "0x1" });
    expect(extendedSymbol("NVDA_24_5")).toBe("NVDA");
    expect(extendedSymbol("kPEPE")).toBe("kPEPE");
  });

  it("maps positions, live orders and the balance", () => {
    const snapshot = readExtendedAccount(
      markets,
      [{ market: "BTC-USD", side: "SHORT", size: "0.5", value: "41000", openPrice: "82000", markPrice: "82000", liquidationPrice: "90000", unrealisedPnl: "-12.5", leverage: "10" }],
      [
        { id: "2109056172888289280", externalId: "136423700383520107061594181012", market: "ETH-USD", side: "BUY", status: "NEW", type: "LIMIT", price: "2400", qty: "1", filledQty: "0.25", createdTime: 5 },
        { id: 2, market: "ETH-USD", side: "SELL", status: "FILLED", qty: "1" },
      ],
      { equity: "1000.5", availableForWithdrawal: "800" },
    );
    expect(snapshot.positions[0]).toMatchObject({ venue: "extended", symbol: "BTC", size: -0.5, entryPx: 82000, liquidationPx: 90000, leverage: 10, returnOnEquity: -12.5 / 4100 });
    expect(snapshot.orders).toHaveLength(1);
    expect(snapshot.orders[0]).toMatchObject({ symbol: "ETH", side: "buy", size: 0.75, origSize: 1, orderType: "Limit", oid: oidOf("136423700383520107061594181012") });
    expect(Number.isSafeInteger(snapshot.orders[0].oid)).toBe(true);
    expect(snapshot).toMatchObject({ accountValue: 1000.5, withdrawable: 800 });
  });

  it("reads candles oldest first", () => {
    expect(readExtendedCandles([{ o: "2", h: "3", l: "1", c: "2.5", v: "9", T: 20 }, { c: "1", T: 10 }, { c: "x" }]).map((candle) => candle.time)).toEqual([10, 20]);
  });
});

describe("Extended account stream", () => {
  it("replaces on snapshots, upserts updates and drops closed rows", () => {
    let state = emptyAccountState();
    state = applyAccountMessage(state, { type: "ACCOUNT.POSITION", data: { isSnapshot: true, positions: [{ market: "BTC-USD", side: "LONG", size: "1" }, { market: "ETH-USD", side: "LONG", size: "2" }] } });
    state = applyAccountMessage(state, { type: "ACCOUNT.POSITION", data: { isSnapshot: false, positions: [{ market: "ETH-USD", side: "LONG", size: "0", status: "CLOSED" }] } });
    expect([...state.positions.keys()]).toEqual(["BTC-USD"]);
    state = applyAccountMessage(state, { type: "ACCOUNT.ORDER", data: { isSnapshot: true, orders: [{ id: 1, externalId: "a", market: "BTC-USD", side: "BUY", status: "NEW", qty: "1" }] } });
    state = applyAccountMessage(state, { type: "ACCOUNT.ORDER", data: { isSnapshot: false, orders: [{ id: 1, externalId: "a", market: "BTC-USD", side: "BUY", status: "FILLED", qty: "1" }] } });
    expect(state.orders.size).toBe(0);
    state = applyAccountMessage(state, { type: "ACCOUNT.BALANCE", data: { isSnapshot: true, balance: { equity: "5" } } });
    expect(state.balance?.equity).toBe("5");
    expect([...state.seen].sort()).toEqual(["balance", "orders", "positions"]);
  });
});

describe("Extended access", () => {
  it("refuses Extended's restricted countries, and unknown ones", () => {
    expect(extendedRestricted("TR")).toBe(false);
    expect(extendedRestricted("JP")).toBe(false);
    expect(extendedRestricted("us")).toBe(true);
    expect(extendedRestricted("GB")).toBe(true);
    expect(extendedRestricted("UA", "43")).toBe(true);
    expect(extendedRestricted("UA", "30")).toBe(false);
    expect(extendedRestricted(null)).toBe(true);
  });

  it("relays only the terminal's paths, account ones never to restricted visitors", () => {
    const base = { network: "mainnet", country: "TR", region: null, pinned: null } as const;
    expect(extendedProxyDecision({ ...base, method: "GET", path: "/api/v1/info/markets/BTC-USD/orderbook" })).toEqual({ ok: true });
    expect(extendedProxyDecision({ ...base, method: "GET", path: "/api/v1/info/markets", country: "US" })).toEqual({ ok: true });
    expect(extendedProxyDecision({ ...base, method: "POST", path: "/api/v1/user/order", country: "US" })).toEqual({ ok: false, status: 451, restricted: true });
    expect(extendedProxyDecision({ ...base, method: "POST", path: "/api/v1/user/order" })).toEqual({ ok: true });
    expect(extendedProxyDecision({ ...base, method: "POST", path: "/api/v1/user/withdrawal" })).toEqual({ ok: false, status: 404 });
    expect(extendedProxyDecision({ ...base, method: "POST", path: "/api/v1/user/claim" })).toEqual({ ok: false, status: 404 });
    expect(extendedProxyDecision({ ...base, network: "testnet", method: "POST", path: "/api/v1/user/claim" })).toEqual({ ok: true });
    expect(extendedProxyDecision({ ...base, network: "testnet", pinned: "mainnet", method: "GET", path: "/api/v1/info/markets" })).toEqual({ ok: false, status: 404 });
    expect(extendedProxyDecision({ ...base, network: "other", method: "GET", path: "/api/v1/info/markets" })).toEqual({ ok: false, status: 404 });
  });

  it("puts our builder id on mainnet orders only", () => {
    expect(readExtendedConfig({ NEXT_PUBLIC_EXTENDED_NETWORK: "mainnet", NEXT_PUBLIC_EXTENDED_BUILDER_ID: "300382" }, null)).toMatchObject({ network: "mainnet", builderId: 300382, builderFee: 0.00035 });
    expect(readExtendedConfig({ NEXT_PUBLIC_EXTENDED_BUILDER_ID: "300382" }, null)).toMatchObject({ network: "testnet", builderId: null });
    expect(readExtendedConfig({ NEXT_PUBLIC_EXTENDED_BUILDER_ID: "300382" }, "mainnet").builderId).toBe(300382);
  });
});
