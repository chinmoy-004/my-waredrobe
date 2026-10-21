/**
 * Strict Mongoose model — the ONLY persistence layer in the app (MongoDB).
 * Unknown fields are stripped (strict mode), key fields are immutable, URLs
 * must be Cloudinary deliveries, and lengths stay bounded end-to-end.
 */

import mongoose, { Schema, type Model } from "mongoose";
import type { Category, Kind } from "@/lib/domain";

export interface IWardrobeItem {
  kind: Kind;
  category: Category;
  subcategory?: string;
  color?: string;
  tags: string[];
  imageUrl: string;
  publicId: string;
  width?: number;
  height?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const CLOUDINARY_URL_PATTERN = /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/\S+$/;
const PUBLIC_ID_PATTERN = /^[a-zA-Z0-9_\-/.]+$/;

const WardrobeItemSchema = new Schema<IWardrobeItem>(
  {
    kind: {
      type: String,
      enum: ["item", "profile"],
      required: true,
      immutable: true,
    },
    category: {
      type: String,
      enum: ["tops", "bottoms", "footwear", "accessories", "profile"],
      required: true,
      immutable: true,
    },
    subcategory: { type: String, trim: true, maxlength: 40, default: "" },
    color: { type: String, trim: true, maxlength: 40, default: "" },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (value: string[]) =>
          Array.isArray(value) &&
          value.length <= 10 &&
          value.every((tag) => typeof tag === "string" && tag.length <= 24),
        message: "invalid-tags",
      },
    },
    imageUrl: {
      type: String,
      required: true,
      maxlength: 600,
      match: [CLOUDINARY_URL_PATTERN, "invalid-image-url"],
    },
    publicId: {
      type: String,
      required: true,
      maxlength: 180,
      match: [PUBLIC_ID_PATTERN, "invalid-public-id"],
    },
    width: { type: Number, min: 1, max: 10000 },
    height: { type: Number, min: 1, max: 10000 },
  },
  {
    timestamps: true,
    strict: true, // silently strip any unexpected/operator-shaped keys
    versionKey: false,
  },
);

WardrobeItemSchema.index({ createdAt: -1 });
WardrobeItemSchema.index({ kind: 1, category: 1, createdAt: -1 });

export type WardrobeItemModel = Model<IWardrobeItem>;

export const WardrobeItem: WardrobeItemModel =
  (mongoose.models.WardrobeItem as WardrobeItemModel | undefined) ??
  mongoose.model<IWardrobeItem>("WardrobeItem", WardrobeItemSchema);
