# ATELIER — Virtual Wardrobe & AI Fashion Stylist

A production-grade, zero-hosting-cost wardrobe OS. Catalogue pieces from the camera or files,
commission complete outfits from a Gemini-powered stylist, and step into a photoreal fitting room
rendered by the open-source `yisol/IDM-VTON` diffusion pipeline — wrapped in a strict zero-trust
security perimeter.

## Stack (all free tiers)

| Layer                | Choice                                        | Cost |
| -------------------- | --------------------------------------------- | ---- |
| Framework            | Next.js (App Router, React 19, TypeScript)    | $0   |
| Database             | **MongoDB Atlas M0** via Mongoose             | $0   |
| Image storage / CDN  | **Cloudinary** (signed uploads only)          | $0   |
| Decision / Fashion AI| **Google Gemini Flash** (`@google/genai`)     | $0   |
| Virtual try-on       | **Hugging Face** `yisol/IDM-VTON` (`@gradio/client`) | $0 |
| UI                   | Tailwind CSS · Lucide · Framer Motion · react-webcam | $0 |
| Hosting              | Vercel                                        | $0   |

## Security architecture (zero-trust)

- **Rate limiting** — per-IP sliding-window buckets on every API route (`429` + `Retry-After`), key-space capped against memory exhaustion.
- **Strict validation** — Zod `strictObject` schemas reject unexpected keys; bounded lengths everywhere.
- **Anti-injection** — sanitizers strip control chars / XSS vectors; Mongoose receives plain strings only; ObjectIds verified by shape before queries.
- **Upload security** — server-minted Cloudinary **signatures** (unsigned uploads impossible), MIME allowlist (`jpeg/png/webp`), 5 MB cap, delivery URLs verified against *your* cloud + folder before persistence.
- **CSRF / tampering** — Origin / Referer / `Sec-Fetch-Site` checks on all mutating routes; content-length pre-flight caps; content-type enforcement.
- **Headers** — CSP, `X-Frame-Options: DENY`, `nosniff`, `Permissions-Policy`, HSTS (`next.config.ts`).
- **Fail-safe errors** — static, status-keyed messages; no stack traces or internals ever reach the client.
- **Graceful degradation** — missing keys or cold GPU queues fall back to safe previews, never crashes.

## Setup (5 minutes)

```bash
cp .env.local.example .env.local   # fill the six free-tier keys
npm install
npm run dev
```

Values needed (see `.env.local.example`):

```
MONGODB_URI, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
CLOUDINARY_API_SECRET, GEMINI_API_KEY, HF_TOKEN
```

> With **no** keys set the app runs in *session demo mode*: fully interactive, seeded wardrobe,
> rule-engine stylist and staged fitting previews. Each capability switches on as its key is added.

## Deploy to Vercel

1. Push to GitHub → Import in Vercel.
2. Add the same environment variables in **Project → Settings → Environment Variables**.
3. Done — `next build` output is production-ready.

## API surface

| Route                        | Method | Guard budget      | Purpose                                |
| ---------------------------- | ------ | ----------------- | -------------------------------------- |
| `/api/upload-signature`      | POST   | 30/min            | Mint signed Cloudinary upload params   |
| `/api/upload`                | POST   | 20/min            | Persist verified metadata to MongoDB   |
| `/api/wardrobe`              | GET    | 90/min            | List wardrobe documents                |
| `/api/wardrobe/[id]`         | DELETE | 30/min            | Remove a document                      |
| `/api/stylist`               | POST   | 12/min            | Gemini lookbook (+ rules fallback)     |
| `/api/tryon`                 | POST   | 6/min             | IDM-VTON render (+ staged fallback)    |
| `/api/meta`                  | GET    | 90/min            | Non-secret capability status           |
| `/api/health`                | GET    | —                 | Liveness probe                         |
