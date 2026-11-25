import { createHash } from 'node:crypto';

/**
 * Foto de referencia por tipo de plato, para recetas que no traen (`recipes_raw` no tiene ninguna) o que creó el chef.
 * Archivos en `src/assets/dishes` (CC0 o dominio público, ver CREDITS.md). El valor es cuántas hay de cada plato.
 */
export const DISH_PHOTOS: Record<string, number> = {
  cookies: 3, brownies: 3, cake: 3, 'chocolate-cake': 3, cupcakes: 1, cheesecake: 2, pie: 3, crumble: 2, pudding: 2, 'ice-cream': 3, candy: 2,
  bread: 3, 'quick-bread': 3, cornbread: 1, rolls: 3, pancakes: 2, waffles: 2, eggs: 2, omelette: 3, oatmeal: 2, granola: 2,
  soup: 3, 'tomato-soup': 3, chowder: 1, chili: 2, stew: 3, salad: 3, 'potato-salad': 2, 'pasta-salad': 1, 'tuna-salad': 2, fruit: 3, coleslaw: 2,
  pasta: 3, 'creamy-pasta': 2, lasagna: 3, pizza: 3, 'roast-chicken': 2, chicken: 3, 'fried-chicken': 3, curry: 3, wings: 2,
  beef: 3, ribs: 1, meatballs: 3, meatloaf: 1, pork: 2, fish: 4, shrimp: 3, rice: 3, 'white-rice': 1, grains: 1, 'green-beans': 2, broccoli: 1,
  potatoes: 2, 'sweet-potato': 1, mashed: 1, gratin: 2, vegetables: 2, casserole: 3, quiche: 2, tacos: 2, quesadilla: 1, burrito: 1, sandwich: 2, burger: 2,
  guacamole: 2, dip: 2, salsa: 1, jam: 2, smoothie: 3, drink: 2, coffee: 1, 'stir-fry': 3, arepa: 1, empanadas: 2, plantain: 1, tofu: 1,
};

/** Se ve carne o pescado: no van en una receta que no los lleva. */
const SHOWS_MEAT = new Set(['roast-chicken', 'chicken', 'fried-chicken', 'curry', 'wings', 'beef', 'ribs', 'meatballs', 'meatloaf', 'pork', 'chili', 'stew', 'burger', 'lasagna-3', 'pasta-1', 'pizza-2', 'pizza-3', 'sandwich-2', 'soup-2', 'stir-fry-2', 'stir-fry-3', 'tacos-1', 'gratin-2', 'rice-1', 'burrito-1', 'quesadilla-1', 'empanadas-1', 'empanadas-2', 'casserole-2', 'meatballs-2']);
const SHOWS_FISH = new Set(['fish', 'shrimp', 'tuna-salad', 'chowder', 'rice-3']);

/** Del plato más específico al más general; en español e inglés, sin tildes. Gana el primero que tenga fotos que sirvan. */
const DISHES: [string, RegExp][] = [
  ['casserole', /casseroles?|hot ?dish/],
  ['cheesecake', /cheese ?cake|torta de queso/],
  ['brownies', /brownies?|blondies?/],
  ['cupcakes', /cupcakes?|muffins?|ponquecitos?|panquecitos?/],
  ['coleslaw', /slaw|ensalada de repollo/],
  ['potato-salad', /potato salad|ensalada de papas?|ensaladilla/],
  ['pasta-salad', /(?:pasta|macaroni|noodle) salad|ensalada de pasta/],
  ['tuna-salad', /tuna|atun/],
  ['fruit', /fruit salad|ambrosia|waldorf|ensalada de frutas?|salpicon/],
  ['cornbread', /corn ?bread|hush ?pupp|spoon ?bread|corn muffins?|pan de maiz/],
  ['quick-bread', /(?:banana|zucchini|pumpkin|nut|date|cranberry|apple|carrot|monkey|gingerbread|soda|quick|lemon) ?bread|pan de (?:banano|calabaza|zanahoria)|torta de banano|banana loaf/],
  ['sandwich', /sandwich(?:es)?|panini|subs?|hoagies?|sloppy joes?|grilled cheese|reuben|sanduches?|tostadas? de aguacate|wraps?/],
  ['burger', /burgers?|hamburguesas?/],
  ['pizza', /pizzas?|calzone/],
  ['lasagna', /lasagn[ae]s?|lasana|ziti|manicotti|moussaka/],
  ['tacos', /tacos?|tostadas?|nachos?/],
  ['quesadilla', /quesadillas?|enchiladas?|chimichangas?/],
  ['burrito', /burritos?|fajitas?/],
  ['arepa', /arepas?/],
  ['empanadas', /empanadas?|turnovers?|pasties/],
  ['guacamole', /guacamole/],
  ['dip', /dips?|hummus|cheese ?balls?|spreads?|pate|mayonnaise|dressings?|vinaigrette|aderezos?/],
  ['salsa', /^salsas?|(?<!en )salsa$|pico de gallo|relish(?:es)?|chutney|hogao|\bsauce$/],
  ['jam', /jams?|jell(?:y|ies)|preserves|marmalade|mermeladas?|pickles?|apple butter/],
  ['smoothie', /smoothies?|(?:milk)?shakes?|batidos?|malteadas?/],
  ['coffee', /coffee$|cocoa|hot chocolate|chocolate caliente|cappuccino|cafe/],
  ['drink', /punch|lemonade|limonada|cider|drink|slush|margaritas?|cocktail|iced tea|jugos?|eggnog|lulada/],
  ['ice-cream', /ice ?cream|sherbet|sorbet|helados?|popsicles?|parfait helado/],
  ['cookies', /cookies?|snickerdoodles?|biscotti|shortbread|macaroons?|gingersnaps?|galletas?|crinkles/],
  ['candy', /fudge|candy|candies|truffles?|brittle|pralines?|toffee|caramels?|divinity|bonbons?|bark|trufas?|brigadeiros?|bocaditos? dulces|clusters|buckeyes/],
  ['chocolate-cake', /chocolate.*(?:cakes?|torte)|(?:torta|pastel|ponque|bizcocho) de chocolate|devil'?s food|mud cake/],
  ['pancakes', /pancakes?|panqueques?|hot ?cakes?|crepes?|flapjacks?/],
  ['waffles', /waff?les?/],
  ['crumble', /cobblers?|crumbles?|crisps?|brown betty|coffee ?cake|bars?|squares/],
  ['meatloaf', /meat ?loa(?:f|ves)|pastel de carne/],
  ['quiche', /quiches?|pot ?pies?|frittatas?|souffles?|strata/],
  ['cake', /(?<!crab ?)(?<!fish ?)(?<!potato ?)(?<!salmon ?)cakes?|tortes?|tortas?|pasteles|pastel(?! de)|ponques?|bizcochos?|shortcake|trifle|tiramisu/],
  ['pie', /pies?|tarts?|tartas?|strudel/],
  ['pudding', /puddings?|mousse|custards?|flan|dessert|fluff|parfaits?|natilla|arroz con leche|jello|gelatina|postres?|jell-?o/],
  ['oatmeal', /oatmeal|porridge|avena|overnight oats/],
  ['granola', /granola|muesli|yogh?urt bowl|yogur(?:t)?/],
  ['omelette', /omelett?es?|omelets?|tortilla (?:espanola|de)/],
  ['eggs', /eggs?|huevos?|pericos?|shakshuka|migas|calentado/],
  ['rolls', /rolls?|biscuits?|buns?|scones?|panecillos?|pan ?de ?bono|almojabanas?/],
  ['chowder', /chowder|bisque/],
  ['chili', /chil[ie](?! ?(?:powder|sauce))|frijoles?|frijolada|lentejas?|lentils?|baked beans|beans and rice|refried/],
  ['tomato-soup', /(?:tomato|pumpkin|carrot|squash).*soup|(?:sopa|crema) de (?:tomate|zanahoria|ahuyama|calabaza)|gazpacho/],
  ['soup', /soups?|sopas?|^cremas? de|caldos?|ajiaco|broth|sancocho|minestrone|consome|ramen|gumbo/],
  ['curry', /curr(?:y|ies)|masala|tikka/],
  ['stew', /stews?|goulash|guisos?|guisad[oa]s?|estofados?|stroganoff|ragout|bourguignon|pot ?roast|sudado|cazuela/],
  ['wings', /wings?|drumettes|alitas?/],
  ['ribs', /ribs?|costillas?/],
  ['fried-chicken', /(?:fried|oven.?fried|crispy|crunchy|breaded|parmesan) chicken|chicken (?:nuggets|fingers|strips|tenders)|pollo (?:frito|apanado|broaster|crocante|crujiente)|nuggets/],
  ['roast-chicken', /roast(?:ed)? (?:chicken|turkey)|whole chicken|beer can|rotisserie|turkey|pollo (?:asado|al horno)|pavo/],
  ['meatballs', /meat ?balls?|albondigas?/],
  ['stir-fry', /stir.?fr(?:y|ied)|chop suey|chow mein|lo mein|salteados?|wok|teriyaki/],
  ['shrimp', /shrimp|prawns?|scampi|camaron(?:es)?|langostinos?|scallops?|crab|lobster|cangrejo|mariscos|ceviche/],
  ['fish', /fish|salmon|tilapia|halibut|catfish|cod|trout|snapper|pescado|trucha|mojarra|bagre|robalo/],
  ['creamy-pasta', /mac(?:aroni)? (?:and|&|n|'n'?) cheese|alfredo|carbonara|macaroni|macarrones|noodles?|fettuccin[ei]/],
  ['pasta', /spaghetti|pastas?|linguin[ei]|penne|rigatoni|espaguetis?|fideos?|tallarines?|bolognese|bolonesa|gnocchi|noquis/],
  ['tofu', /tofu|tempeh/],
  ['sweet-potato', /sweet potato(?:es)?|yams?|batatas?|camotes?/],
  ['gratin', /gratin|scalloped|au gratin|gratinad[oa]s?|cheesy potatoes|hash ?browns?/],
  ['mashed', /mashed|pures?/],
  ['green-beans', /green beans?|asparagus|habichuelas?|esparragos?/],
  ['broccoli', /broccoli|brocoli/],
  ['casserole', /bakes?$|al horno/],
  ['grains', /quinoa|quinua|couscous|cuscus|tabbouleh|pilaf|bulgur|barley|farro/],
  ['plantain', /platanos?|plantains?|patacon(?:es)?|maduros?/],
  ['salad', /salads?|ensaladas?/],
  ['rice', /(?:fried|spanish|mexican|chinese|yellow) rice|rice|arroz|paella|risotto|jambalaya|bowl/],
  ['pork', /pork|ham|cerdo|jamon|lechona|tenderloin/],
  ['beef', /beef|steaks?|brisket|roast|carne|res|lomo|bistec|churrasco/],
  ['chicken', /chicken|pollo|pechugas?/],
  ['potatoes', /potato(?:es)?|papas?|wedges|fries|criollas?/],
  ['bread', /breads?|pan|loaf|focaccia|bagels?|pretzels?/],
  ['vegetables', /vegetables?|veggies|verduras|vegetales|carrots?|zanahorias?|squash|zucchini|calabacin|cauliflower|coliflor|cabbage|repollo|spinach|espinacas?|mushrooms?|champinones|eggplant|berenjena|ratatouille|corn|mazorcas?|beets?|peppers?|pimentones?/],
];
const COMPILED = DISHES.map(([dish, re]) => [dish, new RegExp(`(?<![a-z])(?:${re.source})(?![a-z])`)] as const);

/** Si el título no dice qué es («Mom's Favorite»), lo dicen los ingredientes. */
const BY_INGREDIENT: [string, RegExp][] = [
  ['shrimp', /shrimp|camaron/], ['fish', /salmon|fish|pescado|tilapia|trucha/], ['chicken', /chicken|pollo|pechuga/], ['meatballs', /ground beef|carne molida/],
  ['pork', /pork|cerdo|\bham\b|sausage|bacon/], ['beef', /beef|\bres\b|steak/], ['cookies', /chocolate|marshmallow/], ['pasta', /pasta|spaghetti|macaroni|noodle|espagueti/], ['rice', /rice|arroz/],
  ['chili', /beans|lentil|frijol|lenteja|garbanzo|chickpea/], ['potatoes', /potato|papa/], ['cake', /sugar|azucar/], ['eggs', /\beggs?\b|huevo/], ['vegetables', /carrot|zucchini|squash|cabbage|corn|zanahoria|tomato/],
];

export type DishFacts = { id: string; title: string; ingredientLabels?: string[]; dietFlags?: string[] };

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Archivo de la foto que mejor representa el plato, o null si no se sabe qué es. Siempre la misma para la misma receta. */
export function dishPhoto(r: DishFacts): string | null {
  const diet = r.dietFlags;
  const fits = (dish: string, name: string) =>
    !diet || ((diet.includes('meat') || (!SHOWS_MEAT.has(dish) && !SHOWS_MEAT.has(name))) && (diet.includes('fish') || diet.includes('shellfish') || (!SHOWS_FISH.has(dish) && !SHOWS_FISH.has(name))));
  const pick = (dish: string) => {
    const names = Array.from({ length: DISH_PHOTOS[dish]! }, (_, i) => `${dish}-${i + 1}`).filter((n) => fits(dish, n));
    return names.length ? `${names[createHash('sha1').update(r.id).digest().readUInt32BE(0) % names.length]}.webp` : null;
  };
  const title = norm(r.title);
  for (const [dish, re] of COMPILED) {
    const file = re.test(title) ? pick(dish) : null;
    if (file) return file;
  }
  const labels = norm((r.ingredientLabels ?? []).join(' | '));
  for (const [dish, re] of BY_INGREDIENT) {
    const file = re.test(labels) ? pick(dish) : null;
    if (file) return file;
  }
  return null;
}

export const isDishPhoto = (url: string | null): boolean => !!url && url.includes('/api/v1/dishes/');
export const isDishFile = (file: string): boolean => {
  const m = /^([a-z-]+)-(\d)\.webp$/.exec(file);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= (Object.hasOwn(DISH_PHOTOS, m[1]!) ? DISH_PHOTOS[m[1]!]! : 0);
};
