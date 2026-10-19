import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { applicationLogger } from '../../observability/logger';

export type RequestWithId = Request & { requestId?: string };

export function requestLogger(request: RequestWithId, response: Response, next: NextFunction) {
  const requestId = request.header('x-request-id')?.trim() || randomUUID();
  const startedAt = performance.now();
  request.requestId = requestId;
  response.setHeader('x-request-id', requestId);

  applicationLogger.info('http.request.started', `${request.method} ${request.originalUrl}`, {
    requestId,
    method: request.method,
    path: request.path,
    query: request.query,
    ip: request.ip,
    origin: request.header('origin') ?? undefined,
    userAgent: request.header('user-agent') ?? undefined,
    contentType: request.header('content-type') ?? undefined,
    contentLength: request.header('content-length') ?? undefined,
    authHeaderPresent: Boolean(request.header('authorization'))
  });

  let finished = false;
  const durationMs = () => Math.round((performance.now() - startedAt) * 100) / 100;

  response.once('finish', () => {
    finished = true;
    const level = response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info';
    applicationLogger.log(level, 'http.request.completed', `${request.method} ${request.originalUrl} -> ${response.statusCode}`, {
      requestId,
      method: request.method,
      path: request.path,
      statusCode: response.statusCode,
      durationMs: durationMs(),
      responseLength: response.getHeader('content-length') ?? undefined,
      // El body ya está parseado (express.json corrió antes del handler). Se redacta en el logger.
      ...(request.body && typeof request.body === 'object' && Object.keys(request.body as object).length > 0
        ? { body: request.body }
        : {})
    });
  });

  response.once('close', () => {
    if (finished) return;
    applicationLogger.warn('http.request.aborted', `${request.method} ${request.originalUrl} -> conexión cerrada sin respuesta`, {
      requestId,
      method: request.method,
      path: request.path,
      durationMs: durationMs()
    });
  });

  next();
}
