/**
 * Strict Zod contracts for every inbound payload.
 * `strictObject` REJECTS any unexpected extra key (request-tampering shield),
 * lengths are bounded (payload-bomb shield) and every string is further
 * sanitized before touching Mongoose (NoSQL injection shield).
 */

import { z } from "zod";
import { isAllowedImageRef } from "./domain";

const CATEGORY_LITERALS = ["tops", "bottoms", "footwear", "accessories", "profile"] as const;
const KIND_LITERALS = ["item", "profile"] as const;
const MOOD_LITERALS = ["bold", "premium", "streetwear", "formal", "party", "festive", "minimal"] as const;

/* ── POST /api/upload-signature ── */
export const signatureBodySchema = z.strictObject({
  purpose: z.enum(["wardrobe", "profiles"]),
});
export type SignatureBodyInput = z.infer<typeof signatureBodySchema>;

/* ── POST /api/upload (metadata persistence after a signed Cloudinary upload) ── */
export const wardrobeMetadataSchema = z
  .strictObject({
    kind: z.enum(KIND_LITERALS),
    category: z.enum(CATEGORY_LITERALS),
    subcategory: z.string().trim().max(40).optional(),
    color: z.string().trim().max(40).optional(),
    tags: z.array(z.string().trim().max(24)).max(10).optional(),
    imageUrl: z.string().trim().min(16).max(600),
    publicId: z
      .string()
      .trim()
      .min(4)
      .max(180)
      .regex(/^[a-zA-Z0-9_\-/.]+$/, "invalid-public-id"),
    width: z.number().int().positive().max(10000).optional(),
    height: z.number().int().positive().max(10000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "profile" && value.category !== "profile") {
      ctx.addIssue({ code: "custom", message: "kind-category-mismatch" });
    }
    if (value.kind === "item" && value.category === "profile") {
      ctx.addIssue({ code: "custom", message: "kind-category-mismatch" });
    }
  });
export type WardrobeMetadataInput = z.infer<typeof wardrobeMetadataSchema>;

/* ── POST /api/stylist ── */
const descriptorSchema = z.strictObject({
  id: z.string().trim().min(1).max(64),
  kind: z.enum(KIND_LITERALS),
  category: z.enum(CATEGORY_LITERALS),
  subcategory: z.string().trim().max(40).optional(),
  color: z.string().trim().max(40).optional(),
  tags: z.array(z.string().trim().max(24)).max(10).optional(),
});

export const stylistBodySchema = z.strictObject({
  mood: z.enum(MOOD_LITERALS),
  targetItemIds: z.array(z.string().trim().min(1).max(64)).max(24).optional(),
  // Only consulted in demo mode (no MongoDB configured); server re-reads from DB otherwise.
  items: z.array(descriptorSchema).max(60).optional(),
  bodyPhotoId: z.string().trim().max(64).optional(),
});
export type StylistBodyInput = z.infer<typeof stylistBodySchema>;

const imageRef = (max: number) =>
  z
    .string()
    .min(16)
    .max(max)
    .refine(isAllowedImageRef, { message: "disallowed-image-ref" });

/* ── POST /api/tryon ── */
export const tryonBodySchema = z.strictObject({
  bodyImageUrl: imageRef(52_428_800),
  garmentImageUrl: imageRef(52_428_800),
  garmentDescription: z.string().trim().max(180).optional(),
});
export type TryonBodyInput = z.infer<typeof tryonBodySchema>;
