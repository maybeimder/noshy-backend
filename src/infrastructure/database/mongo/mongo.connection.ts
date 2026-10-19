import { MongoClient, type Db } from 'mongodb';
import { applicationLogger } from '../../observability/logger';

// Base de datos del catálogo (products_slim, recipes_raw). Es de SOLO LECTURA: el usuario `app` tiene rol read.
export const FOOD_DATABASE = 'food';

// Un único MongoClient por proceso, reutilizado por todas las consultas (el driver maneja el pool).
// El driver se conecta solo en la primera consulta; connectWithRetry solo sirve para avisar en el log
// y revisar los índices. Si Mongo está caído, las consultas fallan rápido (503) y la API sigue arriba.
export class MongoConnection {
  readonly client: MongoClient;
  private stopped = false;

  constructor(url: string) {
    this.client = new MongoClient(url, {
      appName: 'noshy-api',
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 3_000,
      connectTimeoutMS: 5_000
    });
  }

  db(): Db {
    return this.client.db(FOOD_DATABASE);
  }

  // Reintenta con backoff exponencial (1 s -> 30 s) sin tumbar el proceso.
  async connectWithRetry(onConnected?: () => Promise<void> | void): Promise<void> {
    for (let attempt = 1, delay = 1_000; !this.stopped; attempt++, delay = Math.min(delay * 2, 30_000)) {
      try {
        await this.client.connect();
        await this.db().command({ ping: 1 });
        applicationLogger.info('mongo.connected', 'MongoDB conectado y respondió al ping.', { database: FOOD_DATABASE, attempt });
        await onConnected?.();
        return;
      } catch (error) {
        applicationLogger.warn('mongo.retry', `MongoDB no disponible (intento ${attempt}), reintento en ${delay / 1000}s.`, {
          attempt,
          retryInSeconds: delay / 1000,
          error: error instanceof Error ? error.message : String(error)
        });
        await new Promise((resolve) => setTimeout(resolve, delay).unref());
      }
    }
  }

  async close(): Promise<void> {
    this.stopped = true;
    await this.client.close();
    applicationLogger.info('mongo.closed', 'Conexión a MongoDB cerrada.');
  }
}

// Avisa (no crea: el usuario `app` no puede) si faltan los índices que usan las consultas del catálogo.
export async function checkFoodIndexes(db: Db): Promise<string[]> {
  const expected: [collection: string, field: string, hint: string][] = [
    ['products_slim', 'popularity', '{ popularity: -1 }'],
    ['recipes_raw', 'ner', '{ ner: 1 }']
  ];
  const warnings: string[] = [];
  for (const [collection, field, hint] of expected) {
    const indexes = await db.collection(collection).indexes();
    if (!indexes.some((index) => Object.keys(index.key)[0] === field)) {
      warnings.push(`${collection} no tiene índice por ${field}: créalo con el usuario admin -> db.${collection}.createIndex(${hint})`);
    }
  }
  return warnings;
}
