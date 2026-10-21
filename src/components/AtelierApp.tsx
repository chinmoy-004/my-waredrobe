"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Camera,
  Check,
  Footprints,
  Gem,
  Layers,
  Loader2,
  Lock,
  PersonStanding,
  Plus,
  Scan,
  ShieldCheck,
  Shirt,
  Sparkles,
  Trash2,
  Upload,
  Watch,
  X,
} from "lucide-react";
import CameraCapture from "./CameraCapture";
import {
  CATEGORY_LABELS,
  MOODS,
  SUBCATEGORIES,
  type Category,
  type ItemDescriptor,
  type Kind,
  type MoodId,
  type OutfitPlan,
  type ServiceStatus,
  type StylistOutput,
  type TryonResult,
  type WardrobeItemView,
} from "@/lib/domain";
import {
  ApiError,
  apiFetch,
  dataUrlToFile,
  fileToDataUrl,
  newClientId,
  validateClientImage,
} from "@/lib/client-api";

/* ─────────────────────────── constants ─────────────────────────── */

const FILTER_TABS: Array<Category | "all"> = [
  "all",
  "tops",
  "bottoms",
  "footwear",
  "accessories",
  "profile",
];

const CATEGORY_ICONS: Record<Category, ComponentType<{ className?: string }>> = {
  tops: Shirt,
  bottoms: Layers,
  footwear: Footprints,
  accessories: Watch,
  profile: PersonStanding,
};

const MARQUEE_WORDS = [
  "CURATED WARDROBE",
  "GEMINI STYLIST",
  "IDM-VTON FITTING ROOM",
  "SIGNED CLOUDINARY UPLOADS",
  "ZERO-TRUST BY DESIGN",
  "MONGODB ATLAS",
];

const DEMO_SEED: WardrobeItemView[] = [
  { id: "seed-blazer", kind: "item", category: "tops", subcategory: "Blazer", color: "Charcoal", tags: ["tailored", "wool"], imageUrl: "/images/garment-blazer.jpg", createdAt: null, local: true },
  { id: "seed-tee", kind: "item", category: "tops", subcategory: "T-Shirt", color: "Ivory", tags: ["heavyweight", "minimal"], imageUrl: "/images/garment-tshirt.jpg", createdAt: null, local: true },
  { id: "seed-pants", kind: "item", category: "bottoms", subcategory: "Pants", color: "Black", tags: ["pleated"], imageUrl: "/images/garment-pants.jpg", createdAt: null, local: true },
  { id: "seed-sneakers", kind: "item", category: "footwear", subcategory: "Sneakers", color: "White", tags: ["leather"], imageUrl: "/images/garment-sneakers.jpg", createdAt: null, local: true },
  { id: "seed-watch", kind: "item", category: "accessories", subcategory: "Watch", color: "Steel & Onyx", tags: ["minimal"], imageUrl: "/images/garment-watch.jpg", createdAt: null, local: true },
  { id: "seed-body", kind: "profile", category: "profile", subcategory: "Body Photo", color: "", tags: ["studio", "reference"], imageUrl: "/images/body-sample.jpg", createdAt: null, local: true },
];

interface Draft {
  kind: Kind;
  category: Category;
  subcategory: string;
  color: string;
  tags: string[];
}

interface SignatureResponse {
  signature: string;
  timestamp: number;
  folder: string;
  cloudName: string;
  apiKey: string;
}

const jsonInit = (payload: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

function emptyDraft(category: Category = "tops"): Draft {
  if (category === "profile") {
    return { kind: "profile", category: "profile", subcategory: "Body Photo", color: "", tags: [] };
  }
  return { kind: "item", category, subcategory: SUBCATEGORIES[category as Exclude<Category, "profile">][0], color: "", tags: [] };
}

const sanitizeClientTag = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, "").slice(0, 24);

/* ─────────────────────────── micro components ─────────────────────────── */

function StatusDot({ active, label }: { active: boolean; label: string }) {
  return (
    <span className="group relative inline-flex items-center gap-1.5">
      <span className="relative flex h-1.5 w-1.5">
        {active && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
            active ? "bg-emerald-400" : "bg-gold/50"
          }`}
        />
      </span>
      <span className="text-[10px] uppercase tracking-[0.18em] text-mute">{label}</span>
    </span>
  );
}

function SectionHeading({
  index,
  overline,
  title,
  copy,
}: {
  index: string;
  overline: string;
  title: string;
  copy: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="mb-12 flex flex-col gap-4 md:mb-16 md:flex-row md:items-end md:justify-between"
    >
      <div>
        <p className="flex items-center gap-3 text-[10px] uppercase tracking-[0.35em] text-gold">
          <span className="h-px w-8 bg-gold/60" />
          {index} — {overline}
        </p>
        <h2 className="mt-4 font-display text-4xl leading-[1.05] text-ivory md:text-6xl">{title}</h2>
      </div>
      <p className="max-w-sm text-sm leading-relaxed text-mute">{copy}</p>
    </motion.div>
  );
}

function ItemCard({
  item,
  selected,
  busy,
  onToggleSelect,
  onRemove,
}: {
  item: WardrobeItemView;
  selected: boolean;
  busy: boolean;
  onToggleSelect: () => void;
  onRemove: () => void;
}) {
  const Icon = CATEGORY_ICONS[item.category];
  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={`group relative overflow-hidden rounded-xl border bg-coal transition-colors ${
        selected ? "border-gold/70" : "border-line hover:border-gold/35"
      }`}
    >
      <button
        type="button"
        onClick={onToggleSelect}
        aria-pressed={selected}
        aria-label={`Select ${item.subcategory}`}
        className="block w-full"
      >
        <div className="relative aspect-[3/4] overflow-hidden">
          <img
            src={item.imageUrl}
            alt={`${item.color} ${item.subcategory}`.trim() || item.subcategory}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-transparent to-ink/10" />
          <span
            className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border backdrop-blur transition ${
              selected ? "border-gold bg-gold text-ink" : "border-ivory/30 bg-ink/40 text-transparent"
            }`}
          >
            <Check className="h-3.5 w-3.5" />
          </span>
          {item.local && (
            <span className="absolute left-3 top-3 rounded-full border border-ivory/15 bg-ink/50 px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-ivory/70 backdrop-blur">
              session
            </span>
          )}
        </div>
        <div className="absolute inset-x-0 bottom-0 p-3.5 text-left">
          <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.25em] text-gold">
            <Icon className="h-3 w-3" />
            {CATEGORY_LABELS[item.category]}
          </p>
          <p className="mt-1 font-display text-base leading-tight text-ivory">
            {item.color ? `${item.color} ` : ""}
            {item.subcategory || CATEGORY_LABELS[item.category]}
          </p>
          {item.tags.length > 0 && (
            <p className="mt-1 truncate text-[10px] tracking-wide text-mute">
              {item.tags.map((t) => `#${t}`).join("  ")}
            </p>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.subcategory}`}
        disabled={busy}
        className="absolute bottom-3.5 right-3.5 rounded-full border border-ivory/15 bg-ink/60 p-2 text-mute opacity-0 backdrop-blur transition hover:border-ember/60 hover:text-ember group-hover:opacity-100 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </motion.article>
  );
}

function ThumbButton({
  item,
  active,
  onClick,
  label,
}: {
  item: WardrobeItemView;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border transition ${
        active ? "border-gold" : "border-line hover:border-gold/40"
      }`}
    >
      <img src={item.imageUrl} alt={label} className="h-full w-full object-cover" />
      {active && (
        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gold text-ink">
          <Check className="h-2.5 w-2.5" />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-ink/70 px-1.5 py-1 text-left text-[8px] uppercase tracking-[0.15em] text-ivory/80">
        {item.subcategory}
      </span>
    </button>
  );
}

/* ─────────────────────────── main application ─────────────────────────── */

export default function AtelierApp() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [items, setItems] = useState<WardrobeItemView[]>(DEMO_SEED);
  const [filter, setFilter] = useState<Category | "all">("all");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [tagInput, setTagInput] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);

  const [selected, setSelected] = useState<string[]>([]);
  const [mood, setMood] = useState<MoodId>("premium");
  const [bodyId, setBodyId] = useState<string | null>("seed-body");
  const [garmentId, setGarmentId] = useState<string | null>(null);

  const [stylist, setStylist] = useState<StylistOutput | null>(null);
  const [stylistBusy, setStylistBusy] = useState(false);
  const [tryon, setTryon] = useState<TryonResult | null>(null);
  const [tryonBusy, setTryonBusy] = useState(false);

  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stylistSectionRef = useRef<HTMLDivElement | null>(null);
  const fittingResultRef = useRef<HTMLDivElement | null>(null);

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const profileItems = useMemo(() => items.filter((i) => i.kind === "profile"), [items]);
  const topItems = useMemo(
    () => items.filter((i) => i.kind === "item" && i.category === "tops"),
    [items],
  );
  const filteredItems = useMemo(
    () =>
      items.filter((i) =>
        filter === "all"
          ? true
          : filter === "profile"
            ? i.kind === "profile"
            : i.kind === "item" && i.category === filter,
      ),
    [items, filter],
  );

  const effectiveBodyId =
    bodyId && byId.get(bodyId)?.kind === "profile" ? bodyId : (profileItems[0]?.id ?? null);
  const effectiveGarmentId =
    garmentId && topItems.some((t) => t.id === garmentId) ? garmentId : (topItems[0]?.id ?? null);

  /* ── bootstrap service status + persisted wardrobe ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meta = await apiFetch<ServiceStatus>("/api/meta");
        if (cancelled) return;
        setStatus(meta);
        if (meta.mongo) {
          const wardrobe = await apiFetch<{ demo: boolean; items: WardrobeItemView[] }>(
            "/api/wardrobe",
          );
          if (!cancelled && !wardrobe.demo) setItems(wardrobe.items);
        }
      } catch {
        if (!cancelled) {
          setStatus({
            mongo: false,
            cloudinary: false,
            gemini: false,
            huggingFace: false,
            cloudName: null,
            demo: true,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── toast lifecycle ── */
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4600);
    return () => clearTimeout(timer);
  }, [toast]);

  /* ── ingestion pipeline: validate → sign → upload → persist ── */
  const ingestFiles = useCallback(
    async (files: File[], atDraft: Draft) => {
      if (files.length === 0) return;
      setSaving(true);
      try {
        const added: WardrobeItemView[] = [];
        for (const file of files.slice(0, 3)) {
          validateClientImage(file);

          if (status?.cloudinary) {
            const sig = await apiFetch<SignatureResponse>(
              "/api/upload-signature",
              jsonInit({ purpose: atDraft.kind === "profile" ? "profiles" : "wardrobe" }),
            );
            const form = new FormData();
            form.append("file", file);
            form.append("api_key", sig.apiKey);
            form.append("timestamp", String(sig.timestamp));
            form.append("signature", sig.signature);
            form.append("folder", sig.folder);

            const uploadRes = await fetch(
              `https://api.cloudinary.com/v1_1/${encodeURIComponent(sig.cloudName)}/image/upload`,
              { method: "POST", body: form },
            );
            const uploadData: unknown = await uploadRes.json().catch(() => null);
            const record =
              uploadData && typeof uploadData === "object"
                ? (uploadData as Record<string, unknown>)
                : null;
            if (
              !uploadRes.ok ||
              !record ||
              typeof record.secure_url !== "string" ||
              typeof record.public_id !== "string"
            ) {
              throw new ApiError("The cloud rejected this upload.", uploadRes.status || 502);
            }

            const metadata = {
              kind: atDraft.kind,
              category: atDraft.category,
              subcategory: atDraft.subcategory,
              color: atDraft.color,
              tags: atDraft.tags,
              imageUrl: record.secure_url,
              publicId: record.public_id,
              ...(typeof record.width === "number" ? { width: Math.round(record.width) } : {}),
              ...(typeof record.height === "number" ? { height: Math.round(record.height) } : {}),
            };

            try {
              const saved = await apiFetch<{ item: WardrobeItemView }>(
                "/api/upload",
                jsonInit(metadata),
              );
              added.push(saved.item);
            } catch {
              // MongoDB not wired yet: keep the Cloudinary-hosted URL for this session.
              added.push({
                id: newClientId(),
                kind: atDraft.kind,
                category: atDraft.category,
                subcategory: atDraft.subcategory,
                color: atDraft.color,
                tags: atDraft.tags,
                imageUrl: record.secure_url,
                createdAt: null,
                local: true,
              });
            }
          } else {
            const dataUrl = await fileToDataUrl(file);
            added.push({
              id: newClientId(),
              kind: atDraft.kind,
              category: atDraft.category,
              subcategory: atDraft.subcategory,
              color: atDraft.color,
              tags: atDraft.tags,
              imageUrl: dataUrl,
              createdAt: null,
              local: true,
            });
          }
        }

        setItems((prev) => [...added, ...prev]);
        setToast(
          added.length > 1
            ? `${added.length} pieces joined the wardrobe.`
            : "The piece joined your wardrobe.",
        );
        setDrawerOpen(false);
      } catch (error) {
        setToast(error instanceof ApiError ? error.message : "Upload failed — please try again.");
      } finally {
        setSaving(false);
      }
    },
    [status],
  );

  const openCamera = useCallback(() => setCameraOpen(true), []);

  const handleCameraCapture = useCallback(
    (dataUrl: string) => {
      setCameraOpen(false);
      try {
        const file = dataUrlToFile(dataUrl, `capture-${Date.now()}.jpg`);
        void ingestFiles([file], draft);
      } catch (error) {
        setToast(error instanceof ApiError ? error.message : "Capture failed.");
      }
    },
    [draft, ingestFiles],
  );

  const removeItem = useCallback(
    async (item: WardrobeItemView) => {
      setBusyId(item.id);
      try {
        if (!item.local && status?.mongo) {
          await apiFetch(`/api/wardrobe/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        }
        setItems((prev) => prev.filter((x) => x.id !== item.id));
        setSelected((prev) => prev.filter((id) => id !== item.id));
        if (bodyId === item.id) setBodyId(null);
        if (garmentId === item.id) setGarmentId(null);
      } catch {
        setToast("Could not remove the piece. Try again.");
      } finally {
        setBusyId(null);
      }
    },
    [bodyId, garmentId, status],
  );

  const toggleSelect = useCallback(
    (id: string) => {
      setSelected((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id);
        if (prev.length >= 8) {
          setToast("The styling rack holds eight pieces at most.");
          return prev;
        }
        return [...prev, id];
      });
    },
    [],
  );

  const addTag = useCallback(() => {
    const clean = sanitizeClientTag(tagInput);
    if (!clean) return;
    setDraft((d) => (d.tags.includes(clean) || d.tags.length >= 6 ? d : { ...d, tags: [...d.tags, clean] }));
    setTagInput("");
  }, [tagInput]);

  /* ── AI stylist ── */
  const composeLooks = useCallback(async () => {
    setStylistBusy(true);
    try {
      const descriptors: ItemDescriptor[] = items.map((item) => ({
        id: item.id,
        kind: item.kind,
        category: item.category,
        subcategory: item.subcategory,
        color: item.color,
        tags: item.tags,
      }));
      const payload = status?.mongo
        ? {
            mood,
            targetItemIds: selected,
            ...(effectiveBodyId ? { bodyPhotoId: effectiveBodyId } : {}),
          }
        : {
            mood,
            targetItemIds: selected,
            items: descriptors,
            ...(effectiveBodyId ? { bodyPhotoId: effectiveBodyId } : {}),
          };
      const output = await apiFetch<StylistOutput>("/api/stylist", jsonInit(payload));
      setStylist(output);
      requestAnimationFrame(() =>
        stylistSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } catch (error) {
      setToast(error instanceof ApiError ? error.message : "The stylist is unavailable right now.");
    } finally {
      setStylistBusy(false);
    }
  }, [effectiveBodyId, items, mood, selected, status]);

  /* ── virtual fitting room ── */
  const runFitting = useCallback(async () => {
    const bodyItem = effectiveBodyId ? byId.get(effectiveBodyId) : undefined;
    const garmentItem = effectiveGarmentId ? byId.get(effectiveGarmentId) : undefined;
    if (!bodyItem || !garmentItem) {
      setToast("Stage a body photo and an upper garment first.");
      return;
    }
    setTryonBusy(true);
    try {
      const result = await apiFetch<TryonResult>(
        "/api/tryon",
        jsonInit({
          bodyImageUrl: bodyItem.imageUrl,
          garmentImageUrl: garmentItem.imageUrl,
          garmentDescription: `${garmentItem.color} ${garmentItem.subcategory}`.trim(),
        }),
      );
      setTryon(result);
      requestAnimationFrame(() =>
        fittingResultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      );
    } catch (error) {
      setToast(error instanceof ApiError ? error.message : "The fitting room is unavailable.");
    } finally {
      setTryonBusy(false);
    }
  }, [byId, effectiveBodyId, effectiveGarmentId]);

  /* ─────────────────────────── render ─────────────────────────── */

  return (
    <div className="relative min-h-screen">
      {/* ─── nav ─── */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-line/60 bg-ink/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
          <a href="#top" className="flex items-baseline gap-3">
            <span className="font-display text-2xl tracking-tight text-ivory">
              Atelier<span className="text-gold">.</span>
            </span>
            <span className="hidden text-[9px] uppercase tracking-[0.35em] text-mute sm:inline">
              Wardrobe Intelligence
            </span>
          </a>
          <div className="flex items-center gap-4">
            {status && (
              <div className="hidden items-center gap-4 md:flex">
                <StatusDot active={status.mongo} label="Mongo" />
                <StatusDot active={status.cloudinary} label="CDN" />
                <StatusDot active={status.gemini} label="Gemini" />
                <StatusDot active={status.huggingFace} label="VTON" />
              </div>
            )}
            <a
              href="#studio"
              className="hidden rounded-full border border-gold/40 px-4 py-1.5 text-[10px] uppercase tracking-[0.25em] text-gold transition hover:bg-gold hover:text-ink sm:inline-block"
            >
              Style me
            </a>
          </div>
        </div>
      </header>

      {/* ─── hero ─── */}
      <section id="top" className="relative overflow-hidden pt-32 md:pt-40">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 md:px-8 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-7">
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="flex items-center gap-3 text-[10px] uppercase tracking-[0.35em] text-gold"
            >
              <span className="h-px w-10 bg-gold/70" />
              Digital atelier — wardrobe OS
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="mt-6 font-display text-[13.5vw] leading-[0.98] text-ivory sm:text-7xl lg:text-[5.6rem]"
            >
              Your wardrobe,
              <br />
              styled by <em className="italic text-gold">intelligence.</em>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.35 }}
              className="mt-6 max-w-lg text-sm leading-relaxed text-mute md:text-base"
            >
              Catalogue every piece, let a Gemini-trained eye compose the look, then step into a
              photoreal fitting room rendered by open diffusion. Zero hosting cost — and zero trust
              given to the network.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.5 }}
              className="mt-10 flex flex-wrap items-center gap-4"
            >
              <a
                href="#wardrobe"
                className="group inline-flex items-center gap-3 rounded-full bg-gold px-7 py-3.5 text-xs font-semibold uppercase tracking-[0.25em] text-ink transition hover:bg-gold-soft"
              >
                Curate my wardrobe
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </a>
              <a
                href="#fitting"
                className="inline-flex items-center gap-3 rounded-full border border-line px-7 py-3.5 text-xs uppercase tracking-[0.25em] text-ivory transition hover:border-gold/50 hover:text-gold"
              >
                <Scan className="h-4 w-4" />
                Fitting room
              </a>
            </motion.div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.7 }}
              className="mt-12 flex flex-wrap gap-x-8 gap-y-4"
            >
              {[
                { icon: ShieldCheck, text: "Zero-trust API perimeter" },
                { icon: Lock, text: "Signed, server-minted uploads" },
                { icon: Gem, text: "$0 free-tier architecture" },
              ].map((f) => (
                <span key={f.text} className="flex items-center gap-2 text-[11px] tracking-wide text-mute">
                  <f.icon className="h-3.5 w-3.5 text-gold/80" />
                  {f.text}
                </span>
              ))}
            </motion.div>
          </div>

          <div className="relative lg:col-span-5">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="relative"
            >
              <div className="absolute -inset-3 rounded-2xl border border-gold/20" />
              <div className="relative overflow-hidden rounded-xl border border-line">
                <img
                  src="/images/hero.jpg"
                  alt="Editorial portrait in a tailored black overcoat"
                  className="aspect-[4/5] w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/60 via-transparent to-transparent" />
              </div>
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -left-4 bottom-10 rounded-xl border border-gold/30 bg-coal/90 px-5 py-4 backdrop-blur md:-left-10"
              >
                <p className="text-[9px] uppercase tracking-[0.3em] text-gold">Tonight&apos;s pick</p>
                <p className="mt-1.5 font-display text-xl italic text-ivory">Quiet Luxury</p>
                <p className="mt-1 text-[10px] tracking-wide text-mute">Confidence 96 · tonal column</p>
              </motion.div>
              <motion.div
                animate={{ y: [0, 10, 0] }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -right-3 top-8 rounded-full border border-line bg-coal/90 px-4 py-2 text-[10px] uppercase tracking-[0.25em] text-ivory/80 backdrop-blur md:-right-6"
              >
                3 fresh outfits
              </motion.div>
            </motion.div>
          </div>
        </div>

        {status?.demo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 }}
            className="mx-auto mt-14 max-w-7xl px-5 md:px-8"
          >
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/25 bg-gold/5 px-5 py-4">
              <ShieldCheck className="h-4 w-4 shrink-0 text-gold" />
              <p className="text-xs leading-relaxed text-gold-soft/90">
                <span className="font-semibold uppercase tracking-[0.2em]">Session demo</span>
                <span className="mx-2 text-gold/50">·</span>
                Fill the free-tier keys from{" "}
                <code className="rounded bg-ink/60 px-1.5 py-0.5 text-[11px] text-gold">
                  .env.local.example
                </code>{" "}
                to unlock Atlas persistence, Cloudinary CDN, Gemini styling &amp; the IDM-VTON render.
                Everything below is already fully interactive.
              </p>
            </div>
          </motion.div>
        )}
      </section>

      {/* ─── marquee ─── */}
      <div className="relative mt-20 overflow-hidden border-y border-line/70 py-4">
        <div className="flex w-max animate-marquee gap-10">
          {[...MARQUEE_WORDS, ...MARQUEE_WORDS].map((word, i) => (
            <span
              key={`${word}-${i}`}
              className="flex items-center gap-10 whitespace-nowrap text-[11px] uppercase tracking-[0.4em] text-mute"
            >
              {word}
              <span className="text-gold">✦</span>
            </span>
          ))}
        </div>
      </div>

      {/* ─── wardrobe ─── */}
      <section id="wardrobe" className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
        <SectionHeading
          index="01"
          overline="The Wardrobe"
          title="Every piece, catalogued."
          copy="Capture with the live camera or drop files — JPEG, PNG or WebP up to 5 MB, signed straight into Cloudinary and indexed in MongoDB. Every field is optional; add as little or as much as you like."
        />

        <div className="mb-8 flex flex-wrap items-center gap-2">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.22em] transition ${
                filter === tab
                  ? "border-gold bg-gold/10 text-gold"
                  : "border-line text-mute hover:border-gold/40 hover:text-ivory"
              }`}
            >
              {tab === "all" ? "All" : CATEGORY_LABELS[tab]}
            </button>
          ))}
        </div>

        <motion.div layout className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <AnimatePresence mode="popLayout">
            {filteredItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                selected={selected.includes(item.id)}
                busy={busyId === item.id}
                onToggleSelect={() => toggleSelect(item.id)}
                onRemove={() => void removeItem(item)}
              />
            ))}
          </AnimatePresence>

          <motion.button
            layout
            type="button"
            onClick={() => {
              setDraft(emptyDraft(filter === "all" ? "tops" : filter));
              setDrawerOpen(true);
            }}
            className="group flex aspect-[3/4] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-gold/30 bg-transparent transition hover:border-gold/60 hover:bg-gold/5"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 text-gold transition group-hover:scale-110">
              <Plus className="h-5 w-5" />
            </span>
            <span className="text-[10px] uppercase tracking-[0.3em] text-mute group-hover:text-gold">
              Add a piece
            </span>
          </motion.button>
        </motion.div>
      </section>

      {/* ─── studio ─── */}
      <section id="studio" className="border-t border-line/60 bg-coal/40">
        <div className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
          <SectionHeading
            index="02"
            overline="Styling Studio"
            title="Commission a look."
            copy="Pin the pieces that must appear — your Panjabi, that black trouser, the steel watch — choose a direction, and the engine composes the full silhouette with layering and colour logic."
          />

          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <p className="text-[10px] uppercase tracking-[0.3em] text-gold">Direction</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {MOODS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMood(m.id)}
                    title={m.hint}
                    className={`rounded-full border px-4 py-2.5 text-[11px] tracking-wide transition ${
                      mood === m.id
                        ? "border-gold bg-gold text-ink"
                        : "border-line text-mute hover:border-gold/40 hover:text-ivory"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <p className="mt-10 text-[10px] uppercase tracking-[0.3em] text-gold">
                Pinned pieces{" "}
                <span className="text-mute normal-case tracking-normal">
                  — tap cards above ({selected.length}/8)
                </span>
              </p>
              <div className="mt-4 flex min-h-16 flex-wrap gap-2">
                {selected.length === 0 && (
                  <span className="text-xs text-mute">
                    Nothing pinned — the stylist will compose freely from the whole wardrobe.
                  </span>
                )}
                <AnimatePresence>
                  {selected.map((id) => {
                    const item = byId.get(id);
                    if (!item) return null;
                    return (
                      <motion.span
                        key={id}
                        layout
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex items-center gap-2 rounded-full border border-gold/30 bg-ink/60 py-1 pl-1 pr-3 text-[11px] text-ivory"
                      >
                        <img src={item.imageUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                        {item.subcategory}
                        <button
                          type="button"
                          aria-label={`Unpin ${item.subcategory}`}
                          onClick={() => toggleSelect(id)}
                          className="text-mute transition hover:text-ember"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </motion.span>
                    );
                  })}
                </AnimatePresence>
              </div>

              <button
                type="button"
                onClick={() => void composeLooks()}
                disabled={stylistBusy}
                className="mt-10 inline-flex items-center gap-3 rounded-full bg-gold px-8 py-4 text-xs font-semibold uppercase tracking-[0.25em] text-ink transition hover:bg-gold-soft disabled:cursor-not-allowed disabled:opacity-60"
              >
                {stylistBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {stylistBusy ? "Consulting the stylist…" : "Compose my looks"}
              </button>
              <p className="mt-4 text-[11px] leading-relaxed text-mute">
                Rate-guarded endpoint · 12 commissions / minute · payloads strictly validated.
              </p>
            </div>

            <div ref={stylistSectionRef} className="lg:col-span-7">
              <AnimatePresence mode="wait">
                {stylist ? (
                  <motion.div
                    key={stylist.generatedAt}
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5 }}
                    className="space-y-5"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-display text-2xl italic text-ivory">
                        {MOODS.find((m) => m.id === stylist.mood)?.label} — {stylist.outfits.length}{" "}
                        compositions
                      </p>
                      <span
                        className={`rounded-full border px-3 py-1 text-[9px] uppercase tracking-[0.25em] ${
                          stylist.engine === "gemini"
                            ? "border-gold/50 bg-gold/10 text-gold"
                            : "border-line text-mute"
                        }`}
                      >
                        {stylist.engine === "gemini" ? "Google Gemini" : "Atelier rules"}
                      </span>
                    </div>
                    {stylist.outfits.map((outfit, idx) => (
                      <OutfitCard key={`${outfit.name}-${idx}`} outfit={outfit} byId={byId} index={idx} />
                    ))}
                    <p className="border-l-2 border-gold/40 pl-4 text-sm italic leading-relaxed text-mute">
                      {stylist.notes}
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex h-full min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-line p-10 text-center"
                  >
                    <Gem className="h-8 w-8 text-gold/50" />
                    <p className="mt-4 font-display text-xl italic text-ivory/80">
                      The rack is waiting.
                    </p>
                    <p className="mt-2 max-w-xs text-xs leading-relaxed text-mute">
                      Pin a few pieces, pick a direction, and commission up to three complete looks
                      with colour and layering rationale.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </section>

      {/* ─── fitting room ─── */}
      <section id="fitting" className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
        <SectionHeading
          index="03"
          overline="Virtual Fitting Room"
          title="Wear it before you wear it."
          copy="Stage a body photo from your vault — or capture a fresh snapshot — and the open-source IDM-VTON diffusion pipeline drapes the selected garment onto you. Results are proxied, never hot-linked."
        />

        <div className="grid gap-10 lg:grid-cols-12">
          <div className="space-y-10 lg:col-span-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-gold">Body reference</p>
              <div className="no-scrollbar mt-4 flex gap-3 overflow-x-auto pb-2">
                {profileItems.length === 0 && (
                  <p className="text-xs text-mute">
                    No body photos yet — add one from the wardrobe tab (Body Photos).
                  </p>
                )}
                {profileItems.map((item) => (
                  <ThumbButton
                    key={item.id}
                    item={item}
                    active={effectiveBodyId === item.id}
                    onClick={() => setBodyId(item.id)}
                    label={`Use ${item.subcategory} as body reference`}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-gold">
                Garment to drape{" "}
                <span className="text-mute normal-case tracking-normal">— upper garments</span>
              </p>
              <div className="no-scrollbar mt-4 flex gap-3 overflow-x-auto pb-2">
                {topItems.length === 0 && (
                  <p className="text-xs text-mute">No tops in the wardrobe yet.</p>
                )}
                {topItems.map((item) => (
                  <ThumbButton
                    key={item.id}
                    item={item}
                    active={effectiveGarmentId === item.id}
                    onClick={() => setGarmentId(item.id)}
                    label={`Drape ${item.subcategory}`}
                  />
                ))}
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => void runFitting()}
                disabled={tryonBusy || !effectiveBodyId || !effectiveGarmentId}
                className="inline-flex items-center gap-3 rounded-full bg-gold px-8 py-4 text-xs font-semibold uppercase tracking-[0.25em] text-ink transition hover:bg-gold-soft disabled:cursor-not-allowed disabled:opacity-60"
              >
                {tryonBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Scan className="h-4 w-4" />
                )}
                {tryonBusy ? "Rendering the drape…" : "Run virtual fitting"}
              </button>
              <p className="mt-4 text-[11px] leading-relaxed text-mute">
                GPU queue is the strictest route we guard — 6 renders / minute. Free-tier queues can
                be cold; the room falls back to a staged preview instead of failing.
              </p>
            </div>
          </div>

          <div className="lg:col-span-7" ref={fittingResultRef}>
            <div className="relative overflow-hidden rounded-xl border border-line bg-coal">
              {tryon || tryonBusy ? (
                <div className="relative">
                  {tryon ? (
                    <motion.img
                      key={tryon.imageUrl.slice(0, 64)}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.8 }}
                      src={tryon.imageUrl}
                      alt="Virtual try-on result"
                      className="mx-auto max-h-[36rem] w-full object-contain"
                    />
                  ) : (
                    <div className="flex aspect-[3/4] w-full items-center justify-center">
                      <div className="text-center">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-gold" />
                        <p className="mt-4 text-xs uppercase tracking-[0.3em] text-mute">
                          Diffusion in progress
                        </p>
                      </div>
                    </div>
                  )}
                  {tryon && (
                    <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-t from-ink/90 to-transparent px-5 pb-4 pt-16">
                      <span
                        className={`rounded-full border px-3 py-1 text-[9px] uppercase tracking-[0.25em] ${
                          tryon.simulated
                            ? "border-ember/50 bg-ember/10 text-ember"
                            : "border-gold/50 bg-gold/10 text-gold"
                        }`}
                      >
                        {tryon.simulated ? "Staged preview" : "IDM-VTON render"}
                      </span>
                      <span className="text-[10px] tracking-wide text-mute">{tryon.note}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex aspect-[3/4] flex-col items-center justify-center p-10 text-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-gold/40">
                    <Scan className="h-6 w-6 text-gold/60" />
                  </span>
                  <p className="mt-5 font-display text-xl italic text-ivory/80">The mirror is dark.</p>
                  <p className="mt-2 max-w-xs text-xs leading-relaxed text-mute">
                    Choose a body photo and a garment, then run the fitting to see the drape.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─── footer ─── */}
      <footer className="border-t border-line/60 bg-coal/60">
        <div className="mx-auto max-w-7xl px-5 py-14 md:px-8">
          <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="font-display text-3xl text-ivory">
                Atelier<span className="text-gold">.</span>
              </p>
              <p className="mt-2 max-w-xs text-xs leading-relaxed text-mute">
                A zero-cost, zero-trust virtual wardrobe. Built to run forever on free tiers —
                deployed on Vercel.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-16 gap-y-2 text-xs text-mute sm:grid-cols-3">
              {[
                "MongoDB Atlas M0",
                "Cloudinary Free",
                "Gemini Flash",
                "HF IDM-VTON",
                "Next.js 16",
                "Tailwind 4",
              ].map((tech) => (
                <span key={tech} className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-gold/60" />
                  {tech}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-line/60 pt-6 text-[10px] uppercase tracking-[0.25em] text-mute md:flex-row md:items-center">
            <span>© {new Date().getFullYear()} Atelier — wardrobe intelligence</span>
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-gold/70" />
              Rate-limited · Schema-locked · Error-obfuscated
            </span>
          </div>
        </div>
      </footer>

      {/* ─── add drawer ─── */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !saving && setDrawerOpen(false)}
              className="fixed inset-0 z-[60] bg-ink/70 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 32 }}
              className="fixed inset-y-0 right-0 z-[65] flex w-full max-w-md flex-col border-l border-line bg-coal"
              aria-label="Add a wardrobe piece"
            >
              <div className="flex items-center justify-between border-b border-line px-6 py-5">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-gold">New acquisition</p>
                  <p className="mt-1 font-display text-xl text-ivory">Add to the wardrobe</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close"
                  className="rounded-full border border-line p-2 text-mute transition hover:border-gold/40 hover:text-ivory"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 space-y-7 overflow-y-auto px-6 py-6">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.25em] text-mute">Kind of entry</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {(
                      [
                        { kind: "item", label: "Wardrobe piece" },
                        { kind: "profile", label: "Body photo" },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.kind}
                        type="button"
                        onClick={() => setDraft(emptyDraft(option.kind === "profile" ? "profile" : "tops"))}
                        className={`rounded-lg border px-4 py-3 text-xs tracking-wide transition ${
                          draft.kind === option.kind
                            ? "border-gold bg-gold/10 text-gold"
                            : "border-line text-mute hover:border-gold/40"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {draft.kind === "item" && (
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.25em] text-mute">Category</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {(Object.keys(SUBCATEGORIES) as Array<Exclude<Category, "profile">>).map(
                        (category) => {
                          const Icon = CATEGORY_ICONS[category];
                          return (
                            <button
                              key={category}
                              type="button"
                              onClick={() =>
                                setDraft((d) => ({
                                  ...d,
                                  category,
                                  subcategory: SUBCATEGORIES[category][0],
                                }))
                              }
                              className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-xs transition ${
                                draft.category === category
                                  ? "border-gold bg-gold/10 text-gold"
                                  : "border-line text-mute hover:border-gold/40"
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {CATEGORY_LABELS[category]}
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>
                )}

                {draft.kind === "item" && (
                  <div>
                    <label
                      htmlFor="draft-subcategory"
                      className="text-[10px] uppercase tracking-[0.25em] text-mute"
                    >
                      Piece type
                    </label>
                    <select
                      id="draft-subcategory"
                      value={draft.subcategory}
                      onChange={(e) => setDraft((d) => ({ ...d, subcategory: e.target.value }))}
                      className="mt-3 w-full rounded-lg border border-line bg-ink px-4 py-3 text-sm text-ivory outline-none transition focus:border-gold/50"
                    >
                      {SUBCATEGORIES[draft.category as Exclude<Category, "profile">].map((sub) => (
                        <option key={sub} value={sub}>
                          {sub}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="draft-color"
                    className="text-[10px] uppercase tracking-[0.25em] text-mute"
                  >
                    Dominant colour <span className="normal-case tracking-normal">— optional</span>
                  </label>
                  <input
                    id="draft-color"
                    value={draft.color}
                    maxLength={40}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, color: e.target.value.replace(/[<>]/g, "").slice(0, 40) }))
                    }
                    placeholder="e.g. Charcoal, Ivory, Indigo"
                    className="mt-3 w-full rounded-lg border border-line bg-ink px-4 py-3 text-sm text-ivory outline-none transition placeholder:text-mute/60 focus:border-gold/50"
                  />
                </div>

                <div>
                  <label
                    htmlFor="draft-tag"
                    className="text-[10px] uppercase tracking-[0.25em] text-mute"
                  >
                    Tags <span className="normal-case tracking-normal">— optional, up to 6</span>
                  </label>
                  <div className="mt-3 flex gap-2">
                    <input
                      id="draft-tag"
                      value={tagInput}
                      maxLength={24}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      placeholder="tailored, linen, summer…"
                      className="w-full rounded-lg border border-line bg-ink px-4 py-3 text-sm text-ivory outline-none transition placeholder:text-mute/60 focus:border-gold/50"
                    />
                    <button
                      type="button"
                      onClick={addTag}
                      aria-label="Add tag"
                      className="rounded-lg border border-gold/40 px-4 text-gold transition hover:bg-gold/10"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  {draft.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {draft.tags.map((tag) => (
                        <span
                          key={tag}
                          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[11px] text-ivory"
                        >
                          #{tag}
                          <button
                            type="button"
                            aria-label={`Remove tag ${tag}`}
                            onClick={() =>
                              setDraft((d) => ({ ...d, tags: d.tags.filter((t) => t !== tag) }))
                            }
                            className="text-mute hover:text-ember"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <p className="rounded-lg border border-line bg-ink/50 px-4 py-3 text-[11px] leading-relaxed text-mute">
                  Every field above is optional. Any image format, 50 MB max — validated here,
                  re-verified on the server, and signed into Cloudinary before MongoDB ever sees it.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-line px-6 py-5">
                <button
                  type="button"
                  onClick={openCamera}
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-gold/40 px-4 py-3.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold transition hover:bg-gold/10 disabled:opacity-50"
                >
                  <Camera className="h-4 w-4" />
                  Camera
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-gold px-4 py-3.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink transition hover:bg-gold-soft disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {saving ? "Working" : "Upload"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = "";
                    void ingestFiles(files, draft);
                  }}
                />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ─── camera modal ─── */}
      <AnimatePresence>
        {cameraOpen && (
          <CameraCapture
            facingMode={draft.kind === "profile" ? "user" : "environment"}
            label={draft.kind === "profile" ? "Full-body reference" : `${draft.subcategory || "Wardrobe piece"}`}
            onCapture={handleCameraCapture}
            onClose={() => setCameraOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ─── toast ─── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2"
            role="status"
          >
            <div className="flex items-center gap-3 rounded-full border border-gold/30 bg-coal/95 px-5 py-3 shadow-2xl shadow-black/60 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              <p className="max-w-xs text-xs tracking-wide text-ivory sm:max-w-md">{toast}</p>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setToast(null)}
                className="text-mute transition hover:text-ivory"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─────────────────────────── outfit card ─────────────────────────── */

function OutfitCard({
  outfit,
  byId,
  index,
}: {
  outfit: OutfitPlan;
  byId: Map<string, WardrobeItemView>;
  index: number;
}) {
  const roles: Array<{ label: string; id?: string }> = [
    { label: "Top", id: outfit.itemIds.top },
    { label: "Outer", id: outfit.itemIds.outer },
    { label: "Bottom", id: outfit.itemIds.bottom },
    { label: "Footwear", id: outfit.itemIds.footwear },
  ];

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-xl border border-line bg-coal/80 p-6 backdrop-blur"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[9px] uppercase tracking-[0.3em] text-gold">Look {index + 1} — {outfit.occasion}</p>
          <h3 className="mt-1.5 font-display text-2xl italic text-ivory">{outfit.name}</h3>
        </div>
        <div className="text-right">
          <p className="text-[9px] uppercase tracking-[0.25em] text-mute">Confidence</p>
          <div className="mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-ink">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${outfit.confidence}%` }}
              transition={{ duration: 0.9, delay: 0.2 + index * 0.1 }}
              className="h-full rounded-full bg-gold"
            />
          </div>
          <p className="mt-1 text-[10px] text-gold">{outfit.confidence}%</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {roles.map(({ label, id }) => {
          const item = id ? byId.get(id) : undefined;
          if (!item) return null;
          return (
            <span
              key={label}
              className="flex items-center gap-2 rounded-lg border border-line bg-ink/60 py-1.5 pl-1.5 pr-3 text-[11px] text-ivory/90"
            >
              <img src={item.imageUrl} alt="" className="h-7 w-7 rounded-md object-cover" />
              <span className="text-mute">{label}:</span> {item.subcategory}
            </span>
          );
        })}
        {outfit.itemIds.accessories.map((id) => {
          const item = byId.get(id);
          if (!item) return null;
          return (
            <span
              key={id}
              className="flex items-center gap-2 rounded-lg border border-gold/25 bg-gold/5 py-1.5 pl-1.5 pr-3 text-[11px] text-gold-soft"
            >
              <img src={item.imageUrl} alt="" className="h-7 w-7 rounded-md object-cover" />
              {item.subcategory}
            </span>
          );
        })}
      </div>

      <dl className="mt-5 space-y-3 text-[13px] leading-relaxed">
        {[
          ["Layering", outfit.layering],
          ["Colour story", outfit.colorRationale],
          ["Accessories", outfit.accessoryNotes],
        ].map(([label, value]) =>
          value ? (
            <div key={label} className="grid grid-cols-[6.5rem_1fr] gap-3">
              <dt className="text-[9px] uppercase tracking-[0.25em] text-gold/80 pt-0.5">{label}</dt>
              <dd className="text-mute">{value}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </motion.article>
  );
}
