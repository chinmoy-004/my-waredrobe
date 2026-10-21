import { NextRequest, NextResponse } from "next/server";
import { guard, isValidObjectId, jsonError } from "@/lib/security";
import { dbConnect } from "@/lib/mongodb";
import { WardrobeItem } from "@/models/Wardrobe";
import { isMongoConfigured } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = guard(request, { bucket: "wardrobe-delete", limit: 30, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  const { id } = await params;

  // Strict ObjectId shape — blocks NoSQL operator smuggling paths entirely.
  if (!isValidObjectId(id)) return jsonError(isMongoConfigured() ? 400 : 404);

  if (!isMongoConfigured()) return NextResponse.json({ ok: true, demo: true });

  try {
    const mongoose = await dbConnect();
    if (!mongoose) return jsonError(503);

    const deleted = await WardrobeItem.findByIdAndDelete(id);
    if (!deleted) return jsonError(404);

    return NextResponse.json({ ok: true });
  } catch {
    return jsonError(500);
  }
}
