import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * Almacenamiento de archivos. La interfaz imita a S3/GCS (URL firmada para subir directo);
 * el driver local la implementa con rutas propias del API para desarrollo.
 */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signedUploadUrl(key: string, contentType: string, expiresAt: Date): { url: string; headers: Record<string, string> };
  verifyUploadSignature(key: string, expires: number, sig: string): boolean;
  publicUrl(key: string): string;
}

export class LocalStorage implements Storage {
  constructor(
    private readonly dir: string,
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  private file(key: string) {
    const safe = key.replace(/[^a-zA-Z0-9_./-]/g, '_').replace(/\.\.+/g, '_');
    return path.join(this.dir, safe);
  }

  async put(key: string, body: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
  }

  async get(key: string) {
    try {
      return await readFile(this.file(key));
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }

  async exists(key: string) {
    try {
      await stat(this.file(key));
      return true;
    } catch {
      return false;
    }
  }

  private sign(key: string, expires: number) {
    return createHmac('sha256', this.secret).update(`${key}:${expires}`).digest('base64url');
  }

  signedUploadUrl(key: string, contentType: string, expiresAt: Date) {
    const expires = Math.floor(expiresAt.getTime() / 1000);
    const sig = this.sign(key, expires);
    const url = `${this.baseUrl}/storage/upload?key=${encodeURIComponent(key)}&expires=${expires}&sig=${sig}`;
    return { url, headers: { 'Content-Type': contentType } };
  }

  verifyUploadSignature(key: string, expires: number, sig: string) {
    if (expires * 1000 < Date.now()) return false;
    const expected = Buffer.from(this.sign(key, expires));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  publicUrl(key: string) {
    return `${this.baseUrl}/storage/files/${key}`;
  }
}
