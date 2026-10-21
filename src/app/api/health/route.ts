import { isMongoConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for the platform / load balancer.
 * Always 200: readiness of optional services is reported, never fatal.
 */
export async function GET() {
  return Response.json({ ok: true, mongoConfigured: isMongoConfigured() });
}
