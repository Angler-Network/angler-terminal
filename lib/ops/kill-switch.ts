import "server-only";
import { redisConfig, redisPipeline } from "@/lib/redis";

/**
 * Services an admin turned off for everyone (a hacked or failing bridge): ids like "bridge:relay". Off services are
 * dropped by every browser within a minute, without a deploy. In Redis per deployment; memory without it.
 */
const KEY = `angler:ops:${process.env.NEXT_PUBLIC_DEPLOYMENT || "dev"}:off`;
const memory = ((globalThis as unknown as { __anglerOff?: Set<string> }).__anglerOff ??= new Set<string>());

export const SERVICE_IDS = ["bridge:across", "bridge:relay", "bridge:lifi"] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export function isServiceId(value: unknown): value is ServiceId {
  return typeof value === "string" && (SERVICE_IDS as readonly string[]).includes(value);
}

export async function readOffServices(): Promise<ServiceId[]> {
  if (!redisConfig()) return [...memory].filter(isServiceId);
  const [members] = await redisPipeline([["SMEMBERS", KEY]]);
  return Array.isArray(members) ? members.filter(isServiceId) : [];
}

export async function setServiceOff(id: ServiceId, off: boolean) {
  if (!redisConfig()) {
    if (off) memory.add(id);
    else memory.delete(id);
    return;
  }
  await redisPipeline([[off ? "SADD" : "SREM", KEY, id]]);
}
