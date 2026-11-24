/**
 * Mise en place por paso: qué ingredientes se usan en cada uno. Si la receta lo dice (`ingredientIds`) se respeta;
 * si no, se deduce del texto. Cada ingrediente va, con toda su cantidad, en el paso donde se usa por primera vez,
 * y ninguno se pierde: el que no se menciona queda en el primer paso.
 */
export type StepText = { text: string; ingredientIds?: string[] };
export type StepIngredient = { id: string; label: string; categoryId?: string };

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'en', 'al', 'para', 'por', 'una', 'uno', 'y', 'aa']);
/** Primeras palabras que no identifican al ingrediente por sí solas: «salsa» puede ser cualquier salsa. */
const VAGUE = new Set(['salsa', 'pasta', 'crema', 'harina', 'aceite', 'queso', 'polvo', 'jugo', 'caldo', 'leche', 'pan', 'alga', 'baby', 'fresco', 'fresca', 'molido', 'molida', 'entera', 'entero', 'lomo', 'bebida', 'avena', 'maiz', 'tomate']);
const CATEGORY: Record<string, RegExp> = {
  produce: /\b(?:vegetales|verduras|hortalizas)\b/,
  protein: /\b(?:carne|proteina)\b/,
  seafood: /\b(?:pescado|mariscos)\b/,
  spices: /\b(?:especias|sazona\w*|condimenta\w*|salpimienta\w*|salpimenta\w*)\b/,
};
/** Así se les dice en los pasos aunque la lista diga el nombre exacto. */
const ALSO: [RegExp, RegExp][] = [
  [/\b(?:espagueti|rigatoni|macarron(?:es)?|fideos?|tallarin(?:es)?|lasana|penne|fusilli)\b/, /\b(?:pasta|fideos?)\b/],
  [/\bcamaron(?:es)?\b/, /\bmariscos\b/],
  [/\b(?:res|carne|lomo)\b/, /\bcarne\b/],
  [/^aceite\b/, /\b(?:frie\w*|freir|sofrie\w*|saltea\w*|dora\w*|asa|sella\w*)\b/],
];
const EVERYTHING = /\b(?:todos? los ingredientes|(?:mezcla|junta|licua|combina|corta|pica) todo|todo junto|los demas ingredientes|resto de (?:los )?ingredientes)\b/;

const singular = (w: string) => (w.length > 4 ? w.replace(/(?:es|s)$/, '') : w);
/** Palabra corta, exacta («sal» no es «salsa»); larga, por raíz («camarones» ~ «camarón»). */
const same = (token: string, word: string) => token === word || token === `${word}s` || singular(token) === singular(word) || (word.length >= 5 && token.startsWith(singular(word)));

/** Qué tan claro menciona el texto al ingrediente: 0 = nada. */
function strength(text: string, words: string[], ing: StepIngredient): number {
  const inText = tokens(text);
  const has = (w: string) => inText.some((t) => same(t, w));
  if (words.length > 1 && words.every(has)) return 4;
  const hits = words.filter(has);
  if (hits.some((w) => !VAGUE.has(w))) return 3;
  if (hits.length) return 2;
  if (ALSO.some(([name, mention]) => name.test(norm(ing.label)) && mention.test(norm(text)))) return 1.5;
  return ing.categoryId && CATEGORY[ing.categoryId]?.test(norm(text)) ? 1 : 0;
}

/** Posiciones de `ingredients` que se usan en cada paso. */
export function assignStepIngredients(steps: StepText[], ingredients: StepIngredient[]): number[][] {
  const out: number[][] = steps.map(() => []);
  if (steps.length === 0) return out;
  const declared = steps.some((s) => s.ingredientIds?.length);
  ingredients.forEach((ing, i) => {
    let at = declared ? steps.findIndex((s) => s.ingredientIds?.includes(ing.id)) : -1;
    if (at < 0) {
      const words = tokens(ing.label).filter((w) => w.length > 2 && !STOP.has(w));
      let best = 0;
      steps.forEach((s, j) => {
        const n = strength(s.text, words, ing);
        if (n > best) [best, at] = [n, j];
      });
    }
    if (at < 0) at = steps.findIndex((s) => EVERYTHING.test(norm(s.text)));
    out[Math.max(0, at)]!.push(i);
  });
  return out;
}
