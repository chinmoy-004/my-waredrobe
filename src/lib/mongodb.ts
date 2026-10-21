/**
 * MongoDB connection utility (Mongoose, cached across hot reloads &
 * serverless invocations). MongoDB Atlas is the ONLY database this app uses.
 *
 * When MONGODB_URI is absent the app stays alive in safe session demo mode —
 * the connection simply resolves to null and read routes return empty sets.
 */

import mongoose from "mongoose";
import { env } from "./env";

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalForMongo = globalThis as unknown as {
  __atelierMongooseCache?: MongooseCache;
};

const cache: MongooseCache = globalForMongo.__atelierMongooseCache ?? {
  conn: null,
  promise: null,
};
if (!globalForMongo.__atelierMongooseCache) {
  globalForMongo.__atelierMongooseCache = cache;
}

export async function dbConnect(): Promise<typeof mongoose | null> {
  if (!env.mongoUri) return null;
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose.connect(env.mongoUri, {
      // Tight timeouts: never let a slow DB stall the request budget.
      serverSelectionTimeoutMS: 4_000,
      socketTimeoutMS: 20_000,
      connectTimeoutMS: 5_000,
      maxPoolSize: 8,
    });
  }

  try {
    cache.conn = await cache.promise;
    return cache.conn;
  } catch (error) {
    cache.promise = null;
    throw error;
  }
}

export function mongoReadyState(): number {
  return mongoose.connection.readyState;
}
