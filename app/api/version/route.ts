import { NextResponse } from "next/server";
import { commitSha } from "@/lib/site";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { commit: process.env.VERCEL_GIT_COMMIT_SHA || commitSha },
    { headers: { "cache-control": "no-store" } },
  );
}
