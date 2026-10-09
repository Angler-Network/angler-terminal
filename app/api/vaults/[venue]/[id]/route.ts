import { NextResponse, type NextRequest } from "next/server";
import { rateLimited } from "@/lib/rate-limit";
import { getVaultHistory, validVaultId } from "@/lib/vaults/server";
import { VAULT_VENUE_NAMES, type VaultVenue } from "@/lib/vaults/types";

/** One vault's performance: a growth index, returns and drawdown (Orderly: its own figures per period). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ venue: string; id: string }> }) {
  const limited = rateLimited(request, "vault-history");
  if (limited) return limited;
  const { venue, id } = await params;
  if (!(venue in VAULT_VENUE_NAMES) || !validVaultId(venue as VaultVenue, id)) return NextResponse.json({ error: "Unknown vault" }, { status: 400 });
  try {
    const history = await getVaultHistory(venue as VaultVenue, id);
    return NextResponse.json(history, { headers: { "cache-control": "public, s-maxage=120, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json({ error: "Couldn't read this vault's history right now." }, { status: 502 });
  }
}
