import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { EventStore } from '../../core/events/event-store.js';
import type { AccountRepository } from './account.repository.js';
import type { UsersRepository, UserRow } from '../auth/auth.repository.js';
import type { MediaRepository } from '../media/media.repository.js';
import type { Mailer } from './account.providers.js';
import type { Storage } from '../../infrastructure/storage/storage.js';
import { media, receipts, users, dataExports } from '../../infrastructure/database/postgres/schema.js';
import type { UserSettings } from '../../infrastructure/database/postgres/types.js';
import { toPublicUser } from '../auth/auth.service.js';
import { AppError, Errors, field } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';

const CODE_TTL_MS = 15 * 60_000;
const RESEND_AFTER_S = 60;
const MAX_ATTEMPTS = 5;
const EXPORT_TTL_DAYS = 7;

/** Tablas con `user_id` que entran en la exportación de datos. */
const EXPORT_TABLES = ['user_preferences', 'pantry_items', 'shopping_lists', 'meal_logs', 'menus', 'cooking_sessions', 'receipts', 'comments', 'saved_recipes', 'liked_recipes', 'nudges', 'media', 'follows'];

export type SettingsPatch = {
  account?: { name?: string; lastName?: string | null; grammaticalGender?: 'feminine' | 'masculine' | 'neutral' | null; avatarMediaId?: string | null };
  chef?: Partial<UserSettings['chef']>;
  notifications?: Partial<UserSettings['notifications']>;
};

const hashCode = (userId: string, code: string) => createHash('sha256').update(`${userId}:${code}`).digest('hex');

/**
 * Cuenta: verificación de email, ajustes, exportación de datos y borrado (Ley 1581 de habeas data).
 * El código de verificación se envía desde el observer de `user.registered` y desde «Reenviar».
 */
export class AccountService {
  constructor(
    private readonly db: Db,
    private readonly repo: AccountRepository,
    private readonly users: UsersRepository,
    private readonly media: MediaRepository,
    private readonly mailer: Mailer,
    private readonly storage: Storage,
    private readonly outbox: Outbox,
    private readonly events: EventStore,
  ) {}

  private async userOrThrow(userId: string): Promise<UserRow> {
    const u = await this.users.findById(userId);
    if (!u) throw Errors.unauthorized();
    return u;
  }

  // ---------- Verificación de email ----------
  async sendVerification(userId: string, opts: { enforceCooldown: boolean }) {
    const user = await this.userOrThrow(userId);
    if (user.emailVerified) return { sent: false };
    const last = await this.repo.latestVerification(userId);
    if (opts.enforceCooldown && last) {
      const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
      if (elapsed < RESEND_AFTER_S) {
        throw new AppError(429, 'RATE_LIMITED', 'Espera un momento antes de pedir otro código.', { retryAfterSeconds: Math.ceil(RESEND_AFTER_S - elapsed) });
      }
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = newId('event').replace('evt_', 'evf_');
    await this.db.transaction(async (tx) => {
      await this.repo.insertVerification(tx, { id, userId, email: user.email, codeHash: hashCode(userId, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) });
      await this.outbox.record(tx, 'user.email_verification_requested', { userId, verificationId: id });
    });
    await this.mailer.send({
      to: user.email,
      subject: `${code} es tu código de Noshy`,
      text: `Hola ${user.name}, tu código para verificar tu correo es ${code}. Vence en 15 minutos.`,
      tag: 'emailVerification',
    });
    this.outbox.kick();
    return { sent: true };
  }

  async verifyEmail(userId: string, code: string) {
    const user = await this.userOrThrow(userId);
    if (user.emailVerified) return { user: toPublicUser(user) };
    const v = await this.repo.latestVerification(userId);
    if (!v) throw Errors.unprocessable('CODE_INVALID', 'Ese código no es válido. Pide uno nuevo.');
    if (v.expiresAt < new Date()) throw Errors.gone('CODE_EXPIRED', 'El código venció. Te enviamos uno nuevo si tocas «Reenviar».');
    if (v.attempts >= MAX_ATTEMPTS) throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos. Pide un código nuevo.');
    const a = Buffer.from(v.codeHash);
    const b = Buffer.from(hashCode(userId, code));
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      await this.repo.bumpAttempts(v.id);
      throw Errors.unprocessable('CODE_INVALID', 'Ese código no es válido.', { attemptsLeft: Math.max(0, MAX_ATTEMPTS - v.attempts - 1) });
    }
    const updated = await this.db.transaction(async (tx) => {
      await this.repo.consumeVerification(tx, v.id);
      const u = await this.users.update(tx, userId, { emailVerified: true });
      await this.outbox.record(tx, 'user.email_verified', { userId });
      return u!;
    });
    this.outbox.kick();
    return { user: toPublicUser(updated) };
  }

  // ---------- Ajustes ----------
  settingsDto(u: UserRow) {
    return {
      account: {
        name: u.name,
        lastName: u.lastName,
        email: u.email,
        emailVerified: u.emailVerified,
        avatarUrl: u.avatarUrl,
        grammaticalGender: u.grammaticalGender,
      },
      chef: u.settings.chef,
      notifications: u.settings.notifications,
    };
  }

  async settings(userId: string) {
    return this.settingsDto(await this.userOrThrow(userId));
  }

  async updateSettings(userId: string, patch: SettingsPatch) {
    const user = await this.userOrThrow(userId);
    let avatarUrl: string | null | undefined;
    if (patch.account?.avatarMediaId !== undefined) {
      if (patch.account.avatarMediaId === null) avatarUrl = null;
      else {
        const m = await this.media.ownedUploaded(userId, patch.account.avatarMediaId);
        if (!m || m.purpose !== 'avatar') throw Errors.validation([field('account.avatarMediaId', 'INVALID_OPTION', 'La foto no existe o no terminó de subir.')]);
        avatarUrl = this.storage.publicUrl(m.storageKey);
      }
    }
    const sections = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
    const updated = await this.db.transaction(async (tx) => {
      const u = await this.users.update(tx, userId, {
        ...(patch.account?.name !== undefined ? { name: patch.account.name.trim() } : {}),
        ...(patch.account?.lastName !== undefined ? { lastName: patch.account.lastName?.trim() || null } : {}),
        ...(patch.account?.grammaticalGender !== undefined ? { grammaticalGender: patch.account.grammaticalGender } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        settings: {
          chef: { ...user.settings.chef, ...(patch.chef ?? {}) },
          notifications: { ...user.settings.notifications, ...(patch.notifications ?? {}) },
        },
      });
      if (patch.account?.avatarMediaId) await this.media.attach(tx, patch.account.avatarMediaId);
      await this.outbox.record(tx, 'user.settings_updated', { userId, sections });
      return u!;
    });
    this.outbox.kick();
    return this.settingsDto(updated);
  }

  // ---------- Exportación de datos ----------
  async requestExport(userId: string) {
    await this.userOrThrow(userId);
    const id = newId('event').replace('evt_', 'exp_');
    await this.repo.insertExport({ id, userId, status: 'processing' });
    await this.outbox.publish('data_export.requested', { userId, exportId: id });
    return { exportId: id, status: 'processing' as const };
  }

  /** Lo corre el observer de `data_export.requested`. */
  async buildExport(userId: string, exportId: string) {
    const user = await this.users.findById(userId);
    if (!user) return;
    const tables: Record<string, unknown[]> = {};
    for (const t of EXPORT_TABLES) {
      const col = t === 'follows' ? 'follower_id' : 'user_id';
      const r = await this.db.execute(sql.raw(`select * from ${t} where ${col} = '${userId.replace(/'/g, "''")}'`));
      tables[t] = r.rows;
    }
    const lists = (tables.shopping_lists ?? []) as { id: string }[];
    if (lists.length) {
      const ids = lists.map((l) => `'${l.id.replace(/'/g, "''")}'`).join(',');
      tables.shopping_list_items = (await this.db.execute(sql.raw(`select * from shopping_list_items where list_id in (${ids})`))).rows;
    }
    const { passwordHash: _omit, ...profile } = user;
    void _omit;
    // Historial de actividad: el stream del usuario en el event store.
    const activity = (await this.events.readStream(userId)).map((e) => ({ type: e.type, version: e.version, occurredAt: e.occurredAt.toISOString(), payload: e.payload }));
    const doc = { exportedAt: new Date().toISOString(), profile, ...tables, ...(await this.repo.mongoExport(userId)), activity };
    const key = `exports/${userId}/${exportId}.json`;
    await this.storage.put(key, Buffer.from(JSON.stringify(doc, null, 2)), 'application/json');
    await this.repo.updateExport(exportId, { status: 'ready', fileKey: key, expiresAt: new Date(Date.now() + EXPORT_TTL_DAYS * 86_400_000) });
    await this.mailer.send({ to: user.email, subject: 'Tus datos de Noshy están listos', text: 'Entra a Ajustes › Privacidad para descargarlos. El enlace dura 7 días.', tag: 'dataExport' });
  }

  async exportStatus(userId: string, exportId: string) {
    const e = await this.repo.exportById(userId, exportId);
    if (!e) throw Errors.notFound('Esa exportación no existe.');
    return {
      id: e.id,
      status: e.status,
      expiresAt: e.expiresAt?.toISOString() ?? null,
      downloadPath: e.status === 'ready' ? `/api/v1/me/data-exports/${e.id}/download` : null,
    };
  }

  async exportFile(userId: string, exportId: string) {
    const e = await this.repo.exportById(userId, exportId);
    if (!e || e.status !== 'ready' || !e.fileKey) throw Errors.notFound('Esa exportación no está lista.');
    if (e.expiresAt && e.expiresAt < new Date()) throw Errors.gone('EXPORT_EXPIRED', 'El enlace venció. Pide una exportación nueva.');
    const file = await this.storage.get(e.fileKey);
    if (!file) throw Errors.notFound();
    return file;
  }

  // ---------- Borrar cuenta ----------
  async deleteAccount(userId: string) {
    await this.userOrThrow(userId);
    await this.db.transaction(async (tx) => {
      const keys = [
        ...(await tx.select({ k: media.storageKey }).from(media).where(eq(media.userId, userId))).map((r) => r.k),
        ...(await tx.select({ k: receipts.fileKey }).from(receipts).where(eq(receipts.userId, userId))).map((r) => r.k),
        ...(await tx.select({ k: dataExports.fileKey }).from(dataExports).where(eq(dataExports.userId, userId))).map((r) => r.k).filter((k): k is string => !!k),
      ];
      await this.repo.retireAuthoredRecipes(tx, userId);
      await tx.delete(users).where(eq(users.id, userId));
      await this.outbox.record(tx, 'user.deleted', { userId, storageKeys: keys });
    });
    this.outbox.kick();
  }

  /**
   * Lo corre el observer de `user.deleted`: borra Mongo, archivos y el stream del usuario en el event store.
   * Del stream queda solo el evento `user.deleted` como lápida (sin datos personales: IDs y llaves de archivo).
   */
  async purge(userId: string, storageKeys: string[]) {
    await this.repo.purgeMongo(userId);
    await this.events.deleteStream(this.db, userId, { keepTypes: ['user.deleted'] });
    for (const k of storageKeys) await this.storage.delete(k);
  }
}
