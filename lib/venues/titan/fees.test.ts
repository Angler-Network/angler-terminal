import { describe, expect, it } from "vitest";
import { USDC_MINT } from "../jupiter/config";
import { associatedTokenAddress, readTitanFeeConfig, titanFeeParams } from "./fees";

const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

describe("titan fees", () => {
  it("derives the wallet's USDC token account", async () => {
    // Checked on mainnet: this account exists, owned by WALLET, for USDC.
    expect(await associatedTokenAddress(WALLET, USDC_MINT)).toBe("FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B");
  });

  it("reads the fee config", async () => {
    expect(await readTitanFeeConfig({})).toBeNull();
    expect(await readTitanFeeConfig({ TITAN_FEE_WALLET: WALLET })).toBeNull();
    expect(await readTitanFeeConfig({ TITAN_FEE_WALLET: "nope", TITAN_FEE_BPS: "50" })).toBeNull();
    expect(await readTitanFeeConfig({ TITAN_FEE_WALLET: WALLET, TITAN_FEE_BPS: "900" })).toEqual({
      usdcAccount: "FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B",
      bps: 255,
    });
  });

  it("takes the fee in USDC on both sides", async () => {
    const fee = await readTitanFeeConfig({ TITAN_FEE_WALLET: WALLET, TITAN_FEE_BPS: "50" });
    expect(titanFeeParams(fee, USDC_MINT, BONK)).toEqual({ feeAccount: fee!.usdcAccount, feeBps: "50", feeFromInputMint: "true" });
    expect(titanFeeParams(fee, BONK, USDC_MINT)).toEqual({ feeAccount: fee!.usdcAccount, feeBps: "50" });
    expect(titanFeeParams(fee, SOL, BONK)).toEqual({});
    expect(titanFeeParams(null, USDC_MINT, BONK)).toEqual({});
  });
});
