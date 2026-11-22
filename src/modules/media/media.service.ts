import type { MediaRepository } from './media.repository.js';
import type { Storage } from '../../infrastructure/storage/storage.js';
import { Errors, field } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';

const MEDIA_RULES: Record<string, { maxBytes: number; types: string[] }> = {
  recipeCover: { maxBytes: 8 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/heic', 'image/webp'] },
  cookedPhoto: { maxBytes: 8 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/heic', 'image/webp'] },
  avatar: { maxBytes: 4 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
};
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp' };

const PUBLIC_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };

/** Fotos (portada de receta, plato cocinado, avatar): URL firmada para subir directo al storage. */
export class MediaService {
  constructor(
    private readonly media: MediaRepository,
    private readonly storage: Storage,
  ) {}

  async requestUpload(userId: string, input: { purpose: string; contentType: string; sizeBytes: number }) {
    const rules = MEDIA_RULES[input.purpose];
    if (!rules) throw Errors.validation([field('purpose', 'INVALID_OPTION', 'Propósito desconocido.')]);
    if (!rules.types.includes(input.contentType)) throw Errors.unsupportedMedia();
    if (input.sizeBytes > rules.maxBytes) throw Errors.tooLarge();
    const id = newId('media');
    const key = `media/${userId}/${id}.${EXT[input.contentType] ?? 'bin'}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    await this.media.insert({ id, userId, purpose: input.purpose, contentType: input.contentType, sizeBytes: input.sizeBytes, storageKey: key, expiresAt: new Date(Date.now() + 86_400_000) });
    const signed = this.storage.signedUploadUrl(key, input.contentType, expiresAt);
    return { mediaId: id, uploadUrl: signed.url, method: 'PUT' as const, headers: signed.headers, expiresAt: expiresAt.toISOString() };
  }

  /** Recibe el PUT del driver local de storage (en producción lo recibe S3/GCS directamente). */
  async receiveUpload(key: string, expires: number, sig: string, body: Buffer, contentType: string | undefined) {
    if (!this.storage.verifyUploadSignature(key, expires, sig)) throw Errors.forbidden('INVALID_SIGNATURE', 'La URL de subida no es válida o venció.');
    const m = await this.media.byKey(key);
    if (!m) throw Errors.notFound();
    if (contentType && contentType !== m.contentType) throw Errors.unsupportedMedia();
    if (body.length > m.sizeBytes * 1.05 + 1024) throw Errors.tooLarge();
    await this.storage.put(key, body, m.contentType);
    await this.media.markUploaded(m.id);
  }

  /** Archivo público de `media/` (solo el driver local; en producción lo sirve el CDN). */
  async publicFile(key: string) {
    if (!key.startsWith('media/')) throw Errors.notFound();
    const file = await this.storage.get(key);
    if (!file) throw Errors.notFound();
    const ext = key.split('.').pop() ?? '';
    return { file, contentType: PUBLIC_TYPES[ext] ?? 'application/octet-stream' };
  }
}
