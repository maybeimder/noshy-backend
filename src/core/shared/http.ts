/** Envoltorio de respuestas del contrato: `{ data, meta? }`. */
export type PageMeta = { nextCursor: string | null; limit: number; facets?: unknown[]; filters?: unknown[] };

export const ok = <T>(data: T) => ({ data });
export const page = <T>(data: T[], meta: PageMeta) => ({ data, meta });
