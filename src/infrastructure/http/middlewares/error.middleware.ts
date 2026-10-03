import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';

type HttpError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

export function notFoundMiddleware(_request: Request, response: Response, next: NextFunction) {
  if (response.headersSent) {
    next();
    return;
  }

  response.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'Ruta no encontrada.'
    }
  });
}

export const errorMiddleware: ErrorRequestHandler = (error: HttpError, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error.type === 'entity.parse.failed') {
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
  response.status(status).json({
    error: {
      code: isClientError ? 'REQUEST_ERROR' : 'INTERNAL_SERVER_ERROR',
      message: isClientError ? error.message || 'La solicitud no es válida.' : 'Error interno del servidor.'
    }
  });
};
