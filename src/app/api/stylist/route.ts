import { NextRequest, NextResponse } from "next/server";
import {
  guard,
  jsonError,
  readJsonBody,
  sanitizeTagList,
  sanitizeText,
  withTimeout,
} from "@/lib/security";
import { stylistBodySchema } from "@/lib/validation";
import { dbConnect } from "@/lib/mongodb";
import { WardrobeItem, type IWardrobeItem } from "@/models/Wardrobe";
import { env, isGeminiConfigured, isMongoConfigured } from "@/lib/env";
import {
  buildGeminiPrompt,
  GEMINI_SYSTEM_INSTRUCTION,
  heuristicCompose,
  heuristicNotes,
  parseGeminiOutput,
  type StylingContext,
} from "@/lib/stylist-engine";
import type { ItemDescriptor, MoodId, StylistOutput } from "@/lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface LeanDoc extends IWardrobeItem {
  _id: { toString(): string };
}

function docToDescriptor(doc: LeanDoc): ItemDescriptor {
  return {
    id: doc._id.toString(),
    kind: doc.kind,
    category: doc.category,
    subcategory: sanitizeText(doc.subcategory ?? "", 40),
    color: sanitizeText(doc.color ?? "", 40),
    tags: sanitizeTagList(doc.tags ?? [], 10, 24),
  };
}

async function resolveContext(parsed: {
  mood: MoodId;
  targetItemIds: string[] | undefined;
  items:
    | Array<{
        id: string;
        kind: "item" | "profile";
        category: "tops" | "bottoms" | "footwear" | "accessories" | "profile";
        subcategory?: string;
        color?: string;
        tags?: string[];
      }>
    | undefined;
  bodyPhotoId: string | undefined;
}): Promise<StylingContext> {
  if (isMongoConfigured()) {
    // AUTHORITATIVE PATH: descriptors are re-read from MongoDB; the client
    // only supplies ids, never metadata we would trust.
    const mongoose = await dbConnect();
    if (mongoose) {
      const docs = (await WardrobeItem.find({})
        .sort({ createdAt: -1 })
        .limit(80)
        .lean()) as unknown as LeanDoc[];
      const wardrobe = docs.map(docToDescriptor);
      const targetIds = new Set(parsed.targetItemIds ?? []);
      const targets = wardrobe.filter((item) => targetIds.has(item.id));
      const profiles = new Set(wardrobe.filter((i) => i.kind === "profile").map((i) => i.id));
      return {
        mood: parsed.mood,
        targets,
        wardrobe,
        hasBodyPhoto: parsed.bodyPhotoId ? profiles.has(parsed.bodyPhotoId) : profiles.size > 0,
      };
    }
  }

  // DEMO PATH (no MongoDB configured): descriptors arrive from the client and
  // are sanitized defensively before any engine sees them.
  const wardrobe = (parsed.items ?? []).slice(0, 60).map((item) => ({
    id: sanitizeText(item.id, 64),
    kind: item.kind,
    category: item.category,
    subcategory: sanitizeText(item.subcategory, 40),
    color: sanitizeText(item.color, 40),
    tags: sanitizeTagList(item.tags, 10, 24),
  }));
  const targetIds = new Set(parsed.targetItemIds ?? []);
  const targets = wardrobe.filter((item) => targetIds.has(item.id));
  const profileIds = new Set(wardrobe.filter((i) => i.kind === "profile").map((i) => i.id));
  return {
    mood: parsed.mood,
    targets,
    wardrobe,
    hasBodyPhoto: parsed.bodyPhotoId ? profileIds.has(parsed.bodyPhotoId) : profileIds.size > 0,
  };
}

export async function POST(request: NextRequest) {
  // AI inference is expensive: tighter budget than read routes.
  const gate = guard(request, { bucket: "stylist", limit: 12, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  const body = await readJsonBody(request, 120_000);
  if (!body.ok) return body.response;

  const parsed = stylistBodySchema.safeParse(body.data);
  if (!parsed.success) return jsonError(422);

  let context: StylingContext;
  try {
    context = await resolveContext({
      mood: parsed.data.mood as MoodId,
      targetItemIds: parsed.data.targetItemIds,
      items: parsed.data.items,
      bodyPhotoId: parsed.data.bodyPhotoId,
    });
  } catch {
    return jsonError(500);
  }

  const validItems = new Map(
    context.wardrobe.filter((item) => item.kind === "item").map((item) => [item.id, item]),
  );

  // ── Path A: Gemini (free-tier flash) ──
  if (isGeminiConfigured()) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: env.geminiApiKey as string });
      const response = await withTimeout(
        ai.models.generateContent({
          model: env.geminiModel,
          contents: buildGeminiPrompt(context),
          config: {
            responseMimeType: "application/json",
            systemInstruction: GEMINI_SYSTEM_INSTRUCTION,
            temperature: 0.65,
            maxOutputTokens: 2500,
          },
        }),
        24_000,
      );

      const text = typeof response.text === "string" ? response.text : "";
      const parsedOutput = parseGeminiOutput(text, validItems);
      if (parsedOutput) {
        const output: StylistOutput = {
          engine: "gemini",
          mood: context.mood,
          outfits: parsedOutput.outfits,
          notes: parsedOutput.notes || heuristicNotes(context, parsedOutput.outfits),
          generatedAt: new Date().toISOString(),
        };
        return NextResponse.json(output);
      }
      // Malformed model output → fail through to the rule engine below.
    } catch {
      // Fail-safe: fall through silently. Never surface upstream AI errors.
    }
  }

  // ── Path B: deterministic rule engine (always available, zero cost) ──
  const outfits = heuristicCompose(context);
  const output: StylistOutput = {
    engine: "atelier-rules",
    mood: context.mood,
    outfits,
    notes: heuristicNotes(context, outfits),
    generatedAt: new Date().toISOString(),
  };
  return NextResponse.json(output);
}
