// Relevancia del catálogo. Ordenar solo por `popularity` devolvía salchichas para "pollo" y maní para
// "pimienta": lo más popular suele ser un procesado donde la palabra buscada es un sabor o un ingrediente
// secundario. Aquí se puntúa qué tanto el producto ES el alimento buscado.
import { normalizeSearchText } from './food-catalog.port';
import type { FoodCandidate } from './food.model';

// Palabras que indican un producto procesado / preparado. No penalizan si el usuario las buscó.
const PROCESSED_WORDS = new Set([
  'salchicha', 'salchichas', 'salchichon', 'jamon', 'mortadela', 'chorizo', 'butifarra', 'nuggets', 'nugget', 'apanado', 'apanados',
  'apanada', 'milanesa', 'hamburguesa', 'hamburguesas', 'pinchos', 'sabor', 'papas', 'chips', 'galleta', 'galletas', 'crema', 'sopa',
  'ramen', 'ravioli', 'lasagna', 'lasana', 'wrap', 'empanada', 'tamal', 'pasabocas', 'snack', 'snacks', 'rizadas', 'onduladas',
  'trocillo', 'crispetas', 'tostadas', 'molde', 'salsa', 'sazonador', 'aderezo', 'vinagreta', 'mostaneza', 'mayonesa', 'pasta',
  'barra', 'barras', 'cereal', 'bebida', 'gaseosa', 'refresco', 'helado', 'dulce', 'chocolatada', 'achocolatado', 'mani', 'pita',
  'relleno', 'rellena', 'adobadas', 'marinados', 'teriyaki', 'bbq', 'ensalada', 'sandwich', 'triple', 'compota', 'mermelada',
  'yogurt', 'kumis', 'arequipe', 'saltado', 'parrillero', 'anillos', 'punch', 'pan', 'tajado', 'condensada', 'hojuelas',
  'brownie', 'chocolate', 'cocoa', 'milo', 'ahumado', 'ahumada', 'fosforitos'
]);

// Marcas de snacks: sus productos se llaman como el sabor ("Margarita Pollo", "Pringles Queso").
const SNACK_BRANDS = ['margarita', 'de todito', 'yupi', 'pringles', 'super ricas', 'monterojo', 'monte rojo', 'munchy', 'kythos', 'frito lay', 'la victoria', 'tosh', 'manitoba', 'jacks', 'cheetos', 'doritos', 'natuchips'];

// Cortes y presentaciones de un alimento básico: "PECHUGA de pollo" sí es pollo.
const CUT_WORDS = new Set([
  'pechuga', 'pechugas', 'muslo', 'muslos', 'contramuslo', 'contramuslos', 'entremuslos', 'filete', 'filetes', 'alas', 'lomo',
  'lomitos', 'pierna', 'pernil', 'costilla', 'costillas', 'chuleta', 'chuletas', 'entero', 'entera', 'molida', 'molido', 'grano', 'polvo'
]);

// Grupos de Open Food Facts típicos de ultraprocesados o platos compuestos.
const PROCESSED_GROUPS = new Set([
  'processed-meat', 'salty-snacks', 'sugary-snacks', 'sweets', 'biscuits-and-cakes', 'appetizers', 'sweetened-beverages',
  'one-dish-meals', 'composite-foods', 'dressings-and-sauces', 'breakfast-cereals', 'pizza-pies-and-quiches', 'sandwiches',
  'ice-cream', 'chocolate-products', 'artificially-sweetened-beverages'
]);

// Grupos de alimentos básicos / poco procesados.
const BASIC_GROUPS = new Set([
  'meat', 'poultry', 'fish-and-seafood', 'fish', 'eggs', 'fruits', 'vegetables', 'legumes', 'cereals', 'milk-and-yogurt',
  'cheese', 'nuts', 'fats', 'potatoes', 'dried-fruits', 'fruits-and-vegetables'
]);

// Conectores tras los que la palabra buscada es secundaria: "papas SABOR pollo", "avena SIN azúcar", "CERO azúcar".
const SECONDARY_MARKERS = new Set(['sabor', 'con', 'sin', 'y', 'al', 'a', 'la', 'sobre', 'aroma', 'cero', 'menos', 'bajo', 'baja', 'reducido', 'light']);
// Varios alimentos en un mismo producto ("Arveja zanahoria y maíz", "Mix de verduras").
const COMPOUND_MARKERS = new Set(['y', 'con', 'mix', 'mezcla', 'surtido']);

export type RankedFood = FoodCandidate & { score: number; reliable: boolean };

const tokens = (text: string) => normalizeSearchText(text).split(/[^a-z0-9]+/).filter(Boolean);

// Palabra completa, admitiendo plural: "sal" no es "salchicha", pero "pimienta" sí es "pimientas".
export function sameWord(token: string, term: string): boolean {
  return (
    token === term ||
    token === `${term}s` ||
    token === `${term}es` ||
    (term.endsWith('z') && token === `${term.slice(0, -1)}ces`) ||
    (term.endsWith('es') && token === term.slice(0, -2)) ||
    (term.endsWith('s') && token === term.slice(0, -1))
  );
}

export function rankFoods(terms: string[], candidates: FoodCandidate[]): RankedFood[] {
  const ranked = candidates.map((candidate) => {
    const brand = normalizeSearchText(candidate.brand);
    const brandTokens = new Set(candidate.brand === 'generic' ? [] : tokens(candidate.brand));
    // El nombre sin la marca ("Manitoba Maní..." -> "maní..."): la marca no describe el alimento.
    const nameTokens = tokens(candidate.name).filter((token, _index, all) => !(brandTokens.has(token) && all.length > 1));
    const isTerm = (token: string) => terms.some((term) => sameWord(token, term));
    // Mientras el usuario escribe ("pol") el prefijo también vale, pero puntúa menos y nunca es confiable.
    const isPrefix = (token: string) => terms.some((term) => token.startsWith(term));

    const wordPosition = nameTokens.findIndex(isTerm);
    const position = wordPosition >= 0 ? wordPosition : nameTokens.findIndex(isPrefix);
    const wholeWord = wordPosition >= 0;

    let score = 0;
    // 1. El término es el núcleo del nombre ("Pollo ...", "Pimienta ..."). Palabra completa > prefijo.
    if (position === 0) score += wholeWord ? 30 : 12;
    else if (position > 0) score += Math.max(0, (wholeWord ? 14 : 6) - position * 2);

    // 2. El término aparece como sabor o acompañante ("sabor pollo", "con pimienta").
    const secondary = position > 0 && SECONDARY_MARKERS.has(nameTokens[position - 1]);
    if (secondary) score -= 25;

    // 3. Producto procesado (por nombre, grupo o marca de snacks), salvo que el usuario lo haya buscado.
    const processedWord = nameTokens.some((token) => PROCESSED_WORDS.has(token) && !isTerm(token));
    if (processedWord) score -= 20;
    // Un producto que se llama exactamente como lo buscado ("Azúcar") lo es, aunque OFF lo agrupe en "sweets".
    const exactName = wordPosition === 0 && nameTokens.every((token) => isTerm(token) || CUT_WORDS.has(token) || /^\d+$/.test(token));
    const processedGroup = !exactName && candidate.foodGroups.some((group) => PROCESSED_GROUPS.has(group));
    if (processedGroup) score -= 12;
    const snackBrand = SNACK_BRANDS.some((snack) => brand.includes(snack));
    if (snackBrand) score -= 20;
    const compound = nameTokens.some((token) => COMPOUND_MARKERS.has(token));
    if (compound) score -= 10;
    if (candidate.foodGroups.some((group) => BASIC_GROUPS.has(group))) score += 5;
    if (nameTokens.some((token) => CUT_WORDS.has(token) && !isTerm(token))) score += 12;
    if (candidate.nova === 1) score += 8;
    else if (candidate.nova === 4) score -= 8;

    // 4. Cuanto menos texto extra, más se parece a lo buscado.
    const extra = nameTokens.filter((token) => !isPrefix(token) && token.length > 2 && !CUT_WORDS.has(token)).length;
    score -= Math.min(extra, 8) * 2;
    if (extra === 0 && wholeWord) score += 15;

    // 5. Desempate: popularidad y datos completos.
    score += Math.log10(1 + candidate.popularity) * 3 + candidate.completeness * 5;

    // Confiable para calcular macros: el producto ES el alimento, no un sabor, mezcla o derivado.
    const reliable = wholeWord && !secondary && !processedWord && !processedGroup && !snackBrand && !compound;
    return { ...candidate, score: Math.round(score * 10) / 10, reliable };
  });

  return ranked.sort((left, right) => Number(right.reliable) - Number(left.reliable) || right.score - left.score);
}
