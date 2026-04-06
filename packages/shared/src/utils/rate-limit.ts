/**
 * In-memory sliding-window rate limiter.
 * No external dependencies — state resets on server restart.
 * If you scale to multiple instances, replace with Redis.
 */

type RateLimitEntry = { count: number; windowStart: number; windowMs: number };

const cache = new Map<string, RateLimitEntry>();

// Purge expired entries every 5 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.windowStart >= entry.windowMs) {
      cache.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export async function checkRateLimit(key: string, maxCount: number, windowMinutes: number): Promise<boolean> {
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const entry = cache.get(key);

  if (!entry || (now - entry.windowStart) >= windowMs) {
    cache.set(key, { count: 1, windowStart: now, windowMs });
    return true;
  }

  if (entry.count >= maxCount) return false;

  entry.count++;
  return true;
}

/** Peek at the current count for a rate-limit key without incrementing. */
export function getRateLimitCount(key: string, windowMinutes: number): number {
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const entry = cache.get(key);
  if (!entry || (now - entry.windowStart) >= windowMs) return 0;
  return entry.count;
}
