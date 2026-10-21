/**
 * Domain constants shared between client and server.
 * NOTE: This module must stay free of environment access so it can be
 * imported by client components safely.
 */

export const CATEGORIES = [
  "tops",
  "bottoms",
  "footwear",
  "accessories",
  "profile",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const KINDS = ["item", "profile"] as const;
export type Kind = (typeof KINDS)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  tops: "Tops",
  bottoms: "Bottoms",
  footwear: "Footwear",
  accessories: "Accessories",
  profile: "Body Photos",
};

export const SUBCATEGORIES: Record<Exclude<Category, "profile">, string[]> = {
  tops: ["Shirt", "T-Shirt", "Panjabi", "Jacket", "Blazer", "Hoodie", "Sweater", "Kurta"],
  bottoms: ["Pants", "Jeans", "Shorts", "Chinos", "Joggers"],
  footwear: ["Shoes", "Sneakers", "Boots", "Loafers", "Sandals"],
  accessories: ["Watch", "Ring", "Sunglasses", "Bracelet", "Cap", "Belt", "Chain"],
};

export const MOODS = [
  { id: "bold", label: "Bold Look", hint: "High-contrast statement dressing" },
  { id: "premium", label: "Expensive / Premium", hint: "Quiet luxury, tonal layering" },
  { id: "streetwear", label: "Casual Streetwear", hint: "Relaxed proportions, sneakers first" },
  { id: "formal", label: "Formal Business", hint: "Sharp tailoring, polished finish" },
  { id: "party", label: "Party & Night-Out", hint: "Sheen, contrast, one hero piece" },
  { id: "festive", label: "Festive / Panjabi", hint: "Celebration-ready traditional accents" },
  { id: "minimal", label: "Clean Minimal", hint: "Few pieces, perfect fit" },
] as const;
export type MoodId = (typeof MOODS)[number]["id"];
export const MOOD_IDS = MOODS.map((m) => m.id) as [MoodId, ...MoodId[]];

/* ── Upload policy (mirrored server-side; never trust the client alone) ── */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB hard cap
export const ALLOWED_IMAGE_MIME = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/tif",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
] as const;
export const CLOUDINARY_DELIVERY_HOST = "res.cloudinary.com";
export const CLOUDINARY_UPLOAD_FOLDERS = ["atelier/wardrobe", "atelier/profiles"] as const;

/* ── Shared shapes ── */
export interface WardrobeItemView {
  id: string;
  kind: Kind;
  category: Category;
  subcategory: string;
  color: string;
  tags: string[];
  imageUrl: string;
  width?: number;
  height?: number;
  createdAt: string | null;
  /** true when the item only exists in the session (demo mode, not persisted). */
  local?: boolean;
}

export interface ItemDescriptor {
  id: string;
  kind: Kind;
  category: Category;
  subcategory: string;
  color: string;
  tags: string[];
}

export interface ServiceStatus {
  mongo: boolean;
  cloudinary: boolean;
  gemini: boolean;
  huggingFace: boolean;
  cloudName: string | null;
  demo: boolean;
}

export interface OutfitPlan {
  name: string;
  occasion: string;
  itemIds: {
    top?: string;
    outer?: string;
    bottom?: string;
    footwear?: string;
    accessories: string[];
  };
  layering: string;
  colorRationale: string;
  accessoryNotes: string;
  confidence: number;
}

export interface StylistOutput {
  engine: "gemini" | "atelier-rules";
  mood: string;
  outfits: OutfitPlan[];
  notes: string;
  generatedAt: string;
}

export interface TryonResult {
  imageUrl: string;
  provider: "idm-vton" | "simulation";
  simulated: boolean;
  note: string;
}

/* ── Reference validators (URLs pointing at imagery we are willing to fetch) ── */
export function isCloudinaryDeliveryUrl(url: string, cloudName: string | null): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== CLOUDINARY_DELIVERY_HOST) return false;
    if (!parsed.pathname.includes("/image/upload/")) return false;
    if (cloudName && !parsed.pathname.startsWith(`/${cloudName}/`)) return false;
    return true;
  } catch {
    return false;
  }
}

const DATA_IMAGE_PATTERN = /^data:image\/[a-zA-Z0-9.+_-]+;base64,[A-Za-z0-9+/=]+$/;
const LOCAL_ASSET_PATTERN = /^\/images\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/;

/** Accepts only: our Cloudinary deliveries, in-session data-URL captures, or bundled demo assets. */
export function isAllowedImageRef(ref: string): boolean {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 7_500_000) return false;
  if (ref.startsWith("data:")) return DATA_IMAGE_PATTERN.test(ref);
  if (ref.startsWith("/images/")) return LOCAL_ASSET_PATTERN.test(ref);
  if (ref.startsWith("https://")) return isCloudinaryDeliveryUrl(ref, null);
  return false;
}
