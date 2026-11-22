import { MongoClient } from 'mongodb';
import { collections, ensureIndexes, type MongoCollections } from './collections.js';

export type Mongo = { client: MongoClient; c: MongoCollections; dbName: string; close: () => Promise<void> };

/** Base que trae la URL (`mongodb://host:27017/food?authSource=food` → `food`), si trae una. */
export function dbNameFromUrl(url: string): string | null {
  const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i.exec(url);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/**
 * Base de Mongo: `MONGO_DB` si está definido; si no, la de la URL; si la URL no trae, `noshy`.
 * Las colecciones del backend (chef_*, cooking_events, user_signals, insights, receipt_scans) no chocan
 * con las del catálogo que ya vive en el Mongo del homelab (products_slim, recipes_raw).
 */
export async function createMongo(url: string, dbName?: string): Promise<Mongo> {
  const name = dbName ?? dbNameFromUrl(url) ?? 'noshy';
  const client = await MongoClient.connect(url, { ignoreUndefined: true, serverSelectionTimeoutMS: 10_000 });
  const c = collections(client.db(name));
  await ensureIndexes(c);
  return { client, c, dbName: name, close: () => client.close() };
}
