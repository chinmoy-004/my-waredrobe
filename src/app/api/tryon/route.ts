import { NextRequest, NextResponse } from "next/server";
import { guard, jsonError, readJsonBody, sanitizeText, withTimeout } from "@/lib/security";
import { tryonBodySchema } from "@/lib/validation";
import { isCloudinaryDeliveryUrl, MAX_UPLOAD_BYTES, type TryonResult } from "@/lib/domain";
import { env, isHfConfigured } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ImageBytes {
  data: Buffer;
  mime: string;
}

const DATA_URL_PATTERN = /^data:(image\/[a-zA-Z0-9.+_-]+);base64,([A-Za-z0-9+/=]+)$/;

function fromDataUrl(ref: string): ImageBytes | null {
  const match = DATA_URL_PATTERN.exec(ref);
  if (!match) return null;
  const data = Buffer.from(match[2], "base64");
  if (data.length === 0 || data.length > MAX_UPLOAD_BYTES) return null;
  return { data, mime: match[1] };
}

async function fetchGuarded(url: string, timeoutMs: number): Promise<ImageBytes | null> {
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
}

/** Resolves an allowed image reference (Cloudinary / bundled asset / session capture). */
async function resolveImage(ref: string, origin: string): Promise<ImageBytes | null> {
  try {
    if (ref.startsWith("data:")) return fromDataUrl(ref);
    if (ref.startsWith("/images/")) return await fetchGuarded(`${origin}${ref}`, 8_000);
    if (ref.startsWith("https://")) {
      if (!isCloudinaryDeliveryUrl(ref, env.cloudName)) return null;
      return await fetchGuarded(ref, 8_000);
    }
    return null;
  } catch {
    return null;
  }
}

function extractImageUrl(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first: unknown = data[0];
  if (typeof first === "string" && first.startsWith("https://")) return first;
  if (typeof first === "object" && first !== null) {
    const url = (first as { url?: unknown }).url;
    if (typeof url === "string" && url.startsWith("https://")) return url;
  }
  return null;
}

export async function POST(request: NextRequest) {
  // GPU inference is the most expensive call we proxy: strictest budget.
  const gate = guard(request, { bucket: "tryon", limit: 6, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  const body = await readJsonBody(request, 105_000_000);
  if (!body.ok) return body.response;

  const parsed = tryonBodySchema.safeParse(body.data);
  if (!parsed.success) return jsonError(422);

  const input = parsed.data;
  const description = sanitizeText(input.garmentDescription ?? "garment", 180) || "garment";
  const origin = request.nextUrl.origin;

  if (!isHfConfigured()) {
    const staged: TryonResult = {
      imageUrl: input.bodyImageUrl,
      provider: "simulation",
      simulated: true,
      note: "Demo draping — connect HF_TOKEN to unlock the IDM-VTON diffusion render.",
    };
    return NextResponse.json(staged);
  }

  try {
    const [bodyImage, garmentImage] = await Promise.all([
      resolveImage(input.bodyImageUrl, origin),
      resolveImage(input.garmentImageUrl, origin),
    ]);
    if (!bodyImage || !garmentImage) throw new Error("image-resolution-failed");

    const { Client } = await import("@gradio/client");
    const client = await withTimeout(
      Client.connect(env.hfSpace, { hf_token: env.hfToken as `hf_${string}` }),
      20_000,
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
      55_000,
    );

    const resultUrl = extractImageUrl(prediction);
    if (!resultUrl) throw new Error("unexpected-render-shape");

    // Proxy the render so the browser never talks to third-party hosts (CSP stays tight).
    const rendered = await fetchGuarded(resultUrl, 15_000);
    if (!rendered) throw new Error("render-fetch-failed");

    const result: TryonResult = {
      imageUrl: `data:${rendered.mime};base64,${rendered.data.toString("base64")}`,
      provider: "idm-vton",
      simulated: false,
      note: "Rendered by the open-source IDM-VTON diffusion pipeline (upper-garment drape).",
    };
    return NextResponse.json(result);
  } catch {
    // Fail-safe: free-tier GPU queues are occasionally cold/busy — degrade gracefully.
    const staged: TryonResult = {
      imageUrl: input.bodyImageUrl,
      provider: "simulation",
      simulated: true,
      note: "Virtual fitting queue was unreachable — your staged base look is shown instead.",
    };
    return NextResponse.json(staged);
  }
}
