import type { IngredientRow } from '../catalog/catalog.repository.js';
import { CATEGORY_LABELS } from '../../core/domain/catalog.js';
import type { Unit } from '../../core/domain/quantity.js';

/**
 * Alimentos en inglés con valores conocidos, para estimar macros de `recipes_raw` sin modelo. Valores por 100 g (USDA, redondeados).
 * nombre ; patrón ; kcal,prot,carb,grasa ; g por taza ; g por unidad ; categoría ; banderas
 * Banderas: D lácteo · E huevo · G gluten · N frutos secos · M carne · F pescado · S mariscos · A otro origen animal · ~ se usa en cantidades que no pesan.
 */
const TABLE = `
Salt and pepper;salt (?:and|&) pepper|salt, pepper;0,0,0,0;290;;spices;~
Salt;(?:kosher |sea |garlic |onion |celery |seasoned |seasoning )?salt;0,0,0,0;290;;spices;~
Pepper;(?:ground |black |white |cayenne |lemon )*pepper(?! ?jack)(?:corns?)?|(?:crushed )?red pepper flakes|crushed red pepper|cayenne;251,10,64,3;110;;spices;~
Garlic powder;(?:garlic|onion) (?:powder|flakes)|dried onions?|minced onion flakes;335,17,75,1;150;;spices;~
Spices;cinnamon(?: sticks?)?|nutmeg|ginger(?! ?(?:ale|snap))|allspice|(?:ground |whole )?cloves(?! (?:of )?garlic)|cumin|paprika|chili powder|curry(?: powder)?|turmeric|oregano|thyme|rosemary|sage|marjoram|tarragon|dill(?: weed)?|bay lea(?:f|ves)|(?:italian |poultry |taco |cajun |pumpkin pie |apple pie )(?:seasoning|spice)|coriander|mace|cardamom|celery seeds?|caraway seeds?|poppy seeds?|accent|dry mustard|mustard powder|cream of tartar|red food coloring|food coloring|hot sauce|tabasco(?: sauce)?|liquid smoke;250,8,55,5;100;2;spices;~
Fresh herbs;parsley(?: flakes)?|cilantro|basil(?: lea(?:f|ves))?|chives|mint(?: lea(?:f|ves))?;30,3,5,1;30;10;produce;~
Baking powder;baking powder|baking soda|soda(?! ?(?:crackers|water|pop))|(?:dry |active dry |instant )?yeast;60,2,20,0;200;7;staples;~
Vanilla;(?:vanilla|lemon|maple|butter) (?:extract|flavoring)|vanilla(?! (?:ice|pudding|wafer|yog|instant|chips|cake|milk))|almond extract;250,0,12,0;208;;staples;~
Water;(?:boiling |cold |hot |warm |ice |lukewarm )?water(?! ?(?:chestnut|melon))|ice cubes|ice(?! cream);0,0,0,0;237;;drinks;~
Vinegar;(?:cider |white |red wine |wine |balsamic |apple cider )?vinegar;20,0,1,0;239;;staples;
Lemon juice;(?:lemon|lime) juice|juice of (?:1 |one |2 )?(?:lemons?|limes?);22,0,7,0;244;45;produce;
Lemon;lemon(?: (?:rind|zest|peel))?s?|limes?|lime (?:zest|rind);29,1,9,0;;60;produce;
Flour;(?:all[- ]purpose |plain |self[- ]rising |sifted |white |cake |bread |whole wheat |unbleached |wheat )*flour(?! tortillas?);364,10,76,1;125;;staples;G
Corn meal;corn ?meal;370,8,79,2;140;;staples;
Cornstarch;corn ?starch;381,0,91,0;128;;staples;
Corn syrup;(?:light |dark |white )?(?:corn syrup|karo(?: syrup)?);286,0,78,0;328;;staples;
Brown sugar;(?:light |dark |firmly |packed )*brown sugar;380,0,98,0;210;;staples;
Powdered sugar;(?:powdered|confectioners?'?s?'?|confectioner's|icing) sugar;389,0,100,0;120;;staples;
Sugar;(?:white |granulated )?sugar(?! (?:cookie|free|snap));387,0,100,0;200;;staples;
Honey;honey(?! ?dew);304,0,82,0;339;;staples;A
Maple syrup;maple syrup|pancake syrup|(?<!corn )(?<!chocolate )syrup|molasses;270,0,70,0;322;;staples;
Butter;(?:melted |soft |softened |unsalted |sweet )*butter(?! ?(?:milk|beans?|scotch|nut|cracker|flavor|lettuce|cookie|finger))|oleo(?: ?margarine)?|margarine;717,1,0,81;227;113;dairy;D
Shortening;(?:vegetable )?shortening|crisco|lard;884,0,0,100;205;;staples;A
Oil;(?:vegetable |olive |salad |cooking |canola |corn |wesson |peanut |sesame |extra virgin )*oil;884,0,0,100;218;;staples;
Eggs;eggs?(?: (?:yolks?|whites?))?(?! ?(?:noodles?|plant|nog|beaters|roll))|egg beaters;143,13,1,10;243;50;protein;E
Buttermilk;butter ?milk;40,3,5,1;245;;dairy;D
Sweetened condensed milk;(?:sweetened )?condensed milk|eagle brand milk;321,8,54,9;306;397;dairy;D
Evaporated milk;evaporated milk|carnation milk|pet milk;134,7,10,8;252;354;dairy;D
Milk;(?:whole |skim |low[- ]?fat |sweet |scalded |2% |warm |cold )*milk(?! ?chocolate)(?<!coconut milk);61,3,5,3;244;;dairy;D
Coconut milk;coconut milk;230,2,6,24;226;400;staples;
Cream cheese;(?:philadelphia )?cream cheese;342,6,4,34;232;227;dairy;D
Sour cream;sour cream;198,2,5,19;230;227;dairy;D
Heavy cream;(?:heavy |whipping |light |whipped |half |half and half|half[- ]and[- ]half )*cream(?! ?(?:of|cheese|style|corn|puff|soda))(?<!ice cream)(?<!sour cream)|half[- ]and[- ]half;300,3,4,31;238;;dairy;D
Whipped topping;cool whip|whipped topping|dream whip;318,1,23,25;75;227;dairy;D
Ice cream;ice cream|sherbet;207,4,24,11;140;;dairy;DE
Yogurt;(?:plain |vanilla |greek )?yog(?:h)?urt;61,4,7,2;245;170;dairy;D
Parmesan cheese;(?:grated )?(?:parmesan|romano)(?: cheese)?;430,38,4,29;100;;dairy;D
Cottage cheese;(?:cottage|ricotta) cheese|ricotta;98,11,3,4;226;;dairy;D
Mozzarella cheese;mozzarella(?: cheese)?;300,22,2,22;112;;dairy;D
Cheese;(?:shredded |grated |sharp |mild |cheddar |american |swiss |monterey |jack |pepper ?jack |colby |feta |blue |longhorn |processed |velveeta |provolone )+cheese|velveeta|cheddar|feta|cheese(?! ?(?:cake|soup|cloth))(?<!cream cheese);400,24,3,33;113;28;dairy;D
Chicken;(?:boneless |skinless |whole |fryer |cooked |cubed |diced |chopped |frying |canned )*chicken(?:s)?(?: (?:breasts?|thighs?|pieces|legs?|wings?|parts|tenders|halves|breast halves))*(?! ?(?:broth|bouillon|stock|soup|gravy|flavor|noodle|bouil));165,27,0,6;140;170;protein;M
Whole chicken;(?:large |small )?whole (?:chicken|fryer)|fryers?|frying chicken;190,24,0,10;140;900;protein;M
Turkey;(?:ground |cooked |smoked )*turkey(?: breast)?(?! ?(?:broth|gravy|bacon));160,27,0,6;140;;protein;M
Ground beef;(?:lean |extra lean )*(?:ground (?:beef|chuck|round|meat)|hamburger(?: meat)?)(?! ?(?:buns?|rolls?|helper));254,17,0,20;225;;protein;M
Beef;(?:round |chuck |sirloin |flank |stew |cubed |rump |pot |lean )*(?:steaks?|beef|stew meat|roast)(?! ?(?:broth|bouillon|stock|gravy|consomme));217,26,0,12;140;225;protein;M
Pork;(?:boneless |lean |ground )*pork(?: (?:chops?|loin|tenderloin|roast|shoulder|steaks?|ribs?))?(?! (?:and|&|'n) beans)|spare ?ribs;242,27,0,14;140;170;protein;M
Bacon;bacon(?! ?bits)(?: (?:slices|strips))?;417,13,1,40;;20;protein;M
Ham;(?:cooked |diced |chopped |smoked )*ham(?! ?burger);145,21,2,6;140;;protein;M
Sausage;(?:italian |smoked |pork |bulk |link |polish |hot )*(?:sausages?|kielbasa|pepperoni|salami)|hot dogs?|wieners?|frankfurters?;325,14,2,29;140;50;protein;M
Tuna;tuna(?: fish)?;116,26,0,1;146;142;seafood;F
Salmon;(?:pink |red )?salmon(?: fillets?)?;180,22,0,10;150;170;seafood;F
Fish fillets;(?:cod|haddock|halibut|flounder|sole|tilapia|catfish|perch|fish|snapper|orange roughy)(?: fillets?)?;95,20,0,1;140;170;seafood;F
Shrimp;shrimps?|prawns;99,24,0,0;145;;seafood;S
Crab;crab ?meat|crab;90,19,0,1;120;170;seafood;S
Clams;(?:minced )?clams|oysters|scallops;85,14,4,1;150;185;seafood;S
Onion;(?:green |spring |white |red |yellow |sweet |small |large |medium |chopped )*(?:onions?|scallions?|shallots?|leeks?)(?! ?(?:soup|powder|salt|flakes|rings?));40,1,9,0;160;110;produce;
Garlic;(?:cloves? (?:of )?)?garlic(?: cloves?)?(?! ?(?:salt|powder|bread));149,6,33,0;136;4;produce;
Tomato sauce;(?:tomato|spaghetti|pizza|marinara|pasta) (?:sauce|puree)|stewed tomatoes|rotel(?: tomatoes)?|salsa|picante sauce|taco sauce|enchilada sauce;32,1,7,0;245;425;staples;
Tomato paste;tomato paste;82,4,19,0;262;170;staples;
Tomato juice;tomato juice|v-?8(?: juice)?;17,1,4,0;243;;drinks;
Tomatoes;(?:canned |whole |cherry |fresh |diced |crushed |ripe )*tomato(?:es)?(?! ?(?:soup|sauce|paste|juice|puree));18,1,4,0;180;123;produce;
Ketchup;ketchup|catsup|chili sauce;101,1,27,0;240;;staples;
Mustard;(?:dijon |prepared |yellow |dry )?mustard(?! ?(?:powder|greens|seed));60,4,6,3;249;;staples;
Mayonnaise;mayonnaise|mayo|miracle whip;680,1,1,75;220;;staples;E
Soy sauce;soy sauce|teriyaki sauce;53,8,5,1;255;;staples;G
Worcestershire sauce;worcestershire(?: sauce)?|worchestershire(?: sauce)?|worcester sauce;78,0,19,0;275;;staples;F
Barbecue sauce;(?:barbecue|bbq|barbeque) sauce;172,1,41,1;280;;staples;
Broth;(?:chicken |beef |vegetable |turkey )(?:broth|stock|consomme);10,1,1,0;240;410;staples;M
Bouillon;(?:chicken |beef )?bouillon(?: cubes?| granules)?;200,15,20,5;;4;staples;M~
Potatoes;(?:white |red |baking |irish |idaho |russet |new )*potato(?:es)?(?! ?(?:chips|soup|flakes|buds|salad|starch))(?<!sweet potato)(?<!sweet potatoes);77,2,17,0;150;170;produce;
Sweet potatoes;sweet potato(?:es)?|yams?;86,2,20,0;150;130;produce;
Hash browns;(?:frozen )?(?:hash ?browns?|hash brown potatoes|tater tots);120,2,20,4;110;;staples;
Carrots;carrots?;41,1,10,0;128;61;produce;
Celery;celery(?: (?:stalks?|ribs?))?(?! ?(?:salt|seeds?|soup));14,1,3,0;101;40;produce;
Bell pepper;(?:green |red |bell |sweet |yellow )+peppers?(?! ?(?:flakes|corn))|jalapenos?(?: peppers?)?|green chil(?:i|e)(?:e)?s|chil(?:i|e) peppers?|pimientos?|pimentos?;26,1,6,0;149;119;produce;
Mushrooms;mushrooms?(?! ?soup);22,3,3,0;90;18;produce;
Broccoli;broccoli(?: (?:florets|flowerets|spears))?;34,3,7,0;91;300;produce;
Cauliflower;cauliflower;25,2,5,0;107;580;produce;
Cabbage;cabbage|sauerkraut|cole ?slaw mix;25,1,6,0;89;900;produce;
Lettuce;(?:romaine |iceberg )?lettuce|salad greens;15,1,3,0;47;500;produce;
Spinach;(?:frozen |fresh |chopped )*spinach;23,3,4,0;100;283;produce;
Cucumber;cucumbers?;15,1,4,0;104;300;produce;
Zucchini;zucchinis?|(?:yellow |summer )squash|eggplants?;17,1,3,0;124;196;produce;
Squash;(?:butternut |acorn |winter )?squash;40,1,10,0;140;550;produce;
Pumpkin;(?:canned )?pumpkin(?! ?(?:pie|seeds));34,1,8,0;245;425;produce;
Green beans;(?:french |french[- ]style |cut |string )*(?:green|string|snap) beans;31,2,7,0;125;411;produce;
Peas;(?:green |english |frozen |black[- ]?eyed |snow )*peas;81,5,14,0;145;425;produce;
Corn;(?:whole kernel |cream[- ]style |creamed |sweet |kernel |shoe ?peg |frozen )*corn(?! ?(?:meal|starch|syrup|flakes|bread|chips|tortillas?|muffin|oil|ed))(?: kernels?)?;86,3,19,1;165;432;produce;
Asparagus;asparagus;20,2,4,0;134;;produce;
Beans;(?:kidney |pinto |black |navy |lima |white |great northern |red |refried |butter |chili |garbanzo |cannellini |dried |dry )+beans?|beans|chick ?peas|garbanzos|lentils;120,8,21,1;177;439;staples;
Pork and beans;(?:pork (?:and|&|'n) |baked )beans;95,5,21,1;253;439;staples;M
Cooked rice;cooked (?:white |brown |wild |long[- ]grain )*rice|(?:white |brown )?rice, cooked;130,3,28,0;158;;staples;
Cooked pasta;cooked (?:elbow )?(?:macaroni|spaghetti|pasta)|(?:macaroni|spaghetti|pasta), cooked;158,6,31,1;140;;staples;G
Rice;(?:minute |long[- ]grain |white |brown |wild |uncooked |instant |converted )*rice(?! ?(?:krispies|vinegar|chex|a-roni|cereal));360,7,79,1;185;;staples;
Egg noodles;(?:egg |wide |cooked )*noodles;384,14,71,4;70;227;staples;GE
Pasta;(?:elbow |angel hair |bow tie |uncooked |shell |spiral )*(?:macaroni|spaghetti|pasta|fettuccine|fettuccini|linguine|lasagna noodles|lasagne noodles|rotini|penne|vermicelli|ziti)(?: noodles| shells)?(?! ?sauce);371,13,75,2;100;454;staples;G
Bread crumbs;(?:dry |soft |seasoned |italian |fine )*bread ?crumbs|stuffing(?: mix)?|croutons;395,13,72,5;108;170;bakery;G
Bread;(?:white |french |italian |rye |sourdough |day[- ]old |whole wheat )*bread(?! ?(?:flour|crumbs?|and butter))(?: slices| cubes)?|(?:hamburger |hot dog )?buns?|(?:crescent |dinner )?rolls|biscuits|english muffins?|pita;266,9,49,3;45;30;bakery;G
Tortillas;(?:flour )?tortillas?;300,8,50,7;;45;bakery;G
Corn tortillas;corn tortillas?|taco shells|tortilla chips|corn chips|fritos|doritos;400,6,60,16;60;25;bakery;
Crackers;(?:ritz |saltine |soda |graham |club |oyster )*crackers?(?: crumbs)?;470,8,68,18;90;4;bakery;G
Graham cracker crust;(?:graham cracker |unbaked |baked |prepared |frozen |deep dish )*(?:pie ?(?:crusts?|shells?)|pastry shells?|graham cracker crusts?|graham crust);480,5,55,27;;200;bakery;GD
Wafers;vanilla wafers|nilla wafers|(?:oreo|chocolate|sugar) cookies?|cookie crumbs|ginger ?snaps;470,5,70,19;100;6;bakery;GDE
Oats;(?:quick |rolled |old[- ]fashioned |quick[- ]cooking |instant |regular )*(?:oats|oatmeal);379,13,68,7;85;;staples;G
Cereal;corn ?flakes|rice krispies(?: cereal)?|(?:rice |corn |wheat )?chex(?: cereal)?|bran flakes|wheat germ;370,8,82,2;30;;staples;G
Potato chips;potato chips;536,7,53,35;30;;staples;
Nuts;(?:chopped |toasted |sliced |slivered |black |english |salted |ground )*(?:pecans?|walnuts?|almonds?|nuts?|peanuts?|cashews?|pine nuts|hazelnuts?|macadamia nuts)(?! ?(?:butter|extract|meg));600,16,20,54;115;;staples;N
Peanut butter;(?:creamy |crunchy |chunky |smooth )*peanut butter(?! ?(?:chips|cups));588,25,20,50;258;;staples;N
Coconut;(?:flaked |shredded |angel flake |grated )*coconut(?! ?(?:milk|oil|extract));460,4,45,32;90;;staples;
Chocolate chips;(?:semi[- ]?sweet |milk )*chocolate (?:chips?|morsels|bits|pieces)|(?:unsweetened |semi[- ]?sweet |german sweet |german |sweet |baking |milk |white |dark )*chocolate(?! ?(?:syrup|pudding|cake|cookie|milk|ice|wafer|sandwich|instant))(?: squares?| bars?)?;500,5,60,29;170;28;staples;D
Cocoa;(?:unsweetened |hershey'?s? )*cocoa(?: powder)?;228,20,58,14;86;;staples;
Marshmallows;(?:miniature |mini |large )*marshmallows?|marshmallow (?:creme|cream|fluff);318,2,81,0;50;7;staples;M
Gelatin;(?:unflavored |plain )?gelatin(?:e)?|(?:strawberry |lemon |lime |orange |cherry |raspberry )*jell-?o(?! ?(?:pudding|instant));370,8,90,0;180;85;staples;M
Apples;(?:tart |cooking |granny smith |red |green )*apples?(?! ?(?:sauce|juice|cider|pie));52,0,14,0;110;180;produce;
Applesauce;apple ?sauce;68,0,18,0;244;;staples;
Bananas;(?:ripe |mashed )*bananas?(?! ?(?:bread|pudding));89,1,23,0;225;118;produce;
Pineapple;(?:crushed |chunk |sliced )*pineapple(?: (?:chunks|tidbits|rings|slices))?(?! ?juice);60,0,16,0;246;565;produce;
Juice;(?:orange|apple|pineapple|cranberry|grape|lemonade|grapefruit)(?: juice)(?: concentrate)?|apple cider;47,0,11,0;248;;drinks;
Oranges;(?:mandarin |navel )?oranges?(?: (?:rind|zest|peel|sections))?(?! ?(?:juice|jell|sherbet));47,1,12,0;180;131;produce;
Berries;(?:fresh |frozen |whole )*(?:strawberries|blueberries|raspberries|blackberries|cranberries|berries|cherries)(?! ?(?:pie|jell));50,1,12,0;145;;produce;
Peaches;peach(?:es)?|pears?|apricots?|fruit cocktail|grapes|mangos?|mangoes|plums?|watermelon|cantaloupe|kiwis?;50,1,13,0;160;150;produce;
Raisins;(?:golden |seedless )?raisins|currants|dates|craisins|dried cranberries|prunes;300,3,79,0;150;;staples;
Jam;(?:strawberry |grape |apricot |raspberry |orange )*(?:jam|jelly|preserves|marmalade);260,0,66,0;320;;staples;
Olives;(?:black |green |ripe |stuffed |pitted )*olives?(?! ?oil);120,1,6,11;135;4;staples;
Pickles;(?:dill |sweet )*(?:pickles?|relish|pickle relish)|capers;60,0,15,0;245;65;staples;
Avocado;avocados?|guacamole;160,2,9,15;150;150;produce;
Water chestnuts;water chestnuts|bamboo shoots|bean sprouts;60,1,14,0;124;227;produce;
Italian dressing;italian (?:salad )?dressing;240,0,12,21;235;;staples;
Wine;(?:dry |white |red |cooking )*(?:wine|sherry|rum|bourbon|brandy|whiskey);85,0,4,0;237;;drinks;
Beer;beer(?! ?batter);43,0,4,0;237;355;drinks;G
Coffee;(?:strong |black |instant |brewed )*coffee(?! ?(?:cake|creamer))|tea(?! ?spoon);2,0,0,0;237;;drinks;~
Tofu;tofu;144,16,3,9;250;400;protein;
`;

export type RawFood = { key: string; label: string; re: RegExp; per100: [number, number, number, number]; cup: number | null; unit: number | null; category: string; allergens: string[]; diet: string[]; trace: boolean };

const ALLERGEN: Record<string, string> = { D: 'lactose', E: 'egg', G: 'gluten', N: 'nuts', S: 'shellfish' };
const DIET: Record<string, string> = { D: 'dairy', E: 'egg', M: 'meat', F: 'fish', S: 'shellfish' };

export const RAW_FOODS: RawFood[] = TABLE.trim()
  .split('\n')
  .map((line) => {
    const [label, pattern, macros, cup, unit, category, flags = ''] = line.split(';') as [string, string, string, string, string, string, string?];
    const f = [...flags];
    const diet = f.flatMap((x) => DIET[x] ?? []);
    return {
      key: label.toLowerCase().replace(/[^a-z]+/g, '-'),
      label,
      re: new RegExp(`(?<![a-z])(?:${pattern})(?![a-z])`, 'g'),
      per100: macros.split(',').map(Number) as RawFood['per100'],
      cup: cup ? Number(cup) : null,
      unit: unit ? Number(unit) : null,
      category,
      allergens: f.flatMap((x) => ALLERGEN[x] ?? []),
      diet: diet.length || f.includes('A') ? [...diet, 'animal'] : [],
      trace: f.includes('~'),
    };
  });

/** Una fila por nombre («Grapes», «Green pepper»), aunque compartan los datos del grupo. */
export const rawIngredientId = (key: string, label: string) => `raw_${key}_${label.toLowerCase().replace(/[^a-z]+/g, '-')}`.slice(0, 64);

const ICONS: Record<string, string> = { produce: 'leaf', protein: 'meat', seafood: 'fish', dairy: 'cheese', staples: 'jar', spices: 'salt', bakery: 'bread', drinks: 'glass' };
const SHELF: Record<string, [IngredientRow['defaultStorage'], number]> = { produce: ['fridge', 7], protein: ['fridge', 3], seafood: ['fridge', 2], dairy: ['fridge', 10], staples: ['pantry', 270], spices: ['pantry', 720], bakery: ['pantry', 7], drinks: ['pantry', 120] };

export const gramsPerUnitOf = (f: RawFood): Partial<Record<Unit, number>> => ({
  ...(f.cup ? { cup: f.cup, tbsp: Math.round((f.cup / 16) * 10) / 10, tsp: Math.round((f.cup / 48) * 10) / 10 } : {}),
  ...(f.unit ? { unit: f.unit } : {}),
});

export function rawIngredientRow(f: RawFood, label: string): IngredientRow {
  const [kcal, proteinG, carbsG, fatG] = f.per100;
  const [defaultStorage, shelfLifeDays] = SHELF[f.category]!;
  const gpu = gramsPerUnitOf(f);
  return {
    id: rawIngredientId(f.key, label),
    label,
    icon: f.diet.includes('egg') && f.category === 'protein' ? 'egg' : ICONS[f.category]!,
    categoryId: f.category,
    categoryLabel: CATEGORY_LABELS[f.category]!,
    defaultStorage,
    shelfLifeDays,
    allergens: f.allergens,
    dietFlags: f.diet,
    flavorTags: [],
    nutritionPer100g: { kcal, proteinG, carbsG, fatG, fiberG: 0 },
    gramsPerUnit: gpu,
    unitLabel: null,
    defaultUnit: 'g',
    allowedUnits: ['g', 'kg', ...(Object.keys(gpu) as Unit[]), 'pinch', 'toTaste'],
    typicalPack: { value: 500, unit: 'g', label: '500 g' },
    isBasic: f.trace,
    searchText: label.toLowerCase(),
  };
}
