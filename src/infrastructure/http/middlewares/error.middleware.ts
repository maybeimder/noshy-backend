import type { FastifyInstance, FastifyError } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../../../core/shared/errors.js';

/**
 * Convierte cualquier error al formato del contrato: `{ error: { code, message, details? } }`.
 * Los errores de validación de zod salen como 422 con `details` por campo (`goals.ids`).
 */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const details = err.validation.map((v) => ({
        field: v.instancePath.replace(/^\//, '').replace(/\//g, '.') || String((v.params as { issue?: { path?: unknown[] } })?.issue?.path?.join('.') ?? ''),
        code: String((v.params as { issue?: { code?: string } })?.issue?.code ?? v.keyword ?? 'invalid').toUpperCase(),
        message: v.message ?? 'Valor inválido.',
      }));
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Revisa los campos marcados.', details } });
    }
    const status = err.statusCode ?? 500;
    if (status === 429) return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Intenta en un momento.' } });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE' || status === 413)
      return reply.status(413).send({ error: { code: 'FILE_TOO_LARGE', message: 'El archivo es demasiado grande.' } });
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || status === 415)
      return reply.status(415).send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Ese tipo de contenido no es compatible.' } });
    if (status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    request.log.error({ err }, 'error no controlado');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Algo salió mal de nuestro lado. Intenta de nuevo.' } });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: `No existe ${request.method} ${request.url.split('?')[0]}.` } }),
  );
}
