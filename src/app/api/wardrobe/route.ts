import { NextRequest, NextResponse } from "next/server";
import { guard, jsonError } from "@/lib/security";
import { dbConnect } from "@/lib/mongodb";
import { WardrobeItem, type IWardrobeItem } from "@/models/Wardrobe";
import { isMongoConfigured } from "@/lib/env";
import type { WardrobeItemView } from "@/lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LeanDoc extends IWardrobeItem {
  _id: { toString(): string };
}

export async function GET(request: NextRequest) {
  const gate = guard(request, { bucket: "wardrobe-read", limit: 90, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  if (!isMongoConfigured()) {
    return NextResponse.json({ demo: true, items: [] satisfies WardrobeItemView[] });
  }

  try {
    const mongoose = await dbConnect();
    if (!mongoose) return jsonError(503);

    const docs = (await WardrobeItem.find({})
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()) as unknown as LeanDoc[];

    const items: WardrobeItemView[] = docs.map((doc) => ({
      id: doc._id.toString(),
      kind: doc.kind,
      category: doc.category,
      subcategory: doc.subcategory ?? "",
      color: doc.color ?? "",
      tags: Array.isArray(doc.tags) ? doc.tags.slice(0, 10) : [],
      imageUrl: doc.imageUrl,
      width: doc.width,
      height: doc.height,
      createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    }));

    return NextResponse.json({ demo: false, items });
  } catch {
    return jsonError(500);
  }
}
