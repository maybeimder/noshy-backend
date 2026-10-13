// Tags de recetas inferidos de los ingredientes y el título. RecipeNLG no trae tags, así que se deducen
// con un léxico bilingüe (inglés para `ner`, español para las recetas generadas).
// Son orientativos: `allergens` lista lo DETECTADO ("contiene"), nunca garantiza ausencia. Por eso no se
// emiten tags del tipo "sin gluten".
import { normalizeSearchText } from './food-catalog.port';
import type { Nutrients } from './food.model';

export type RecipeTags = {
  diet: string[]; // vegetariana, vegana
  allergens: string[]; // contiene: gluten, leche, huevo...
  mealTypes: string[]; // postre, sopa, ensalada, desayuno...
  proteins: string[]; // pollo, res, cerdo, pescado...
  nutrition: string[]; // alto en proteína... (solo si hay macros)
  effort: string[]; // pocos ingredientes, rápida
};

type Lexicon = Record<string, string[]>;

// Cada entrada es un fragmento de regex que se busca como palabra completa sobre el texto normalizado.
const PROTEINS: Lexicon = {
  pollo: ['chicken', 'pollo', 'gallina'],
  res: ['beef', 'steak', 'ground chuck', 'hamburger', 'veal', 'res', 'carne molida', 'carne de res', 'sobrebarriga', 'lomo de res', 'ternera'],
  cerdo: ['pork', 'ham', 'bacon', 'sausages?', 'pepperoni', 'salami', 'prosciutto', 'chorizo', 'hot dogs?', 'wieners?', 'frankfurters?', 'cerdo', 'jamon', 'tocino', 'tocineta', 'chicharron', 'costillas? de cerdo', 'salchichas?', 'salchichon', 'mortadela'],
  pavo: ['turkey', 'pavo'],
  cordero: ['lamb', 'mutton', 'cordero'],
  pescado: ['fish', 'salmon', 'tuna', 'cod', 'tilapia', 'trout', 'halibut', 'haddock', 'catfish', 'sardines?', 'anchov(?:y|ies)', 'pescado', 'atun', 'bacalao', 'trucha', 'sardinas?', 'anchoas?', 'mojarra', 'robalo'],
  mariscos: ['shrimps?', 'prawns?', 'crabs?', 'crabmeat', 'lobsters?', 'clams?', 'oysters?', 'scallops?', 'mussels?', 'squid', 'camaron(?:es)?', 'langostinos?', 'cangrejos?', 'langostas?', 'almejas?', 'ostras?', 'mejillon(?:es)?', 'calamar(?:es)?'],
  huevo: ['eggs?', 'egg whites?', 'egg yolks?', 'huevos?', 'claras? de huevo', 'yemas?'],
  legumbres: ['beans?', 'lentils?', 'chickpeas?', 'garbanzos?', 'black beans', 'kidney beans', 'frijol(?:es)?', 'frisol(?:es)?', 'lentejas?', 'arvejas?'],
  tofu: ['tofu', 'tempeh']
};

const ANIMAL_FLESH = ['pollo', 'res', 'cerdo', 'pavo', 'cordero', 'pescado', 'mariscos'];

const ALLERGENS: Lexicon = {
  gluten: ['flour', 'all-purpose flour', 'bread', 'breadcrumbs', 'bread crumbs', 'crackers?', 'cracker crumbs', 'graham crackers?', 'pasta', 'noodles', 'spaghetti', 'macaroni', 'lasagna', 'wheat', 'barley', 'rye', 'couscous', 'beer', 'soy sauce', 'cake mix', 'bisquick', 'biscuits?', 'croutons', 'harina', 'harina de trigo', 'pan', 'pan rallado', 'fideos', 'trigo', 'galletas?', 'cebada', 'centeno', 'cerveza', 'salsa de soya', 'cuscus', 'apanado'],
  leche: ['milk', 'butter', 'cheese', 'cream', 'yogh?urt', 'buttermilk', 'sour cream', 'cream cheese', 'half-and-half', 'ghee', 'whey', 'parmesan', 'mozzarella', 'cheddar', 'ricotta', 'evaporated milk', 'condensed milk', 'leche', 'mantequilla', 'queso', 'crema de leche', 'yogur', 'kumis', 'cuajada', 'arequipe', 'suero costeno'],
  huevo: ['eggs?', 'egg whites?', 'egg yolks?', 'mayonnaise', 'huevos?', 'claras?', 'yemas?', 'mayonesa'],
  'maní': ['peanuts?', 'peanut butter', 'mani', 'cacahuates?', 'crema de mani'],
  'frutos secos': ['nuts', 'walnuts?', 'pecans?', 'almonds?', 'cashews?', 'hazelnuts?', 'pistachios?', 'macadamia', 'nuez', 'nueces', 'almendras?', 'maranon(?:es)?', 'avellanas?', 'pistachos?'],
  soya: ['soy', 'soy sauce', 'soybeans?', 'tofu', 'edamame', 'soya', 'salsa de soya'],
  pescado: PROTEINS.pescado,
  mariscos: PROTEINS.mariscos,
  'ajonjolí': ['sesame', 'sesame seeds', 'tahini', 'ajonjoli', 'sesamo']
};

// Frases que contienen una palabra del léxico pero no el alérgeno (ej. "peanut butter" no es lácteo).
const NOT_DAIRY = /\b(?:peanut|almond|cashew|apple|cocoa|coconut|soy|oat|rice|shea)\s+(?:butter|milk|cream)\b|\bcream of tartar\b|\b(?:leche|crema) de (?:coco|almendras?|soya|avena|arroz|mani)\b|\bmantequilla de mani\b/g;
const NOT_GLUTEN = /\b(?:rice|almond|corn|coconut|cassava|potato) (?:flour|pasta|noodles)\b|\bharina de (?:maiz|arroz|almendras?|yuca|coco)\b|\bpasta de (?:tomate|mani|ajo)\b|\bpan de yuca\b/g;

const MEAL_TYPES: Lexicon = {
  postre: ['cakes?', 'cookies?', 'brownies?', 'fudge', 'candy', 'pudding', 'cobbler', 'tarts?', 'cupcakes?', 'frosting', 'icing', 'ice cream', 'cheesecake', 'desserts?', 'truffles?', 'mousse', 'pies?', 'torta', 'postre', 'flan', 'helado', 'bizcocho', 'ponque', 'arroz con leche', 'galletas?'],
  sopa: ['soups?', 'stew', 'chowder', 'chili', 'bisque', 'gumbo', 'sopa', 'caldo', 'sancocho', 'ajiaco', 'crema de', 'guiso', 'consome'],
  ensalada: ['salads?', 'slaw', 'ensalada'],
  'panadería': ['bread', 'biscuits', 'muffins?', 'buns', 'loaf', 'scones?', 'pan', 'arepas?', 'almojabanas?', 'pandebonos?'],
  bebida: ['punch', 'smoothie', 'shake', 'lemonade', 'tea', 'cocktail', 'drink', 'juice', 'jugo', 'batido', 'limonada', 'bebida', 'malteada', 'colada'],
  desayuno: ['pancakes?', 'waffles?', 'omelett?e', 'french toast', 'granola', 'breakfast', 'oatmeal', 'desayuno', 'huevos revueltos', 'calentado', 'avena', 'changua']
};
// "Pollo en salsa" no es una salsa: solo cuenta si la salsa ES la receta (al inicio en español, al final en inglés).
const SAUCE = /^(?:salsa|aderezo|vinagreta|hogao|guacamole)\b|\b(?:sauce|dressing|dip|gravy|marinade|salsa)$/;

const compile = (lexicon: Lexicon) =>
  Object.entries(lexicon).map(([tag, words]) => [tag, new RegExp(`\\b(?:${words.join('|')})\\b`)] as const);

const PROTEIN_PATTERNS = compile(PROTEINS);
const ALLERGEN_PATTERNS = compile(ALLERGENS);
const MEAL_TYPE_PATTERNS = compile(MEAL_TYPES);
const HONEY = /\b(?:honey|miel)\b/;
const GELATIN = /\b(?:gelatin|gelatina)\b/;

// Alérgenos de Open Food Facts (products_slim.allergens) -> mismo vocabulario en español.
const OFF_ALLERGENS: Record<string, string> = {
  gluten: 'gluten',
  milk: 'leche',
  eggs: 'huevo',
  peanuts: 'maní',
  nuts: 'frutos secos',
  soybeans: 'soya',
  fish: 'pescado',
  crustaceans: 'mariscos',
  molluscs: 'mariscos',
  'sesame-seeds': 'ajonjolí',
  celery: 'apio',
  mustard: 'mostaza',
  'sulphur-dioxide-and-sulphites': 'sulfitos',
  lupin: 'altramuz'
};

export function offAllergensToTags(allergens: string[]): string[] {
  return allergens.flatMap((allergen) => {
    const tag = OFF_ALLERGENS[allergen.replace(/^[a-z]{2}:/, '')];
    return tag ? [tag] : [];
  });
}

const matching = (patterns: (readonly [string, RegExp])[], text: string) => patterns.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);

export type TagInput = {
  title: string;
  // Nombres de ingredientes (ner en inglés o nombres en español).
  ingredients: string[];
  steps?: number;
  // Datos del catálogo, si los hay (recetas generadas).
  productAllergens?: string[];
  productFoodGroups?: string[];
  mealType?: string;
  nutrientsPerServing?: Nutrients;
};

export function inferRecipeTags(input: TagInput): RecipeTags {
  const ingredientsText = normalizeSearchText(input.ingredients.join(' | '));
  const title = normalizeSearchText(input.title);

  const proteins = matching(PROTEIN_PATTERNS, ingredientsText);
  // Cada excepción solo aplica a su alérgeno: "peanut butter" no es lácteo, pero sí es maní.
  const exceptions: Record<string, RegExp> = { leche: NOT_DAIRY, gluten: NOT_GLUTEN };
  const detected = ALLERGEN_PATTERNS.filter(([tag, pattern]) => pattern.test(exceptions[tag] ? ingredientsText.replace(exceptions[tag], ' ') : ingredientsText));
  const allergens = new Set([...detected.map(([tag]) => tag), ...offAllergensToTags(input.productAllergens ?? [])]);

  const groups = input.productFoodGroups ?? [];
  const hasFlesh =
    proteins.some((protein) => ANIMAL_FLESH.includes(protein)) ||
    GELATIN.test(ingredientsText) ||
    groups.some((group) => ['meat', 'poultry', 'processed-meat', 'fish-and-seafood', 'fish', 'seafood', 'offals'].includes(group));
  const hasAnimalProduct =
    allergens.has('leche') || allergens.has('huevo') || HONEY.test(ingredientsText) || groups.some((group) => ['milk-and-dairy-products', 'cheese', 'eggs', 'dairy-desserts', 'milk-and-yogurt'].includes(group));
  const diet = hasFlesh ? [] : hasAnimalProduct ? ['vegetariana'] : ['vegetariana', 'vegana'];

  let mealTypes = matching(MEAL_TYPE_PATTERNS, title);
  if (SAUCE.test(title.trim())) mealTypes.push('salsa');
  // "chicken pot pie" no es un postre.
  if (hasFlesh) mealTypes = mealTypes.filter((type) => type !== 'postre');
  if (input.mealType) mealTypes = [...new Set([input.mealType, ...mealTypes])];

  const effort: string[] = [];
  if (input.ingredients.length <= 5) effort.push('pocos ingredientes');
  if (input.steps !== undefined && input.steps <= 4 && input.ingredients.length <= 8) effort.push('rápida');

  return {
    diet,
    allergens: [...allergens].sort(),
    mealTypes,
    proteins,
    nutrition: nutritionTags(input.nutrientsPerServing),
    effort
  };
}

// Por porción. Solo se emiten si el nutriente está calculado.
function nutritionTags(perServing?: Nutrients): string[] {
  if (!perServing) return [];
  const tags: string[] = [];
  const value = (key: keyof Nutrients) => (typeof perServing[key] === 'number' ? (perServing[key] as number) : null);
  const protein = value('protein_g');
  const carbs = value('carbs_g');
  const kcal = value('kcal');
  const fiber = value('fiber_g');
  const sodium = value('sodium_mg');
  const sugars = value('sugars_g');
  if (protein !== null && protein >= 20) tags.push('alto en proteína');
  if (carbs !== null && kcal !== null && kcal > 0 && carbs <= 15) tags.push('bajo en carbohidratos');
  if (kcal !== null && kcal > 0 && kcal <= 400) tags.push('bajo en calorías');
  if (fiber !== null && fiber >= 6) tags.push('alto en fibra');
  if (sodium !== null && sodium >= 800) tags.push('alto en sodio');
  if (sugars !== null && sugars >= 25) tags.push('alto en azúcares');
  return tags;
}
