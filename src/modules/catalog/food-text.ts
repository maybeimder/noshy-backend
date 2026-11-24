/** Normaliza igual que el campo `search` de products_slim: minúsculas y sin tildes. */
export const normalizeText = (text: string): string => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// Conectores que no describen el alimento («aceite DE oliva»): exigirlos solo agrega ruido.
const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'en', 'a', 'al', 'para', 'sin', 'por', 'un', 'una']);

/** Palabras de búsqueda: sin signos, sin conectores, sin repetidos, como mucho 6. */
export function searchTerms(query: string): string[] {
  const words = normalizeText(query).split(/[^a-z0-9]+/).filter(Boolean);
  const meaningful = words.filter((w) => !STOPWORDS.has(w));
  return [...new Set(meaningful.length ? meaningful : words)].slice(0, 6);
}

/** Raíz sin plural, para buscar por prefijo: «tomates» también encuentra «tomate». */
export const stem = (term: string): string => (term.length > 4 ? term.replace(/(es|s)$/, '') : term);
