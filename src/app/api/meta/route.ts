import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security";
import {
  env,
  isCloudinaryConfigured,
  isGeminiConfigured,
  isHfConfigured,
  isMongoConfigured,
} from "@/lib/env";
import type { ServiceStatus } from "@/lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Non-secret capability report (never leaks credential values — booleans only).
 */
export async function GET(request: NextRequest) {
  const gate = guard(request, { bucket: "meta", limit: 90, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  const cloudinary = isCloudinaryConfigured();
  const status: ServiceStatus = {
    mongo: isMongoConfigured(),
    cloudinary,
    gemini: isGeminiConfigured(),
    huggingFace: isHfConfigured(),
    cloudName: cloudinary ? env.cloudName : null,
    demo: !(isMongoConfigured() && cloudinary),
  };

  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}
