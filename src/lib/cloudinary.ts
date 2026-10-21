/**
 * Cloudinary server-side client. Used EXCLUSIVELY to mint short-lived signed
 * upload parameters — the browser uploads straight to Cloudinary, and our
 * API only ever persists the resulting delivery URL + metadata to MongoDB.
 * Unsigned client uploads are never accepted.
 */

import { v2 as cloudinary } from "cloudinary";
import { env, isCloudinaryConfigured } from "./env";

let configured = false;

export function getCloudinaryClient(): typeof cloudinary | null {
  if (!isCloudinaryConfigured()) return null;
  if (!configured) {
    cloudinary.config({
      cloud_name: env.cloudName as string,
      api_key: env.cloudinaryApiKey as string,
      api_secret: env.cloudinaryApiSecret as string,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

type SignableValue = string | number | boolean | string[] | undefined;

export function createUploadSignature(params: Record<string, SignableValue>): string | null {
  const client = getCloudinaryClient();
  if (!client || !env.cloudinaryApiSecret) return null;
  return client.utils.api_sign_request(
    params as Record<string, string>,
    env.cloudinaryApiSecret,
  );
}
