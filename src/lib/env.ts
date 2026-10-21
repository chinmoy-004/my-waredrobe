/**
 * Server-side environment access. Never import this from client components.
 * Every credential is read from process.env placeholders — nothing is hardcoded.
 */

function read(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export const env = {
  mongoUri: read("MONGODB_URI"),
  cloudName: read("CLOUDINARY_CLOUD_NAME"),
  cloudinaryApiKey: read("CLOUDINARY_API_KEY"),
  cloudinaryApiSecret: read("CLOUDINARY_API_SECRET"),
  geminiApiKey: read("GEMINI_API_KEY"),
  geminiModel: read("GEMINI_MODEL") ?? "gemini-2.5-flash",
  hfToken: read("HF_TOKEN"),
  hfSpace: read("HF_VTON_SPACE") ?? "yisol/IDM-VTON",
  replicateToken: read("REPLICATE_API_TOKEN"),
};

export const isReplicateConfigured = (): boolean => env.replicateToken !== null;

export const isMongoConfigured = (): boolean => env.mongoUri !== null;

export const isCloudinaryConfigured = (): boolean =>
  env.cloudName !== null && env.cloudinaryApiKey !== null && env.cloudinaryApiSecret !== null;

export const isGeminiConfigured = (): boolean => env.geminiApiKey !== null;

export const isHfConfigured = (): boolean => env.hfToken !== null;
