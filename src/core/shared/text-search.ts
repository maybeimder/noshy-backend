const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

/** Todas las palabras de `q`, sin tildes ni mayúsculas, en cualquiera de los textos. Sin palabras, todo coincide. */
export function matchesText(q: string | undefined, ...texts: (string | null | undefined)[]): boolean {
  const words = plain(q ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = plain(texts.filter(Boolean).join(' '));
  return words.every((w) => hay.includes(w));
}
