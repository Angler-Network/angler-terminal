/**
 * Server-only Across settings: `ACROSS_INTEGRATOR_ID` (the 2-byte hex id Across assigns, tags our deposits) and an
 * optional app fee, `ACROSS_APP_FEE` (fraction of the amount, 0 < fee ≤ 0.01) paid to `ACROSS_APP_FEE_RECIPIENT`.
 */
export function readAcrossServerConfig(env: Record<string, string | undefined>) {
  const integratorId = /^0x[0-9a-fA-F]{4}$/.test(env.ACROSS_INTEGRATOR_ID ?? "") ? env.ACROSS_INTEGRATOR_ID : undefined;
  const fee = Number(env.ACROSS_APP_FEE);
  const appFee = Number.isFinite(fee) && fee > 0 && fee <= 0.01 ? fee : undefined;
  const appFeeRecipient = /^0x[0-9a-fA-F]{40}$/.test(env.ACROSS_APP_FEE_RECIPIENT ?? "") ? env.ACROSS_APP_FEE_RECIPIENT : undefined;
  return { integratorId, appFee, appFeeRecipient };
}
