"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { loadFollows, subscribeCopyStore } from "@/lib/copy/follow-store";

// The runner (venue lookups, book quotes) loads only for wallets that copy someone.
const CopyRunner = dynamic(() => import("./copy-runner").then((module) => module.CopyRunner), { ssr: false });

/** Starts the copy runner while this wallet copies at least one followed wallet. */
export function CopyGate({ address }: { address: `0x${string}` | null }) {
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    if (!address) return setCopying(false);
    const read = () => setCopying(loadFollows(address).some((follow) => follow.copy.enabled));
    read();
    return subscribeCopyStore(read);
  }, [address]);
  return address && copying ? <CopyRunner key={address} address={address} /> : null;
}
