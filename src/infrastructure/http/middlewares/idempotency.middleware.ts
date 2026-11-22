import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { idempotencyKeys } from '../../database/postgres/infra.model.js';
import { Errors } from '../../../core/shared/errors.js';

/**
 * `Idempotency-Key`: la primera respuesta exitosa (o 4xx) se guarda por usuario + ruta.
 * Un reintento con la misma key devuelve exactamente esa respuesta, con `Idempotent-Replayed: true`.
 * Sin header, la ruta funciona normal.
 */
export function registerIdempotency(app: FastifyInstance) {
  const db = () => app.container.pg.db;

  app.decorate('idempotent', async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.headers['idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key) return;
    if (key.length > 200) throw Errors.badRequest('Idempotency-Key demasiado larga.');
    const route = `${request.method} ${request.routeOptions.url}`;
    const userId = request.user?.id ?? 'anonymous';
    const inserted = await db().insert(idempotencyKeys).values({ userId, key, route }).onConflictDoNothing().returning();
    if (inserted.length === 0) {
      const [row] = await db()
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key), eq(idempotencyKeys.route, route)));
      if (row?.statusCode) {
        return reply.status(row.statusCode).header('idempotent-replayed', 'true').send(row.response);
      }
      throw Errors.conflict('IDEMPOTENCY_IN_PROGRESS', 'Ya estamos procesando esta misma solicitud.');
    }
    request.idempotencyClaim = { key, route };
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const claim = request.idempotencyClaim;
    if (!claim) return payload;
    const userId = request.user?.id ?? 'anonymous';
    const where = and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, claim.key), eq(idempotencyKeys.route, claim.route));
    if (reply.statusCode >= 500) {
      await db().delete(idempotencyKeys).where(where);
    } else {
      let body: unknown = null;
      try {
        body = typeof payload === 'string' && payload.length ? JSON.parse(payload) : null;
      } catch {
        body = null;
      }
      await db().update(idempotencyKeys).set({ statusCode: reply.statusCode, response: body }).where(where);
    }
    return payload;
  });
}
