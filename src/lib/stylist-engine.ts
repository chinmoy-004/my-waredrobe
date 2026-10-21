/**
 * AI Stylist core:
 *  1. buildGeminiPrompt  — feeds the EXACT sanitized wardrobe context to Gemini.
 *  2. parseGeminiOutput  — validates/normalizes whatever the model returns; never trusted.
 *  3. heuristicCompose   — deterministic rule-based engine used as a fail-safe
 *     (no API key / timeouts / malformed output), so the feature never breaks.
 */

import type { ItemDescriptor, MoodId, OutfitPlan } from "./domain";
import { MOODS } from "./domain";

/* ── Shared context shape ── */

export interface StylingContext {
  mood: MoodId;
  targets: ItemDescriptor[];
  wardrobe: ItemDescriptor[];
  hasBodyPhoto: boolean;
}

function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.trim().replace(new RegExp("[\\u0000-\\u001F<>]", "g"), "").slice(0, max);
}

/* ── Color intelligence ── */

const NEUTRAL_TONES = new Set([
  "black", "charcoal", "grey", "gray", "white", "ivory", "off-white", "cream",
  "beige", "sand", "navy", "olive", "khaki", "brown", "tan", "denim", "steel",
  "onyx", "silver", "camel", "stone",
]);

function toneOf(color: string): string {
  return color.trim().toLowerCase();
}

function isNeutral(color: string): boolean {
  const tone = toneOf(color);
  if (!tone) return true;
  for (const neutral of NEUTRAL_TONES) {
    if (tone.includes(neutral)) return true;
  }
  return false;
}

function describePalette(colors: string[]): string {
  const present = colors.map(toneOf).filter(Boolean);
  const accents = present.filter((c) => !isNeutral(c));
  if (present.length === 0) return "a palette left intentionally open";
  if (accents.length === 0) return "a strict tonal column of neutrals — the quiet hallmark of expensive dressing";
  if (accents.length === 1)
    return `a single ${accents[0]} accent set against a neutral base, so the eye lands exactly where it should`;
  return `controlled contrast between ${accents.slice(0, 2).join(" and ")} anchored by neutrals`;
}

/* ── Mood recipes ── */

interface MoodRecipe {
  topCues: string[];
  outerCues: string[];
  bottomCues: string[];
  footwearCues: string[];
  accessoryCues: string[];
  occasions: string[];
  names: [string, string, string];
  layeringStyle: string;
}

const RECIPES: Record<MoodId, MoodRecipe> = {
  bold: {
    topCues: ["shirt", "t-shirt"],
    outerCues: ["jacket", "blazer"],
    bottomCues: ["pants", "jeans"],
    footwearCues: ["shoes", "boots", "sneakers"],
    accessoryCues: ["sunglasses", "ring", "chain", "watch"],
    occasions: ["Gallery night", "Rooftop evening", "Front-row moment"],
    names: ["The Iconoclast", "Statement Piece", "Walk-In Loud"],
    layeringStyle: "Structure on structure: keep the outer layer open so the contrast reads from across the room.",
  },
  premium: {
    topCues: ["shirt", "panjabi", "t-shirt"],
    outerCues: ["blazer", "jacket"],
    bottomCues: ["pants", "chinos"],
    footwearCues: ["shoes", "loafers", "sneakers"],
    accessoryCues: ["watch", "ring"],
    occasions: ["Private dinner", "Hotel lounge", "Vernissage"],
    names: ["Quiet Luxury", "The Heirloom", "Old Money Air"],
    layeringStyle: "Tone-on-tone tailoring; no visible logos, let fabric weight and fit carry the look.",
  },
  streetwear: {
    topCues: ["t-shirt", "hoodie"],
    outerCues: ["jacket", "hoodie"],
    bottomCues: ["jeans", "joggers", "pants"],
    footwearCues: ["sneakers"],
    accessoryCues: ["cap", "chain", "sunglasses", "watch"],
    occasions: ["City loop", "Studio session", "Weekend errands"],
    names: ["Off-Duty Fit", "Block Ready", "Street Uniform"],
    layeringStyle: "Relaxed proportions; stack a boxy layer over a clean tee and keep the sneaker silhouette crisp.",
  },
  formal: {
    topCues: ["shirt"],
    outerCues: ["blazer", "jacket"],
    bottomCues: ["pants", "chinos"],
    footwearCues: ["shoes", "loafers"],
    accessoryCues: ["watch", "belt", "ring"],
    occasions: ["Boardroom", "Client dinner", "Keynote"],
    names: ["The Closer", "Blue-Chip", "Corner Office"],
    layeringStyle: "Pressed lines and a structured shoulder; tuck cleanly and let the watch punctuate the cuff.",
  },
  party: {
    topCues: ["shirt", "panjabi", "t-shirt"],
    outerCues: ["jacket", "blazer"],
    bottomCues: ["pants", "jeans"],
    footwearCues: ["shoes", "boots", "sneakers"],
    accessoryCues: ["sunglasses", "ring", "chain", "watch"],
    occasions: ["Cocktail hour", "After-party", "Birthday dinner"],
    names: ["After Dark", "Velvet Hour", "Last Drink"],
    layeringStyle: "One hero piece only — everything else falls back to black so the statement stays singular.",
  },
  festive: {
    topCues: ["panjabi", "kurta", "shirt"],
    outerCues: ["jacket", "blazer"],
    bottomCues: ["pants", "chinos"],
    footwearCues: ["shoes", "loafers", "sandals"],
    accessoryCues: ["watch", "ring", "bracelet"],
    occasions: ["Eid gathering", "Family feast", "Wedding guest"],
    names: ["The Celebration", "Festive Order", "Heritage Line"],
    layeringStyle: "Traditional anchor with a tailored layer; keep metals warm and fabrics matte.",
  },
  minimal: {
    topCues: ["t-shirt", "shirt"],
    outerCues: ["jacket", "blazer"],
    bottomCues: ["pants", "jeans", "chinos"],
    footwearCues: ["sneakers", "shoes"],
    accessoryCues: ["watch"],
    occasions: ["Everyday uniform", "Coffee run", "Museum afternoon"],
    names: ["Less, Perfectly", "The Uniform", "Clean Lines"],
    layeringStyle: "Two layers maximum, impossibly tidy; every seam earns its place.",
  },
};

/* ── Heuristic composition engine (fail-safe core) ── */

function scoreItem(item: ItemDescriptor, cues: string[], preferNeutral: boolean): number {
  let score = 0;
  const haystack = `${item.subcategory} ${item.color} ${item.tags.join(" ")}`.toLowerCase();
  for (const cue of cues) {
    if (haystack.includes(cue)) score += 3;
  }
  if (preferNeutral && isNeutral(item.color)) score += 2;
  if (item.color) score += 1;
  return score;
}

function pick(
  pool: ItemDescriptor[],
  category: ItemDescriptor["category"],
  cues: string[],
  exclude: Set<string>,
  preferNeutral: boolean,
): ItemDescriptor | undefined {
  const candidates = pool.filter(
    (item) => item.category === category && !exclude.has(item.id),
  );
  if (candidates.length === 0) return undefined;
  candidates.sort(
    (a, b) => scoreItem(b, cues, preferNeutral) - scoreItem(a, cues, preferNeutral),
  );
  return candidates[0];
}

function buildLayering(top?: ItemDescriptor, outer?: ItemDescriptor, mood?: MoodRecipe): string {
  if (!outer) {
    return mood
      ? `${mood.layeringStyle} Here the ${top?.subcategory ?? "top"} stands alone — keep the silhouette deliberate.`
      : "Single-layer composition; keep lines clean.";
  }
  return `${mood?.layeringStyle ?? ""} ${outer.color || "The"} ${outer.subcategory || "layer"} worn ${
    toneOf(top?.color ?? "") === toneOf(outer.color) ? "tone-on-tone" : "open"
  } over the ${top?.color ?? "base"} ${top?.subcategory ?? "top"}.`.trim();
}

function roleOfTarget(target: ItemDescriptor): "top" | "outer" | "bottom" | "footwear" | "accessory" {
  if (target.category === "tops") {
    return /jacket|blazer|hoodie|coat/i.test(target.subcategory) ? "outer" : "top";
  }
  if (target.category === "bottoms") return "bottom";
  if (target.category === "footwear") return "footwear";
  return "accessory";
}

export function heuristicCompose(ctx: StylingContext): OutfitPlan[] {
  const recipe = RECIPES[ctx.mood];
  const pool = ctx.wardrobe.filter((item) => item.kind === "item");
  const outfits: OutfitPlan[] = [];
  const preferNeutral = ctx.mood === "premium" || ctx.mood === "minimal" || ctx.mood === "formal";

  // Cross-variant history guarantees three DISTINCT looks whenever the pool allows.
  const history = {
    top: new Set<string>(),
    outer: new Set<string>(),
    bottom: new Set<string>(),
    footwear: new Set<string>(),
    acc: new Set<string>(),
  };
  const variedPick = (
    source: ItemDescriptor[],
    category: ItemDescriptor["category"],
    cues: string[],
    exclude: Set<string>,
    historySet: Set<string>,
  ): ItemDescriptor | undefined => {
    const widened = new Set(exclude);
    for (const id of historySet) widened.add(id);
    return (
      pick(source, category, cues, widened, preferNeutral) ??
      pick(source, category, cues, exclude, preferNeutral)
    );
  };

  for (let variant = 0; variant < 3; variant += 1) {
    const used = new Set<string>();
    const plan: OutfitPlan = {
      name: recipe.names[variant],
      occasion: recipe.occasions[variant],
      itemIds: { accessories: [] },
      layering: "",
      colorRationale: "",
      accessoryNotes: "",
      confidence: Math.max(55, 94 - variant * 12),
    };

    // Targets are honored first, in their natural roles.
    for (const target of ctx.targets) {
      if (used.has(target.id)) continue;
      const role = roleOfTarget(target);
      if (role === "top" && variant !== 2) plan.itemIds.top ??= target.id;
      else if (role === "outer") plan.itemIds.outer ??= target.id;
      else if (role === "bottom") plan.itemIds.bottom ??= target.id;
      else if (role === "footwear") plan.itemIds.footwear ??= target.id;
      else if (role === "accessory") plan.itemIds.accessories.push(target.id);
      used.add(target.id);
    }

    if (!plan.itemIds.top) {
      const base = variedPick(
        pool.filter((t) => !/jacket|blazer|hoodie/i.test(t.subcategory)),
        "tops",
        recipe.topCues,
        used,
        history.top,
      );
      if (base) {
        plan.itemIds.top = base.id;
        used.add(base.id);
        history.top.add(base.id);
      }
    }
    if (
      !plan.itemIds.outer &&
      (variant !== 2 || ctx.mood === "formal" || ctx.mood === "premium" || ctx.mood === "festive")
    ) {
      const outerPool = pool.filter((t) => /jacket|blazer|hoodie/i.test(t.subcategory));
      const outer = variedPick(outerPool, "tops", recipe.outerCues, used, history.outer);
      if (outer) {
        plan.itemIds.outer = outer.id;
        used.add(outer.id);
        history.outer.add(outer.id);
      }
    }
    if (!plan.itemIds.bottom) {
      const bottom = variedPick(pool, "bottoms", recipe.bottomCues, used, history.bottom);
      if (bottom) {
        plan.itemIds.bottom = bottom.id;
        used.add(bottom.id);
        history.bottom.add(bottom.id);
      }
    }
    if (!plan.itemIds.footwear) {
      const footwear = variedPick(pool, "footwear", recipe.footwearCues, used, history.footwear);
      if (footwear) {
        plan.itemIds.footwear = footwear.id;
        used.add(footwear.id);
        history.footwear.add(footwear.id);
      }
    }
    while (plan.itemIds.accessories.length < (variant === 2 ? 1 : 2)) {
      const accessory = variedPick(pool, "accessories", recipe.accessoryCues, used, history.acc);
      if (!accessory) break;
      plan.itemIds.accessories.push(accessory.id);
      used.add(accessory.id);
      history.acc.add(accessory.id);
    }

    const byId = new Map(pool.map((item) => [item.id, item]));
    const top = plan.itemIds.top ? byId.get(plan.itemIds.top) : undefined;
    const outer = plan.itemIds.outer ? byId.get(plan.itemIds.outer) : undefined;
    const bottom = plan.itemIds.bottom ? byId.get(plan.itemIds.bottom) : undefined;
    const footwear = plan.itemIds.footwear ? byId.get(plan.itemIds.footwear) : undefined;
    const accessories = plan.itemIds.accessories
      .map((id) => byId.get(id))
      .filter((x): x is ItemDescriptor => Boolean(x));

    const palette = [top?.color, outer?.color, bottom?.color, footwear?.color].filter(
      (c): c is string => Boolean(c),
    );

    plan.layering = buildLayering(top, outer, recipe);
    plan.colorRationale = `Built on ${describePalette(palette)}.${
      footwear ? ` ${footwear.color || "The"} ${footwear.subcategory.toLowerCase()} closes the column without stealing focus.` : ""
    }`;
    plan.accessoryNotes =
      accessories.length > 0
        ? `${accessories
            .map((a) => `${a.color ? `${a.color.toLowerCase()} ` : ""}${a.subcategory.toLowerCase()}`)
            .join(" + ")} — restrained, deliberate, and proportioned to the brief.`
        : "No accessory needed: the silhouette carries the statement on its own.";

    // Deduplicate near-identical plans.
    const signature = JSON.stringify([
      plan.itemIds.top,
      plan.itemIds.outer,
      plan.itemIds.bottom,
      plan.itemIds.footwear,
    ]);
    if (!outfits.some((o) => JSON.stringify([o.itemIds.top, o.itemIds.outer, o.itemIds.bottom, o.itemIds.footwear]) === signature)) {
      outfits.push(plan);
    }
  }

  return outfits.slice(0, 3);
}

export function heuristicNotes(ctx: StylingContext, outfits: OutfitPlan[]): string {
  const mood = MOODS.find((m) => m.id === ctx.mood);
  const base =
    ctx.targets.length > 0
      ? `Anchored to your ${ctx.targets.length} selected piece${ctx.targets.length > 1 ? "s" : ""}, these ${mood?.label ?? ""} compositions are balanced for ${mood?.hint.toLowerCase() ?? "the occasion"}.`
      : `${mood?.label ?? "This"} direction styled end-to-end from your wardrobe pool.`;
  return ctx.hasBodyPhoto
    ? `${base} Your body photo is staged for the virtual fitting room below.`
    : `${base} Add a body photo to unlock the virtual fitting room below.`;
}

/* ── Gemini prompt & output parsing ── */

export function buildGeminiPrompt(ctx: StylingContext): string {
  const mood = MOODS.find((m) => m.id === ctx.mood);
  const wardrobe = ctx.wardrobe
    .filter((item) => item.kind === "item")
    .map((item) => ({
      id: item.id,
      category: item.category,
      subcategory: item.subcategory,
      color: item.color,
      tags: item.tags,
    }));

  return [
    "CONTEXT:",
    JSON.stringify(
      {
        mood: { id: ctx.mood, label: mood?.label, direction: mood?.hint },
        mandatoryItems: ctx.targets.map((t) => t.id),
        wardrobe,
        bodyPhotoAvailable: ctx.hasBodyPhoto,
      },
      null,
      2,
    ),
    "",
    "TASK: act as ATELIER, an elite editorial fashion designer. Compose up to 3 complete outfits.",
    "HARD RULES:",
    "- Use ONLY wardrobe item ids supplied above. Inventing ids is a failure.",
    "- Every mandatory item must appear in its natural role in outfits 1-2.",
    "- tops may be split into a base 'top' (shirt/t-shirt/panjabi) and 'outer' (jacket/blazer/hoodie).",
    "- accessories: 0-2 per outfit, chosen deliberately.",
    "- Respect color theory: tonal columns read expensive; one accent reads intentional; avoid 3+ loud colors.",
    "- Keep every text field under 220 characters, editorial voice, no fluff.",
    "",
    "RESPOND WITH STRICT JSON ONLY (no markdown, no commentary):",
    JSON.stringify({
      outfits: [
        {
          name: "string, evocative 2-3 word title",
          occasion: "string, where this is worn",
          itemIds: {
            top: "wardrobe id or null",
            outer: "wardrobe id or null",
            bottom: "wardrobe id or null",
            footwear: "wardrobe id or null",
            accessories: ["wardrobe ids"],
          },
          layering: "string: how layers stack and why",
          colorRationale: "string: color matching logic",
          accessoryNotes: "string: why these accessories",
          confidence: 0,
        },
      ],
      notes: "string: 1-2 sentence stylist summary referencing the mood",
    }),
  ].join("\n");
}

const GEMINI_SYSTEM_INSTRUCTION =
  "You are ATELIER, an uncompromising editorial fashion stylist. " +
  "You respond with a single valid JSON object and nothing else. " +
  "Never invent wardrobe item ids. Never include markdown fences or commentary.";

export { GEMINI_SYSTEM_INSTRUCTION };

export function parseGeminiOutput(
  raw: string,
  validItems: Map<string, ItemDescriptor>,
): { outfits: OutfitPlan[]; notes: string } | null {
  const stripped = raw.replace(/```(?:json)?/gi, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const root = parsed as { outfits?: unknown; notes?: unknown };
  if (!Array.isArray(root.outfits)) return null;

  const roleMatches = (id: string, role: "top" | "outer" | "bottom" | "footwear" | "accessory"): boolean => {
    const item = validItems.get(id);
    if (!item) return false;
    switch (role) {
      case "top":
        return item.category === "tops" && !/jacket|blazer|hoodie/i.test(item.subcategory);
      case "outer":
        return item.category === "tops" && /jacket|blazer|hoodie|coat/i.test(item.subcategory);
      case "bottom":
        return item.category === "bottoms";
      case "footwear":
        return item.category === "footwear";
      case "accessory":
        return item.category === "accessories";
    }
  };

  const outfits: OutfitPlan[] = [];
  for (const entry of root.outfits.slice(0, 3)) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const ids = (e.itemIds ?? {}) as Record<string, unknown>;

    const role = (key: "top" | "outer" | "bottom" | "footwear"): string | undefined => {
      const value = ids[key];
      if (typeof value === "string" && roleMatches(value, key)) return value;
      return undefined;
    };

    const accessories = Array.isArray(ids.accessories)
      ? ids.accessories
          .filter((id): id is string => typeof id === "string" && roleMatches(id, "accessory"))
          .slice(0, 3)
      : [];

    const confidence =
      typeof e.confidence === "number" && Number.isFinite(e.confidence)
        ? Math.min(100, Math.max(0, Math.round(e.confidence)))
        : 70;

    outfits.push({
      name: clampText(e.name, 60) || "Untitled Look",
      occasion: clampText(e.occasion, 60) || "Anywhere",
      itemIds: {
        top: role("top"),
        outer: role("outer"),
        bottom: role("bottom"),
        footwear: role("footwear"),
        accessories,
      },
      layering: clampText(e.layering, 400),
      colorRationale: clampText(e.colorRationale, 400),
      accessoryNotes: clampText(e.accessoryNotes, 300),
      confidence,
    });
  }

  const meaningful = outfits.filter(
    (o) => o.itemIds.top || o.itemIds.bottom || o.itemIds.footwear || o.itemIds.outer,
  );
  if (meaningful.length === 0) return null;

  return { outfits: meaningful, notes: clampText(root.notes, 400) };
}
