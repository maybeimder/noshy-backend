import type { FastifyInstance } from 'fastify';
import { DEFAULT_TZ, isValidTimeZone } from '../../../core/shared/time.js';

/** `X-Timezone: America/Bogota` → `request.tz`. Valor inválido o ausente: zona por defecto. */
export function registerTimezone(app: FastifyInstance) {
  app.decorateRequest('tz', DEFAULT_TZ);
  app.addHook('onRequest', async (request) => {
    const raw = request.headers['x-timezone'];
    const tz = Array.isArray(raw) ? raw[0] : raw;
    request.tz = tz && isValidTimeZone(tz) ? tz : DEFAULT_TZ;
  });
}
