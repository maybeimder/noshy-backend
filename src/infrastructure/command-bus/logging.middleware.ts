import type { FastifyBaseLogger } from 'fastify';
import type { CommandMiddleware } from '../../core/commands/command-bus.js';
import { AppError } from '../../core/shared/errors.js';

/** Deja en el log qué comando se ejecutó, de quién y cuánto tardó. Sin payload: puede traer datos sensibles. */
export const logCommands =
  (log: FastifyBaseLogger): CommandMiddleware =>
  async (ctx, next) => {
    const start = performance.now();
    const info = () => ({ command: ctx.type, userId: ctx.userId, ms: Math.round(performance.now() - start) });
    try {
      const result = await next();
      log.debug(info(), 'comando ejecutado');
      return result;
    } catch (err) {
      // Un rechazo de negocio (404, 409, 422) es normal; el error inesperado lo registra el manejador HTTP.
      log.debug({ ...info(), code: err instanceof AppError ? err.code : 'UNEXPECTED' }, 'comando rechazado');
      throw err;
    }
  };
