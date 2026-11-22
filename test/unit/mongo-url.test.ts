import { describe, expect, it } from 'vitest';
import { dbNameFromUrl } from '../../src/infrastructure/database/mongo/mongo.client.js';
import { loadEnv } from '../../src/infrastructure/config/env.js';

describe('Mongo del homelab', () => {
  it('toma la base de la URL', () => {
    expect(dbNameFromUrl('mongodb://u:p@192.168.1.10:27017/food?authSource=food')).toBe('food');
    expect(dbNameFromUrl('mongodb://h1:27017,h2:27017/noshy_test')).toBe('noshy_test');
    expect(dbNameFromUrl('mongodb+srv://u:p@cluster.x.net/app?retryWrites=true')).toBe('app');
    expect(dbNameFromUrl('mongodb://localhost:27017')).toBeNull();
    expect(dbNameFromUrl('mongodb://localhost:27017/?authSource=admin')).toBeNull();
  });

  it('MONGO_DB es opcional (vacío cuenta como no definido)', () => {
    const base = { DATABASE_URL: 'postgres://x', MONGO_URL: 'mongodb://h/food', JWT_SECRET: 'x'.repeat(40) };
    expect(loadEnv(base).MONGO_DB).toBeUndefined();
    expect(loadEnv({ ...base, MONGO_DB: '' }).MONGO_DB).toBeUndefined();
    expect(loadEnv({ ...base, MONGO_DB: 'otra' }).MONGO_DB).toBe('otra');
  });
});
