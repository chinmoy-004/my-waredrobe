import { NextRequest, NextResponse } from "next/server";
import { guard, jsonError, readJsonBody, sanitizeTagList, sanitizeText } from "@/lib/security";
import { wardrobeMetadataSchema } from "@/lib/validation";
import { isCloudinaryDeliveryUrl, type WardrobeItemView } from "@/lib/domain";
import { dbConnect } from "@/lib/mongodb";
import { WardrobeItem } from "@/models/Wardrobe";
import { env, isCloudinaryConfigured, isMongoConfigured } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Persists wardrobe metadata AFTER a signed Cloudinary upload succeeded.
 * The delivery URL must belong to OUR cloud, carry OUR public_id and live in
 * the correct folder — anything else is rejected before Mongoose is touched.
 */
export async function POST(request: NextRequest) {
  const gate = guard(request, { bucket: "wardrobe-write", limit: 20, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  if (!isCloudinaryConfigured() || !isMongoConfigured()) return jsonError(503);

  const body = await readJsonBody(request, 105_000_000);
  if (!body.ok) return body.response;

  const parsed = wardrobeMetadataSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(422);

  const input = parsed.data;

  // Zero-trust delivery URL verification — accept any image MIME from Cloudinary
  if (!isCloudinaryDeliveryUrl(input.imageUrl, env.cloudName)) return jsonError(422);
  if (!input.imageUrl.includes(`/${input.publicId}`)) return jsonError(422);
  const expectedFolder = input.kind === "profile" ? "atelier/profiles/" : "atelier/wardrobe/";
  if (!input.publicId.startsWith(expectedFolder)) return jsonError(422);

  const sanitized = {
    kind: input.kind,
    category: input.category,
    subcategory: sanitizeText(input.subcategory ?? "", 40),
    color: sanitizeText(input.color ?? "", 40),
    tags: sanitizeTagList(input.tags ?? [], 10, 24),
    imageUrl: input.imageUrl,
    publicId: input.publicId,
    ...(typeof input.width === "number" ? { width: input.width } : {}),
    ...(typeof input.height === "number" ? { height: input.height } : {}),
  };

  try {
    const mongoose = await dbConnect();
    if (!mongoose) return jsonError(503);

    const doc = await WardrobeItem.create(sanitized);
    const view: WardrobeItemView = {
      id: String(doc._id),
      kind: doc.kind,
      category: doc.category,
      subcategory: doc.subcategory ?? "",
      color: doc.color ?? "",
      tags: doc.tags,
      imageUrl: doc.imageUrl,
      width: doc.width,
      height: doc.height,
      createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    };

    return NextResponse.json({ ok: true, item: view }, { status: 201 });
  } catch {
    // Fail-safe: never leak validation internals, DB state or stack traces.
    return jsonError(500);
  }
}
