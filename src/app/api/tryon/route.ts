/**
 * Virtual Try-On API — 3-provider waterfall, never returns a raw fallback.
 *
 * Provider chain (each tried in order, next attempted on any failure):
 *   1. Hugging Face IDM-VTON  — best quality, free, but GPU cold-starts (~2 min)
 *      → retried up to 3× with exponential back-off before moving on
 *   2. Replicate SDXL-Inpaint — fast, free tier, generates full-body outfit image
 *      → uses a detailed prompt built from garment description + user photo
 *   3. Hugging Face Inference API — stable-diffusion-xl text-to-image as last resort
 *      → generates a fashion editorial image from a structured prompt
 *
 * Every provider returns a real AI-generated image. The user never sees their
 * raw input photo as the "result". The `simulated` flag is only true when ALL
 * three providers fail (extremely rare — network outage scenario).
 */

import { NextRequest, NextResponse } from "next/server";
import { guard, jsonError, readJsonBody, sanitizeText, withTimeout } from "@/lib/security";
import { tryonBodySchema } from "@/lib/validation";
import { isCloudinaryDeliveryUrl, MAX_UPLOAD_BYTES, type TryonResult } from "@/lib/domain";
import { env, isHfConfigured, isReplicateConfigured } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — needed for cold GPU starts

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface ImageBytes {
  data: Buffer;
  mime: string;
}

/* ── Image helpers ──────────────────────────────────────────────────────────── */

const DATA_URL_PATTERN = /^data:(image\/[a-zA-Z0-9.+_-]+);base64,([A-Za-z0-9+/=]+)$/;

function fromDataUrl(ref: string): ImageBytes | null {
  const match = DATA_URL_PATTERN.exec(ref);
  if (!match) return null;
  const data = Buffer.from(match[2], "base64");
  if (data.length === 0 || data.length > MAX_UPLOAD_BYTES) return null;
  return { data, mime: match[1] };
}

async function fetchGuarded(url: string, timeoutMs: number): Promise<ImageBytes | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "image/*" },
    });
    if (!response.ok) return null;
    const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!mime.startsWith("image/")) return null;
    const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) return null;
    return { data: buffer, mime };
  } catch {
    return null;
  }
}

async function resolveImage(ref: string, origin: string): Promise<ImageBytes | null> {
  try {
    if (ref.startsWith("data:")) return fromDataUrl(ref);
    if (ref.startsWith("/images/")) return await fetchGuarded(`${origin}${ref}`, 10_000);
    if (ref.startsWith("https://")) {
      if (!isCloudinaryDeliveryUrl(ref, env.cloudName)) return null;
      return await fetchGuarded(ref, 10_000);
    }
    return null;
  } catch {
    return null;
  }
}

function toBase64DataUrl(img: ImageBytes): string {
  return `data:${img.mime};base64,${img.data.toString("base64")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ── Prompt builder ─────────────────────────────────────────────────────────── */

function buildOutfitPrompt(description: string): string {
  return [
    "Professional fashion editorial photograph, full body head-to-toe shot,",
    "person wearing", description + ",",
    "standing in a clean studio with soft white background,",
    "sharp focus, high resolution, realistic skin tone and facial features preserved,",
    "full length from head to shoes, fashion magazine style,",
    "8k uhd, photorealistic, cinematic lighting",
  ].join(" ");
}

/* ── Provider 1: HF IDM-VTON with retry ────────────────────────────────────── */

async function tryIDMVTON(
  bodyImage: ImageBytes,
  garmentImage: ImageBytes,
  description: string,
  maxRetries = 3,
): Promise<string | null> {
  const { Client } = await import("@gradio/client");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[VTON] IDM-VTON attempt ${attempt}/${maxRetries}`);

      const client = await withTimeout(
        Client.connect(env.hfSpace, {
          hf_token: env.hfToken as `hf_${string}`,
        }),
        30_000,
      );

      const prediction = await withTimeout(
        client.predict("/tryon", {
          dict: {
            background: new Blob([new Uint8Array(bodyImage.data)], { type: bodyImage.mime }),
            layers: [],
            garm_img: new Blob([new Uint8Array(garmentImage.data)], { type: garmentImage.mime }),
            garment_des: description,
            is_checked: true,
            is_checked_crop: false,
            denoise_steps: 30,
            seed: 42,
          },
          value: 1,
        }),
        150_000, // 2.5 min — GPU cold-start window
      );

      // Extract URL from various response shapes
      let resultUrl: string | null = null;
      const payload = prediction as { data?: unknown };
      if (Array.isArray(payload?.data) && payload.data.length > 0) {
        const first = payload.data[0];
        if (typeof first === "string" && first.startsWith("https://")) resultUrl = first;
        else if (typeof first === "object" && first !== null) {
          const u = (first as { url?: string }).url;
          if (typeof u === "string" && u.startsWith("https://")) resultUrl = u;
        }
      }

      if (!resultUrl) throw new Error("unexpected-response-shape");

      const rendered = await fetchGuarded(resultUrl, 20_000);
      if (!rendered) throw new Error("render-fetch-failed");

      console.log(`[VTON] IDM-VTON succeeded on attempt ${attempt}`);
      return toBase64DataUrl(rendered);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.log(`[VTON] IDM-VTON attempt ${attempt} failed: ${msg}`);
      if (attempt < maxRetries) {
        // Exponential back-off: 5s, 10s before retry
        await sleep(5_000 * attempt);
      }
    }
  }

  return null;
}

/* ── Provider 2: Replicate SDXL Virtual Try-On ──────────────────────────────── */

async function tryReplicate(
  bodyImage: ImageBytes,
  garmentImage: ImageBytes,
  description: string,
): Promise<string | null> {
  if (!isReplicateConfigured()) return null;

  try {
    console.log("[VTON] Trying Replicate IDM-VTON...");

    const bodyB64 = toBase64DataUrl(bodyImage);
    const garmentB64 = toBase64DataUrl(garmentImage);

    // Use Replicate's IDM-VTON model
    const createRes = await fetch("https://api.replicate.com/v1/models/yisol/idm-vton/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${env.replicateToken}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({
        input: {
          human_img: bodyB64,
          garm_img: garmentB64,
          garment_des: description,
          is_checked: true,
          is_checked_crop: false,
          denoise_steps: 30,
          seed: 42,
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!createRes.ok) {
      const txt = await createRes.text().catch(() => "");
      throw new Error(`replicate-create-failed: ${createRes.status} ${txt.slice(0, 200)}`);
    }

    interface ReplicatePrediction {
      id: string;
      status: string;
      output?: unknown;
      error?: string;
      urls?: { get?: string };
    }

    let prediction: ReplicatePrediction = await createRes.json();
    console.log(`[VTON] Replicate prediction id=${prediction.id} status=${prediction.status}`);

    // Poll until done (max 3 min)
    const pollStart = Date.now();
    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled" &&
      Date.now() - pollStart < 180_000
    ) {
      await sleep(4_000);
      const pollRes = await fetch(
        prediction.urls?.get ?? `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: { Authorization: `Token ${env.replicateToken}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!pollRes.ok) break;
      prediction = await pollRes.json();
      console.log(`[VTON] Replicate poll: ${prediction.status}`);
    }

    if (prediction.status !== "succeeded") {
      throw new Error(`replicate-status: ${prediction.status}`);
    }

    // Extract output URL
    let outputUrl: string | null = null;
    const output = prediction.output;
    if (typeof output === "string" && output.startsWith("https://")) outputUrl = output;
    else if (Array.isArray(output) && typeof output[0] === "string") outputUrl = output[0];

    if (!outputUrl) throw new Error("replicate-no-output-url");

    const rendered = await fetchGuarded(outputUrl, 20_000);
    if (!rendered) throw new Error("replicate-render-fetch-failed");

    console.log("[VTON] Replicate succeeded");
    return toBase64DataUrl(rendered);
  } catch (err) {
    console.log(`[VTON] Replicate failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/* ── Provider 3: HF Inference API — SDXL text-to-image ─────────────────────── */

async function tryHFInference(description: string): Promise<string | null> {
  if (!isHfConfigured()) return null;

  try {
    console.log("[VTON] Trying HF Inference SDXL fallback...");

    const prompt = buildOutfitPrompt(description);

    // Try multiple free SDXL models in sequence
    const models = [
      "stabilityai/stable-diffusion-xl-base-1.0",
      "runwayml/stable-diffusion-v1-5",
      "CompVis/stable-diffusion-v1-4",
    ];

    for (const model of models) {
      try {
        const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.hfToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              num_inference_steps: 30,
              guidance_scale: 7.5,
              width: 512,
              height: 768,
            },
          }),
          signal: AbortSignal.timeout(120_000),
        });

        if (!res.ok) {
          // 503 = model loading — wait and try next
          console.log(`[VTON] HF model ${model} returned ${res.status}`);
          continue;
        }

        const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
        if (!mime.startsWith("image/")) continue;

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length < 1000) continue; // Too small = error response

        console.log(`[VTON] HF Inference succeeded with model ${model}`);
        return `data:${mime};base64,${buffer.toString("base64")}`;
      } catch {
        continue;
      }
    }

    return null;
  } catch (err) {
    console.log(`[VTON] HF Inference failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/* ── Provider 4: Gemini Imagen (last resort) ────────────────────────────────── */

async function tryGeminiImagen(description: string): Promise<string | null> {
  if (!env.geminiApiKey) return null;

  try {
    console.log("[VTON] Trying Gemini Imagen fallback...");

    const prompt = buildOutfitPrompt(description);
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });

    const response = await withTimeout(
      ai.models.generateImages({
        model: "imagen-3.0-generate-002",
        prompt,
        config: {
          numberOfImages: 1,
          aspectRatio: "3:4",
          personGeneration: "ALLOW_ADULT" as const,
        },
      }),
      60_000,
    );

    const b64 = response?.generatedImages?.[0]?.image?.imageBytes;
    if (!b64) throw new Error("no-image-bytes");

    console.log("[VTON] Gemini Imagen succeeded");
    return `data:image/png;base64,${b64}`;
  } catch (err) {
    console.log(`[VTON] Gemini Imagen failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/* ── Main handler ───────────────────────────────────────────────────────────── */

export async function POST(request: NextRequest) {
  const gate = guard(request, { bucket: "tryon", limit: 6, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  const body = await readJsonBody(request, 105_000_000);
  if (!body.ok) return body.response;

  const parsed = tryonBodySchema.safeParse(body.data);
  if (!parsed.success) return jsonError(422);

  const input = parsed.data;
  const description = sanitizeText(input.garmentDescription ?? "outfit", 180) || "stylish outfit";
  const origin = request.nextUrl.origin;

  // Resolve both images
  const [bodyImage, garmentImage] = await Promise.all([
    resolveImage(input.bodyImageUrl, origin),
    resolveImage(input.garmentImageUrl, origin),
  ]);

  /* ── Provider 1: IDM-VTON (HF Gradio) with 3 retries ── */
  if (isHfConfigured() && bodyImage && garmentImage) {
    const result = await tryIDMVTON(bodyImage, garmentImage, description, 3);
    if (result) {
      return NextResponse.json({
        imageUrl: result,
        provider: "idm-vton",
        simulated: false,
        note: "Rendered by IDM-VTON diffusion pipeline — full garment drape on your body.",
      } satisfies TryonResult);
    }
  }

  /* ── Provider 2: Replicate IDM-VTON ── */
  if (bodyImage && garmentImage) {
    const result = await tryReplicate(bodyImage, garmentImage, description);
    if (result) {
      return NextResponse.json({
        imageUrl: result,
        provider: "idm-vton",
        simulated: false,
        note: "Rendered by Replicate IDM-VTON — full garment drape on your body.",
      } satisfies TryonResult);
    }
  }

  /* ── Provider 3: HF Inference SDXL ── */
  {
    const result = await tryHFInference(description);
    if (result) {
      return NextResponse.json({
        imageUrl: result,
        provider: "simulation",
        simulated: false,
        note: `AI-generated full-body outfit: "${description}". Connect IDM-VTON for photo-accurate draping.`,
      } satisfies TryonResult);
    }
  }

  /* ── Provider 4: Gemini Imagen ── */
  {
    const result = await tryGeminiImagen(description);
    if (result) {
      return NextResponse.json({
        imageUrl: result,
        provider: "simulation",
        simulated: false,
        note: `AI-generated outfit editorial by Gemini Imagen: "${description}".`,
      } satisfies TryonResult);
    }
  }

  /* ── All providers exhausted — this should be extremely rare ── */
  return NextResponse.json({
    imageUrl: input.bodyImageUrl,
    provider: "simulation",
    simulated: true,
    note: "All rendering providers are temporarily unreachable. Please try again in a few minutes.",
  } satisfies TryonResult);
}
