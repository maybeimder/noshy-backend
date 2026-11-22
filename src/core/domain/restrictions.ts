import { ALLERGIES, DIET_STYLES, type AllergyId, type DietStyle, type GoalId } from './catalog.js';

/**
 * Compatibilidad de una receta con las restricciones del usuario y la adaptación automática.
 * Lógica pura: los repositorios le pasan ingredientes, sustitutos y preferencias.
 */
export type IngredientFacts = {
  id: string;
  label: string;
  allergens: string[]; // lactose, gluten, egg, shellfish, nuts
  dietFlags: string[]; // meat, fish, shellfish, dairy, egg, animal
};

export type UserRestrictions = {
  dietStyle: DietStyle;
  allergyIds: AllergyId[];
  excludedIngredientIds: string[];
};

export type SubstituteRule = { ingredientId: string; substitute: IngredientFacts; reason: string; priority: number };

export type Labeled = { id: string; label: string };
export type Substitution = {
  from: { ingredientId: string; label: string };
  to: { ingredientId: string; label: string };
  reason: string;
};

const DIET_LABELS: Record<string, string> = { meat: 'Carne', fish: 'Pescado', shellfish: 'Mariscos', dairy: 'Lácteos', egg: 'Huevo', animal: 'Origen animal' };

export const REASON_LABELS: Record<string, string> = {
  lactose: 'Sin lactosa',
  gluten: 'Sin gluten',
  egg: 'Sin huevo',
  shellfish: 'Sin mariscos',
  nuts: 'Sin frutos secos',
  vegetarian: 'Vegetariana',
  vegan: 'Vegana',
  pescatarian: 'Pescetariana',
  moreProtein: 'más proteína',
  airfryer: 'en airfryer',
  custom: 'sin lo que no comes',
};

/** Devuelve los motivos por los que un ingrediente choca con el usuario (vacío = compatible). */
export function conflictsOf(ing: IngredientFacts, r: UserRestrictions): Labeled[] {
  const out: Labeled[] = [];
  for (const a of r.allergyIds) {
    if (ing.allergens.includes(a)) out.push({ id: a, label: ALLERGIES.find((x) => x.id === a)?.short ?? a });
  }
  const excludes = DIET_STYLES.find((d) => d.id === r.dietStyle)?.excludes ?? [];
  for (const flag of excludes as readonly string[]) {
    if (ing.dietFlags.includes(flag)) out.push({ id: r.dietStyle, label: DIET_LABELS[flag] ?? flag });
  }
  if (r.excludedIngredientIds.includes(ing.id)) out.push({ id: 'custom', label: ing.label });
  return out;
}

const PROTEIN_GOALS: GoalId[] = ['gainMuscle', 'eatHealthier', 'loseWeight'];

export type RecipeEvaluation = {
  compatibility: { ok: boolean; conflicts: Labeled[]; adaptable: boolean };
  substitutions: Substitution[];
  reasons: Labeled[];
};

/**
 * Evalúa una receta: qué choca, qué se puede sustituir y con qué motivo.
 * `ok` = se puede cocinar tal cual o adaptada. `adaptable` = hubo choques y todos tienen sustituto.
 */
export function evaluateRecipe(
  ingredients: IngredientFacts[],
  restrictions: UserRestrictions,
  substitutes: SubstituteRule[],
  goals: GoalId[] = [],
): RecipeEvaluation {
  const unresolved: Labeled[] = [];
  const substitutions: Substitution[] = [];
  const reasons = new Map<string, string>();
  let hadConflict = false;

  for (const ing of ingredients) {
    const conflicts = conflictsOf(ing, restrictions);
    if (conflicts.length > 0) {
      hadConflict = true;
      const candidates = substitutes
        .filter((s) => s.ingredientId === ing.id && conflicts.some((c) => c.id === s.reason || (c.id === 'custom' && s.reason !== 'moreProtein')))
        .sort((a, b) => a.priority - b.priority)
        .filter((s) => conflictsOf(s.substitute, restrictions).length === 0);
      const pick = candidates[0];
      if (pick) {
        substitutions.push({ from: { ingredientId: ing.id, label: ing.label }, to: { ingredientId: pick.substitute.id, label: pick.substitute.label }, reason: pick.reason });
        reasons.set(pick.reason, REASON_LABELS[pick.reason] ?? pick.reason);
      } else {
        unresolved.push(...conflicts.filter((c) => !unresolved.some((u) => u.id === c.id && u.label === c.label)));
      }
      continue;
    }
    if (goals.some((g) => PROTEIN_GOALS.includes(g))) {
      const protein = substitutes
        .filter((s) => s.ingredientId === ing.id && s.reason === 'moreProtein')
        .filter((s) => conflictsOf(s.substitute, restrictions).length === 0)
        .sort((a, b) => a.priority - b.priority)[0];
      if (protein) {
        substitutions.push({ from: { ingredientId: ing.id, label: ing.label }, to: { ingredientId: protein.substitute.id, label: protein.substitute.label }, reason: 'moreProtein' });
        reasons.set('moreProtein', REASON_LABELS.moreProtein!);
      }
    }
  }

  return {
    compatibility: { ok: unresolved.length === 0, conflicts: unresolved, adaptable: hadConflict && unresolved.length === 0 },
    substitutions,
    reasons: [...reasons].map(([id, label]) => ({ id, label })),
  };
}
