import { describe, expect, it } from 'vitest';
import { computeTargets, macrosForKcal, recipeNutrition, isValidKcalTarget } from '../../src/core/domain/nutrition.js';
import { evaluateRecipe, conflictsOf } from '../../src/core/domain/restrictions.js';
import { formatQuantity, quantity, toGrams, heatLabel } from '../../src/core/domain/quantity.js';
import { streakWeeks } from '../../src/core/domain/streak.js';
import { currentSlot, slotsFor } from '../../src/core/domain/meal-slots.js';
import { score } from '../../src/core/domain/recommendations.js';
import { decodeCursor, encodeCursor } from '../../src/core/shared/cursor.js';
import { weekStart, localDate } from '../../src/core/shared/time.js';

describe('nutrición', () => {
  it('calcula el punto de partida poblacional en pasos de 50 y dentro del rango', () => {
    const t = computeTargets({ goalIds: ['eatHealthier', 'saveTime'], activityLevel: 'active' });
    expect(t.kcal % 50).toBe(0);
    expect(t.kcal).toBe(2200);
    expect(t.basis).toBe('populationDefault');
    expect(t.macroSplit.proteinPct + t.macroSplit.carbsPct + t.macroSplit.fatPct).toBeLessThanOrEqual(100);
  });

  it('usa biometría cuando llega y ajusta por objetivo', () => {
    const base = computeTargets({ goalIds: ['maintain'], activityLevel: 'active', biometrics: { weightKg: 62, heightCm: 165, birthYear: 1995, sex: 'female' } });
    const lose = computeTargets({ goalIds: ['loseWeight'], activityLevel: 'active', biometrics: { weightKg: 62, heightCm: 165, birthYear: 1995, sex: 'female' } });
    expect(base.basis).toBe('biometrics');
    expect(lose.kcal).toBeLessThan(base.kcal);
  });

  it('reescala macros igual que el front', () => {
    expect(macrosForKcal(2000, { proteinPct: 25, carbsPct: 45, fatPct: 30 })).toEqual({ proteinG: 125, carbsG: 225, fatG: 67, fiberG: 28 });
  });

  it('valida el kcalTarget del stepper', () => {
    expect(isValidKcalTarget(2250)).toBe(true);
    expect(isValidKcalTarget(2225)).toBe(false);
    expect(isValidKcalTarget(900)).toBe(false);
  });

  it('suma nutrición por porción y marca parcial lo que no puede convertir', () => {
    const n = recipeNutrition(
      [
        { value: 200, unit: 'g', nutrition: { per100g: { kcal: 100, proteinG: 10, carbsG: 5, fatG: 2, fiberG: 0 }, gramsPerUnit: {} } },
        { value: 1, unit: 'unit', nutrition: { per100g: { kcal: 50, proteinG: 1, carbsG: 1, fatG: 1, fiberG: 0 }, gramsPerUnit: {} } },
      ],
      2,
    );
    expect(n.perServing.kcal).toBe(100);
    expect(n.status).toBe('partial');
  });
});

describe('restricciones y adaptación', () => {
  const cream = { id: 'ing_cream', label: 'Crema de leche', allergens: ['lactose'], dietFlags: ['dairy', 'animal'] };
  const oat = { id: 'ing_oatdrink', label: 'Bebida de avena', allergens: [], dietFlags: [] };
  const shrimp = { id: 'ing_shrimp', label: 'Camarón', allergens: ['shellfish'], dietFlags: ['shellfish', 'animal'] };
  const pasta = { id: 'ing_rigatoni', label: 'Rigatoni', allergens: ['gluten'], dietFlags: [] };
  const chickpea = { id: 'ing_chickpeapasta', label: 'Pasta de garbanzo', allergens: [], dietFlags: [] };
  const subs = [
    { ingredientId: 'ing_cream', substitute: oat, reason: 'lactose', priority: 1 },
    { ingredientId: 'ing_rigatoni', substitute: chickpea, reason: 'moreProtein', priority: 1 },
  ];

  it('detecta alergias, dieta y exclusiones propias', () => {
    const r = { dietStyle: 'vegetarian' as const, allergyIds: ['shellfish' as const], excludedIngredientIds: ['ing_rigatoni'] };
    expect(conflictsOf(shrimp, r).map((c) => c.id)).toEqual(['shellfish', 'vegetarian']);
    expect(conflictsOf(pasta, r).map((c) => c.id)).toEqual(['custom']);
  });

  it('sustituye crema por bebida de avena sin lactosa y agrega proteína por objetivo', () => {
    const e = evaluateRecipe([cream, pasta], { dietStyle: 'omnivore', allergyIds: ['lactose'], excludedIngredientIds: [] }, subs, ['eatHealthier']);
    expect(e.compatibility).toEqual({ ok: true, conflicts: [], adaptable: true });
    expect(e.substitutions.map((s) => s.to.label)).toEqual(['Bebida de avena', 'Pasta de garbanzo']);
    expect(e.reasons.map((r) => r.label)).toEqual(['Sin lactosa', 'más proteína']);
  });

  it('marca no compatible cuando no hay sustituto', () => {
    const e = evaluateRecipe([shrimp], { dietStyle: 'omnivore', allergyIds: ['shellfish'], excludedIngredientIds: [] }, subs);
    expect(e.compatibility.ok).toBe(false);
    expect(e.compatibility.conflicts[0]?.label).toBe('Mariscos');
  });
});

describe('cantidades', () => {
  it('arma display en español con plurales y unidades propias', () => {
    expect(formatQuantity(2, 'clove')).toBe('2 dientes');
    expect(formatQuantity(1, 'pinch')).toBe('1 pizca');
    expect(formatQuantity(null, 'toTaste')).toBe('al gusto');
    expect(formatQuantity(null, 'all')).toBe('todo');
    expect(quantity(1, 'unit', ['atado', 'atados']).display).toBe('1 atado');
    expect(formatQuantity(1.5, 'tbsp')).toBe('1,5 cda');
  });

  it('convierte a gramos con equivalencias del ingrediente', () => {
    expect(toGrams(2, 'clove', { clove: 5 })).toBe(10);
    expect(toGrams(2, 'tbsp')).toBe(30);
    expect(toGrams(null, 'toTaste')).toBeNull();
  });

  it('nombra la escala de calor', () => {
    expect([0, 2, 5, 8].map(heatLabel)).toEqual(['Apagado', 'Bajo', 'Medio', 'Alto']);
  });
});

describe('racha, franjas, recomendaciones y cursores', () => {
  it('cuenta semanas seguidas con 3+ recetas', () => {
    const dates = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-19'];
    expect(streakWeeks(dates, '2026-10-20')).toBe(2);
    expect(streakWeeks([...dates, '2026-10-20', '2026-10-21'], '2026-10-21')).toBe(3);
  });

  it('arma franjas según comidas al día y encuentra la actual', () => {
    const slots = slotsFor(3);
    expect(slots.map((s) => s.label)).toEqual(['Desayuno', 'Snack 1', 'Almuerzo', 'Cena']);
    expect(currentSlot(slots, '12:30')).toBe('lunch');
    expect(currentSlot(slots, '16:00')).toBe('dinner');
  });

  it('descarta incompatibles y premia la despensa', () => {
    const base = { recipeId: 'r', mealSlots: ['lunch' as const], timeMax: 20, cuisineId: null, flavorTags: [], dishId: null, usesIngredientIds: [], timesCookedLast14d: 0, compatible: true };
    const taste = { maxCookingMinutes: 30, favoriteDishIds: [], lovedFlavors: [], likedCuisineIds: [], dislikedRecipeIds: [] };
    const full = score({ ...base, pantry: { have: 4, total: 4 } }, taste, { slot: 'lunch', source: 'pantry', usingIngredientIds: [] })!;
    const none = score({ ...base, pantry: { have: 0, total: 4 } }, taste, { slot: 'lunch', source: 'pantry', usingIngredientIds: [] })!;
    expect(full).toBeGreaterThan(none);
    expect(score({ ...base, compatible: false, pantry: { have: 4, total: 4 } }, taste, { source: 'forYou', usingIngredientIds: [] })).toBeNull();
  });

  it('codifica cursores opacos y rechaza basura', () => {
    expect(decodeCursor(encodeCursor({ k: 'x', id: 'y' }))).toEqual({ k: 'x', id: 'y' });
    expect(() => decodeCursor('###')).toThrow();
  });

  it('calcula el lunes de la semana y la fecha local', () => {
    expect(weekStart('2026-10-22')).toBe('2026-10-19');
    expect(weekStart('2026-10-25')).toBe('2026-10-19');
    expect(localDate(new Date('2026-10-17T03:00:00Z'), 'America/Bogota')).toBe('2026-10-16');
  });
});
