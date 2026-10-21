/**
 * Zero-trust request hardening utilities shared by every API route:
 *  - IP-based rate limiting guard (per route bucket)
 *  - Origin / Referer / Sec-Fetch-Site verification (CSRF & request tampering)
 *  - Size-capped JSON body reading (payload-bomb protection)
 *  - Input sanitization helpers (NoSQL injection & XSS surface reduction)
 *  - Fail-safe error obfuscation — clients never see internals
 */

import { NextRequest, NextResponse } from "next/server";
import { consumeRateLimit } from "./rate-limit";

const ERROR_MESSAGES: Record<number, string> = {
  400: "The request could not be understood.",
  403: "Forbidden.",
  404: "Not found.",
  405: "Method not allowed.",
  408: "Request timed out.",
  413: "Payload too large.",
  415: "Unsupported media type.",
  422: "The request payload failed validation.",
  429: "Too many requests. Slow down.",
  500: "Something went wrong. Please try again later.",
  503: "This service is temporarily unavailable.",
};

/** Fail-safe JSON error: static, status-keyed copy. No stack traces, no internals. */
export function jsonError(
  status: number,
  init?: { headers?: Record<string, string> },
): NextResponse {
  const message = ERROR_MESSAGES[status] ?? "Request failed.";
  return NextResponse.json({ error: message }, { status, headers: init?.headers });
}

/* ── Client identity ── */

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  return real ? real.slice(0, 64) : "unknown";
}

/* ── Origin verification (CSRF / request-tampering shield) ── */

function hostMatches(value: string, expectedHost: string | null): boolean {
  if (!expectedHost) return false;
  try {
    return new URL(value).host === expectedHost;
  } catch {
    return false;
  }
}

/**
 * Mutating requests must either prove they originate from our own origin
 * (browser Origin/Referer headers) or arrive headerless (non-browser clients),
 * which remain constrained by rate limits + strict schema validation.
 */
export function verifyRequestOrigin(request: NextRequest): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return jsonError(403);

  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin) return hostMatches(origin, host) ? null : jsonError(403);
  if (referer) return hostMatches(referer, host) ? null : jsonError(403);
  return null;
}

/* ── Combined guard used at the top of every route handler ── */

export interface GuardOptions {
  bucket: string;
  limit: number;
  windowMs: number;
}

export type GuardResult = { ok: true; ip: string } | { ok: false; response: NextResponse };

export function guard(request: NextRequest, options: GuardOptions): GuardResult {
  const originViolation = verifyRequestOrigin(request);
  if (originViolation) return { ok: false, response: originViolation };

  const ip = getClientIp(request);
  const verdict = consumeRateLimit(`${options.bucket}:${ip}`, {
    limit: options.limit,
    windowMs: options.windowMs,
  });

  if (!verdict.ok) {
    return {
      ok: false,
      response: jsonError(429, {
        headers: {
          "Retry-After": String(verdict.retryAfterSec),
          "X-RateLimit-Limit": String(verdict.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(verdict.resetMs / 1000)),
        },
      }),
    };
  }

  return { ok: true, ip };
}

/* ── Size-capped, media-type-checked JSON body reading ── */

export type JsonReadResult =
  | { ok: true; data: unknown }
  | { ok: false; response: NextResponse };

export async function readJsonBody(request: NextRequest, maxBytes: number): Promise<JsonReadResult> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return { ok: false, response: jsonError(415) };
  }

  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: jsonError(413) };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: jsonError(400) };
  }

  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    return { ok: false, response: jsonError(413) };
  }

  if (!raw.trim()) return { ok: true, data: {} };

  try {
    return { ok: true, data: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, response: jsonError(400) };
  }
}

/* ── Sanitization ── */

// Strip control characters (NoSQL payload smuggling) and angle brackets (XSS surface).
// Operator-style keys ($where etc.) are already impossible: Zod rejects non-literal
// shapes and Mongoose only ever receives plain string values — never objects.
const UNSAFE_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F<>]", "g");

export function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(UNSAFE_CHARS, "").slice(0, maxLength);
}

export function sanitizeTagList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const clean = sanitizeText(entry, maxLength).toLowerCase();
    if (clean && !out.includes(clean)) out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function isValidObjectId(id: string): boolean {
  return /^[a-f\d]{24}$/i.test(id);
}

/* ── Misc ── */

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("operation-timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("operation-failed"));
      },
    );
  });
}
