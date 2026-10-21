import { NextRequest, NextResponse } from "next/server";
import { guard, jsonError, readJsonBody } from "@/lib/security";
import { signatureBodySchema } from "@/lib/validation";
import { createUploadSignature } from "@/lib/cloudinary";
import { env, isCloudinaryConfigured } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mints SHORT-LIVED signed upload parameters for Cloudinary.
 * The browser then uploads directly to api.cloudinary.com — the file bytes
 * never touch this server, and unsigned uploads are rejected by Cloudinary
 * because our cloud is signature-only.
 */
export async function POST(request: NextRequest) {
  const gate = guard(request, { bucket: "upload-signature", limit: 30, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  if (!isCloudinaryConfigured()) return jsonError(503);

  const body = await readJsonBody(request, 20_000);
  if (!body.ok) return body.response;

  const parsed = signatureBodySchema.safeParse(body.data);
  if (!parsed.success) return jsonError(422);

  const timestamp = Math.round(Date.now() / 1000);
  const folder = `atelier/${parsed.data.purpose}` as "atelier/wardrobe" | "atelier/profiles";

  const signature = createUploadSignature({ timestamp, folder });
  if (!signature) return jsonError(500);

  return NextResponse.json({
    signature,
    timestamp,
    folder,
    cloudName: env.cloudName,
    apiKey: env.cloudinaryApiKey,
  });
}
