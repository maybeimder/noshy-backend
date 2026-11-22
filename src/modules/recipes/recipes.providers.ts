/**
 * Estima calorías y macros de una comida escrita en texto libre («Bandeja paisa», «2 empanadas»).
 * La implementación incluida usa una tabla de platos comunes en Colombia y el catálogo de ingredientes;
 * un modelo de lenguaje puede reemplazarla con la misma interfaz.
 */
export type Estimate = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: number;
  matches: { label: string; servings: number; source: 'dish' | 'recipe' | 'ingredient' | 'default' }[];
};

export type EstimateContext = {
  recipes: { title: string; perServing: { kcal: number; proteinG: number; carbsG: number; fatG: number } }[];
  ingredients: { label: string; per100g: { kcal: number; proteinG: number; carbsG: number; fatG: number } | null; typicalGrams: number }[];
};

export interface NutritionEstimator {
  estimate(text: string, ctx: EstimateContext): Promise<Estimate>;
}

type M = [kcal: number, p: number, c: number, f: number];
const DISHES: Record<string, M> = {
  'bandeja paisa': [1100, 52, 98, 56],
  'almuerzo corriente': [750, 32, 95, 24],
  'corrientazo': [750, 32, 95, 24],
  ajiaco: [600, 38, 62, 20],
  sancocho: [520, 34, 58, 14],
  empanada: [280, 7, 30, 15],
  arepa: [220, 5, 36, 6],
  'arepa con queso': [330, 12, 37, 15],
  'arepa de huevo': [380, 12, 34, 22],
  tamal: [520, 22, 48, 26],
  changua: [250, 15, 12, 15],
  calentado: [650, 25, 80, 24],
  patacon: [230, 1, 32, 11],
  hamburguesa: [700, 34, 48, 40],
  pizza: [285, 12, 36, 10],
  perro: [450, 15, 40, 25],
  salchipapa: [750, 18, 70, 44],
  ensalada: [200, 5, 15, 13],
  'jugo de naranja': [120, 2, 28, 0],
  jugo: [120, 1, 28, 0],
  cafe: [5, 0, 1, 0],
  'cafe con leche': [90, 5, 8, 4],
  'pan': [150, 5, 28, 2],
  manzana: [80, 0, 21, 0],
  banano: [105, 1, 27, 0],
  yogur: [120, 8, 14, 3],
  galletas: [140, 2, 20, 6],
  sushi: [400, 16, 60, 8],
  burrito: [650, 28, 72, 26],
};
const NUMBERS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, media: 0.5, medio: 0.5 };
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
const singular = (w: string) => w.replace(/(es|s)$/, '');

export class RuleBasedNutritionEstimator implements NutritionEstimator {
  async estimate(text: string, ctx: EstimateContext): Promise<Estimate> {
    const parts = norm(text).split(/\s*(?:,|\s\+\s|\sy\s)\s*/).filter(Boolean);
    const total: M = [0, 0, 0, 0];
    const matches: Estimate['matches'] = [];
    let confidence = 0;
    for (const raw of parts) {
      const m = raw.match(/^(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|media|medio)\s+(.*)$/);
      const servings = m ? (NUMBERS[m[1]!] ?? Number(m[1]!.replace(',', '.'))) : 1;
      const what = (m ? m[2]! : raw).trim();
      const key =
        Object.keys(DISHES).sort((a, b) => b.length - a.length).find((d) => what.includes(d) || what.split(' ').map(singular).join(' ').includes(d)) ?? null;
      if (key) {
        DISHES[key]!.forEach((v, i) => (total[i] = (total[i] ?? 0) + v * servings));
        matches.push({ label: key, servings, source: 'dish' });
        confidence += 0.8;
        continue;
      }
      const recipe = ctx.recipes.find((r) => norm(r.title) === what || what.includes(norm(r.title)));
      if (recipe) {
        const p = recipe.perServing;
        total[0] += p.kcal * servings;
        total[1] += p.proteinG * servings;
        total[2] += p.carbsG * servings;
        total[3] += p.fatG * servings;
        matches.push({ label: recipe.title, servings, source: 'recipe' });
        confidence += 0.65;
        continue;
      }
      const ing = ctx.ingredients.find((i) => i.per100g && what.split(' ').some((w) => w.length > 3 && norm(i.label).includes(singular(w))));
      if (ing?.per100g) {
        const f = (ing.typicalGrams / 100) * servings;
        total[0] += ing.per100g.kcal * f;
        total[1] += ing.per100g.proteinG * f;
        total[2] += ing.per100g.carbsG * f;
        total[3] += ing.per100g.fatG * f;
        matches.push({ label: ing.label, servings, source: 'ingredient' });
        confidence += 0.45;
        continue;
      }
      [400, 15, 45, 16].forEach((v, i) => (total[i] = (total[i] ?? 0) + v * servings));
      matches.push({ label: what, servings, source: 'default' });
      confidence += 0.2;
    }
    const round = (n: number) => Math.round(n);
    return {
      kcal: Math.round(total[0] / 10) * 10,
      proteinG: round(total[1]),
      carbsG: round(total[2]),
      fatG: round(total[3]),
      confidence: parts.length ? Math.round((confidence / parts.length) * 100) / 100 : 0,
      matches,
    };
  }
}
