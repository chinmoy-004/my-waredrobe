/**
 * IP-based sliding-window rate limiter (in-memory).
 *
 * Zero-cost by design: on a single Vercel instance this protects every API
 * route against brute-force, spam and DDoS bursts without any paid service.
 * Windows are pruned continuously and the key space is hard-capped so an
 * attacker cannot exhaust server memory by flooding spoofed IPs.
 *
 * If you ever scale to many serverless instances, swap the Map for a shared
 * store such as Upstash Redis (also free tier) — the call sites stay identical.
 */

interface RateLimitBucket {
  /** Monotonically increasing timestamps (ms) inside the active window. */
  hits: number[];
}

const buckets = new Map<string, RateLimitBucket>();
const MAX_TRACKED_KEYS = 10_000; // memory-exhaustion shield
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = Date.now();

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterSec: number;
}

export function consumeRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const { limit, windowMs } = options;
  const now = Date.now();

  if (now - lastSweep > SWEEP_INTERVAL_MS) sweepStaleBuckets(now);

  const windowStart = now - windowMs;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }

  // Drop hits that fell out of the sliding window.
  while (bucket.hits.length > 0 && bucket.hits[0] <= windowStart) {
    bucket.hits.shift();
  }

  const ok = bucket.hits.length < limit;
  if (ok) bucket.hits.push(now);

  const remaining = Math.max(0, limit - bucket.hits.length);
  const oldest = bucket.hits[0] ?? now;
  const resetMs = Math.max(0, oldest + windowMs - now);
  const retryAfterSec = ok ? 0 : Math.max(1, Math.ceil(resetMs / 1000));

  return { ok, limit, remaining, resetMs, retryAfterSec };
}

function sweepStaleBuckets(now: number): void {
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.hits.length === 0) buckets.delete(key);
  }
  if (buckets.size > MAX_TRACKED_KEYS) {
    let excess = buckets.size - MAX_TRACKED_KEYS;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      excess -= 1;
      if (excess <= 0) break;
    }
  }
}
