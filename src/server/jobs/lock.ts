// Keeps background jobs to one instance when several run behind a load
// balancer. Without REDIS_URL there is only one process, so every run goes
// ahead. With Redis each run first takes a lock named after the job with
// SET NX PX: the first instance to get it runs the job, the others skip that
// round. The lock lasts 90% of the job's interval, so the same instance can
// take it again on its next tick while the others still see it held.

import { INSTANCE_ID, logRedisError, redisCommand, redisKey } from "@/lib/redis";

/** How long a run's lock lasts for a job that runs every `everyMs`. */
export function lockTtlMs(everyMs: number): number {
  return Math.max(1_000, Math.floor(everyMs * 0.9));
}

/** Resolves to true when this instance should run the job now. */
export async function claimJobRun(name: string, everyMs: number): Promise<boolean> {
  const command = redisCommand();
  if (!command) return true;
  try {
    const redis = await command;
    const ok = await redis.set(redisKey(`job:${name}`), INSTANCE_ID, "PX", lockTtlMs(everyMs), "NX");
    return ok === "OK";
  } catch (err) {
    // Skipping a round is safer than running it on every instance at once.
    logRedisError(`job lock ${name}`, err);
    return false;
  }
}
