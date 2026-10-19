import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import { applicationLogger } from '../../observability/logger';

type HttpError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

type RequestWithId = Request & { requestId?: string };

export function notFoundMiddleware(request: Request, response: Response, next: NextFunction) {
  if (response.headersSent) {
    next();
    return;
  }

  applicationLogger.warn('http.request.not_found', `Ruta no encontrada: ${request.method} ${request.originalUrl}`, {
    requestId: (request as RequestWithId).requestId,
    method: request.method,
    path: request.path,
    query: request.query
  });

  response.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'Ruta no encontrada.'
    }
  });
}

export const errorMiddleware: ErrorRequestHandler = (error: HttpError, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const requestId = (request as RequestWithId).requestId;

  if (error.type === 'entity.parse.failed') {
    applicationLogger.warn('http.request.invalid_json', `JSON inválido en ${request.method} ${request.originalUrl}`, {
      requestId,
      method: request.method,
      path: request.path
    });
    response.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'El cuerpo de la solicitud no contiene JSON válido.'
      }
    });
    return;
  }

  const status = error.statusCode ?? error.status ?? 500;
  const isClientError = status >= 400 && status < 500;

  applicationLogger.log(isClientError ? 'warn' : 'error', 'http.request.failed', `${request.method} ${request.originalUrl} -> ${status}: ${error.message}`, {
    requestId,
    method: request.method,
    path: request.path,
    status,
    error: error.message,
    ...(isClientError ? {} : { stack: error.stack })
  });

  response.status(status).json({
    error: {
      code: isClientError ? 'REQUEST_ERROR' : 'INTERNAL_SERVER_ERROR',
      message: isClientError ? error.message || 'La solicitud no es válida.' : 'Error interno del servidor.'
    }
  });
};
