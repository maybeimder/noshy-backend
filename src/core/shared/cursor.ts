import { Errors, field } from './errors.js';

/**
 * Cursor opaco para paginación keyset: base64url de `{ k, id }`,
 * donde `k` es el valor de la columna de orden e `id` desempata.
 */
export type Cursor = { k: string | number; id: string };

export const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (parsed && (typeof parsed.k === 'string' || typeof parsed.k === 'number') && typeof parsed.id === 'string') return parsed;
  } catch {
    /* cae al error de abajo */
  }
  throw Errors.validation([field('cursor', 'INVALID_CURSOR', 'El cursor no es válido.')]);
}

/** Corta una página pedida con limit+1 y arma el siguiente cursor. */
export function slicepage<T>(rows: T[], limit: number, toCursor: (last: T) => Cursor) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(toCursor(last)) : null };
}
