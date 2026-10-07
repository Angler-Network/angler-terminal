import "server-only";

/**
 * Redis over Upstash REST (Vercel's Upstash integration sets KV_REST_API_URL/TOKEN). Shared by analytics and
 * profiles; without it (local dev) each caller keeps its data in memory.
 */
export function redisConfig() {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)?.trim();
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

export type RedisCommand = Array<string | number>;

export async function redisPipeline(commands: RedisCommand[]): Promise<unknown[]> {
  const config = redisConfig();
  if (!config) throw new Error("Redis is not configured.");
  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Redis answered ${response.status}.`);
  const body = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  return body.map((entry) => {
    if (entry.error) throw new Error(entry.error);
    return entry.result;
  });
}

/** HGETALL comes back as a flat [field, value, ...] list over REST. */
export function toHash(result: unknown): Record<string, string> {
  if (!Array.isArray(result)) return {};
  const hash: Record<string, string> = {};
  for (let index = 0; index + 1 < result.length; index += 2) hash[String(result[index])] = String(result[index + 1]);
  return hash;
}
