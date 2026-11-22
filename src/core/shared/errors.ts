/**
 * Errores de aplicación. Cada uno lleva el `code` estable del contrato y el status HTTP.
 * El error handler global los convierte en `{ error: { code, message, details? } }`.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export type FieldError = { field: string; code: string; message: string };

export const Errors = {
  badRequest: (message = 'Solicitud inválida.', details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details),
  unauthorized: (code = 'UNAUTHORIZED', message = 'Necesitas iniciar sesión.') => new AppError(401, code, message),
  forbidden: (code = 'FORBIDDEN', message = 'No tienes permiso para esto.') => new AppError(403, code, message),
  notFound: (message = 'No encontramos lo que buscas.') => new AppError(404, 'NOT_FOUND', message),
  conflict: (code: string, message: string, details?: unknown) => new AppError(409, code, message, details),
  gone: (code: string, message: string, details?: unknown) => new AppError(410, code, message, details),
  validation: (details: FieldError[], message = 'Revisa los campos marcados.') =>
    new AppError(422, 'VALIDATION_ERROR', message, details),
  unprocessable: (code: string, message: string, details?: unknown) => new AppError(422, code, message, details),
  tooLarge: (message = 'El archivo es demasiado grande.') => new AppError(413, 'FILE_TOO_LARGE', message),
  unsupportedMedia: (message = 'Ese tipo de archivo no es compatible.') => new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message),
  onboardingIncomplete: () =>
    new AppError(409, 'ONBOARDING_INCOMPLETE', 'Primero termina de configurar tu chef.'),
};

export const field = (fieldPath: string, code: string, message: string): FieldError => ({ field: fieldPath, code, message });
