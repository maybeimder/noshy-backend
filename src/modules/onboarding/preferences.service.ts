import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { PreferencesRepository, PreferencesRow } from './preferences.repository.js';
import type { UsersRepository } from '../auth/auth.repository.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import {
  ACTIVITY_LEVELS,
  ALLERGIES,
  CARE,
  DIET_STYLES,
  EQUIPMENT,
  GOALS,
  LIMITS,
  SKILL_LEVELS,
  labelOf,
  CUISINES,
  type ActivityLevel,
  type AllergyId,
  type DietStyle,
  type GoalId,
} from '../../core/domain/catalog.js';
import { computeTargets, isValidKcalTarget, macrosForKcal, type Biometrics } from '../../core/domain/nutrition.js';
import type { IngredientFacts, UserRestrictions } from '../../core/domain/restrictions.js';
import { conflictsOf } from '../../core/domain/restrictions.js';
import type {
  Labeled,
  NutritionTargets,
  PreferencesGoals,
  PreferencesKitchen,
  PreferencesRestrictions,
  PreferencesShopping,
  StoredBiometrics,
} from '../../infrastructure/database/postgres/types.js';
import { Errors, field, type FieldError } from '../../core/shared/errors.js';

export type BiometricsInput = Biometrics & { consentVersion: string };

export type PreferencesInput = {
  goals: PreferencesGoals | null;
  activityLevel: string | null;
  /** undefined: no llegó (no cambia); null: sin biometría o borrarla. */
  biometrics?: BiometricsInput | null;
  nutrition: { kcalTarget: number; adjustedByUser: boolean } | null;
  restrictions: PreferencesRestrictions | null;
  tastes: { favoriteDishIds: string[] } | null;
  kitchen: PreferencesKitchen | null;
  shopping: PreferencesShopping | null;
};

const GOAL_SHORT: Record<string, string> = {
  eatHealthier: 'Más sano',
  saveTime: 'Ahorrar tiempo',
  loseWeight: 'Bajar de peso',
  gainMuscle: 'Ganar músculo',
  maintain: 'Mantenerme',
  custom: 'Personalizado',
};

const FLAVOR_LABELS: Record<string, string> = {
  avocado: 'Aguacate',
  spicy: 'Picante',
  cheese: 'Queso',
  plantain: 'Plátano',
  creamy: 'Cremoso',
  sweet: 'Dulce',
  umami: 'Umami',
  fresh: 'Fresco',
  comfort: 'Reconfortante',
  smoky: 'Ahumado',
};
/** Sabores que chocan con una alergia: no se ofrecen como «Te encanta» (Q3). */
const FLAVOR_CONFLICTS: Record<string, string[]> = { cheese: ['lactose'], creamy: [] };

const fmtKcal = (n: number) => `${n.toLocaleString('es-CO')} kcal`;

/**
 * Preferencias del usuario: validación de negocio, defaults para pasos saltados,
 * metas nutricionales, gustos inferidos y los textos de resumen que muestra el front.
 */
export class PreferencesService {
  constructor(
    private readonly db: Db,
    private readonly repo: PreferencesRepository,
    private readonly users: UsersRepository,
    private readonly catalog: CatalogService,
    private readonly outbox: Outbox,
  ) {}

  get(userId: string) {
    return this.repo.get(userId);
  }

  async getOrThrow(userId: string): Promise<PreferencesRow> {
    const p = await this.repo.get(userId);
    if (!p) throw Errors.onboardingIncomplete();
    return p;
  }

  restrictionsOf(p: PreferencesRow): UserRestrictions {
    return {
      dietStyle: p.restrictions.dietStyle as DietStyle,
      allergyIds: p.restrictions.allergyIds as AllergyId[],
      excludedIngredientIds: (p.restrictions.customExclusionIds ?? []).filter((x): x is string => !!x),
    };
  }

  goalsOf(p: PreferencesRow): GoalId[] {
    return p.goals.ids as GoalId[];
  }

  /** Reglas que zod no puede expresar solo (límites cruzados, IDs del catálogo, rango de kcal). */
  validate(input: Partial<PreferencesInput>): void {
    const errs: FieldError[] = [];
    if (input.goals) {
      if (input.goals.ids.length > LIMITS.maxGoals) errs.push(field('goals.ids', 'TOO_MANY', `Puedes elegir máximo ${LIMITS.maxGoals} objetivos.`));
      if (input.goals.customNote && !input.goals.ids.includes('custom'))
        errs.push(field('goals.customNote', 'NOT_ALLOWED', 'La nota solo aplica al objetivo Personalizado.'));
      if (input.goals.customNote && input.goals.customNote.length > 280) errs.push(field('goals.customNote', 'NOTE_TOO_LONG', 'Máximo 280 caracteres.'));
    }
    if (input.nutrition && !isValidKcalTarget(input.nutrition.kcalTarget))
      errs.push(field('nutrition.kcalTarget', 'OUT_OF_RANGE', 'Debe estar entre 1.400 y 4.000 kcal, en pasos de 50.'));
    if (input.restrictions && input.restrictions.customExclusions.length > LIMITS.maxCustomExclusions)
      errs.push(field('restrictions.customExclusions', 'TOO_MANY', `Máximo ${LIMITS.maxCustomExclusions}.`));
    if (input.tastes) {
      if (input.tastes.favoriteDishIds.length > LIMITS.maxFavoriteDishes) errs.push(field('tastes.favoriteDishIds', 'TOO_MANY', 'Máximo 20 platos.'));
      input.tastes.favoriteDishIds.forEach((d, i) => {
        if (!this.catalog.dish(d)) errs.push(field(`tastes.favoriteDishIds.${i}`, 'INVALID_OPTION', `Plato desconocido: ${d}`));
      });
    }
    if (input.kitchen && (input.kitchen.mealsPerDay < LIMITS.mealsPerDay.min || input.kitchen.mealsPerDay > LIMITS.mealsPerDay.max))
      errs.push(field('kitchen.mealsPerDay', 'OUT_OF_RANGE', 'Debe estar entre 1 y 6.'));
    if (input.shopping) {
      input.shopping.storeIds.forEach((s, i) => {
        if (!this.catalog.store(s)) errs.push(field(`shopping.storeIds.${i}`, 'INVALID_OPTION', `Tienda desconocida: ${s}`));
      });
      const b = input.shopping.weeklyBudget.amount;
      if (b < LIMITS.weeklyBudget.min || b > LIMITS.weeklyBudget.max) errs.push(field('shopping.weeklyBudget.amount', 'OUT_OF_RANGE', 'Presupuesto fuera de rango.'));
    }
    if (errs.length) throw Errors.validation(errs);
  }

  /** Completa secciones saltadas con defaults y calcula todo lo derivado. */
  resolve(input: PreferencesInput) {
    const goals: PreferencesGoals = input.goals ?? { ids: ['eatHealthier'], customNote: null };
    const activityLevel = (input.activityLevel ?? 'active') as ActivityLevel;
    const preview = computeTargets({ goalIds: goals.ids as GoalId[], activityLevel, biometrics: input.biometrics });
    const kcal = input.nutrition?.kcalTarget ?? preview.kcal;
    const nutritionTargets: NutritionTargets = {
      kcal,
      ...macrosForKcal(kcal, preview.macroSplit),
      source: input.nutrition?.adjustedByUser ? 'adjusted' : 'suggested',
    };
    const restrictions = this.resolveRestrictions(input.restrictions ?? { dietStyle: 'omnivore', allergyIds: [], careIds: [], customExclusions: [] });
    const favoriteDishIds = input.tastes?.favoriteDishIds ?? [];
    const kitchen: PreferencesKitchen = input.kitchen ?? { mealsPerDay: 3, maxCookingMinutes: 30, skillLevel: 'intermediate', equipmentIds: [] };
    const shopping: PreferencesShopping = input.shopping ?? {
      storeIds: this.catalog.stores().slice(0, 2).map((s) => s.id),
      priceQualityBalance: 0.5,
      weeklyBudget: { amount: LIMITS.weeklyBudget.default, currency: 'COP' },
    };
    const { loves, likedCuisines } = this.inferTastes(favoriteDishIds, restrictions);
    return {
      goals,
      activityLevel,
      biometrics: input.biometrics ? this.stampConsent(input.biometrics) : null,
      kcalTarget: kcal,
      kcalAdjustedByUser: input.nutrition?.adjustedByUser ?? false,
      restrictions,
      favoriteDishIds,
      kitchen,
      shopping,
      nutritionTargets,
      loves,
      likedCuisines,
    };
  }

  /** Conserva la fecha del consentimiento original mientras la versión no cambie. */
  private stampConsent(b: BiometricsInput & { consentedAt?: string }): StoredBiometrics {
    return { ...b, consentedAt: b.consentedAt ?? new Date().toISOString() };
  }

  private resolveRestrictions(r: PreferencesRestrictions): PreferencesRestrictions {
    const customExclusionIds = r.customExclusions.map((text) => {
      const hit = this.catalog.search(text.replace(/^sin\s+/i, ''), 1)[0];
      return hit ? hit.id : null;
    });
    return { ...r, customExclusionIds };
  }

  private inferTastes(dishIds: string[], r: PreferencesRestrictions) {
    const flavorCount = new Map<string, number>();
    const cuisineCount = new Map<string, number>();
    for (const id of dishIds) {
      const d = this.catalog.dish(id);
      if (!d) continue;
      d.flavorTags.forEach((f) => flavorCount.set(f, (flavorCount.get(f) ?? 0) + 1));
      if (d.cuisineId) cuisineCount.set(d.cuisineId, (cuisineCount.get(d.cuisineId) ?? 0) + 1);
    }
    const loves: Labeled[] = [...flavorCount]
      .filter(([f]) => FLAVOR_LABELS[f] && !(FLAVOR_CONFLICTS[f] ?? []).some((a) => r.allergyIds.includes(a)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id]) => ({ id, label: FLAVOR_LABELS[id]! }));
    const likedCuisines: Labeled[] = [...cuisineCount]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => ({ id, label: CUISINES[id] ?? id }));
    return { loves, likedCuisines };
  }

  private mergeBiometrics(next: BiometricsInput | null | undefined, current: StoredBiometrics | null): (BiometricsInput & { consentedAt?: string }) | null {
    if (next === undefined) return current;
    if (next && current && next.consentVersion === current.consentVersion) return { ...next, consentedAt: current.consentedAt };
    return next;
  }

  async patch(userId: string, input: Partial<PreferencesInput>) {
    this.validate(input);
    const current = await this.getOrThrow(userId);
    const sections = Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined);
    if (sections.length === 0) throw Errors.validation([field('body', 'EMPTY', 'Manda al menos una sección.')]);

    const merged: PreferencesInput = {
      goals: input.goals ?? current.goals,
      activityLevel: input.activityLevel ?? current.activityLevel,
      biometrics: this.mergeBiometrics(input.biometrics, current.biometrics),
      nutrition: input.nutrition ?? null,
      restrictions: input.restrictions ?? current.restrictions,
      tastes: input.tastes ?? { favoriteDishIds: current.favoriteDishIds },
      kitchen: input.kitchen ?? current.kitchen,
      shopping: input.shopping ?? current.shopping,
    };
    const recalc = !input.nutrition && (input.goals !== undefined || input.activityLevel !== undefined || input.biometrics !== undefined);
    if (!input.nutrition && !recalc) merged.nutrition = { kcalTarget: current.kcalTarget, adjustedByUser: current.kcalAdjustedByUser };
    const resolved = this.resolve(merged);
    if (recalc) resolved.nutritionTargets.source = 'recalculated';
    else if (!input.nutrition) resolved.nutritionTargets = current.nutritionTargets;

    await this.db.transaction(async (tx) => {
      await this.repo.update(tx, userId, resolved);
      await this.outbox.record(tx, 'preferences.updated', { userId, sections, targetsRecalculated: recalc });
    });
    this.outbox.kick();
    return this.getOrThrow(userId);
  }

  /** Lo que el front necesita para volver a calcular el punto de partida. */
  calculationInputs(p: PreferencesRow) {
    return { activityLevel: p.activityLevel, biometrics: p.biometrics, kcalAdjustedByUser: p.kcalAdjustedByUser };
  }

  /** `summary` de la respuesta de onboarding y de Perfil. */
  summary(p: PreferencesRow) {
    const never: { id: string | null; label: string; kind: string; matchedIngredientId?: string }[] = [
      ...p.restrictions.allergyIds.map((id) => ({ id, label: ALLERGIES.find((a) => a.id === id)?.short ?? id, kind: 'allergy' })),
      ...p.restrictions.careIds.map((id) => ({ id, label: CARE.find((c) => c.id === id)?.short ?? id, kind: 'care' })),
      ...(p.restrictions.dietStyle !== 'omnivore' && p.restrictions.dietStyle !== 'flexitarian'
        ? [{ id: p.restrictions.dietStyle, label: labelOf(DIET_STYLES, p.restrictions.dietStyle), kind: 'diet' }]
        : []),
      ...p.restrictions.customExclusions.map((text, i) => {
        const matched = p.restrictions.customExclusionIds?.[i] ?? null;
        const label = text.replace(/^sin\s+/i, '');
        return { id: null, label: label.charAt(0).toUpperCase() + label.slice(1), kind: 'custom', ...(matched ? { matchedIngredientId: matched } : {}) };
      }),
    ];
    return {
      goals: p.goals.ids.map((id) => ({ id, label: labelOf(GOALS, id) })),
      never,
      loves: p.loves,
      kitchen: {
        mealsPerDay: p.kitchen.mealsPerDay,
        maxCookingMinutes: p.kitchen.maxCookingMinutes,
        skillLevel: { id: p.kitchen.skillLevel, label: labelOf(SKILL_LEVELS, p.kitchen.skillLevel) },
        equipment: p.kitchen.equipmentIds.map((id) => ({ id, label: labelOf(EQUIPMENT, id) })),
      },
      shopping: {
        stores: p.shopping.storeIds.map((id) => ({ id, name: this.catalog.store(id)?.name ?? id })),
        priceQualityBalance: p.shopping.priceQualityBalance,
        weeklyBudget: p.shopping.weeklyBudget,
      },
    };
  }

  /** Filas de «Tus preferencias» con el texto ya redactado (Q22: forma neutra sin dato de género). */
  rows(p: PreferencesRow, grammaticalGender: string | null) {
    const activity = ACTIVITY_LEVELS.find((a) => a.id === p.activityLevel);
    const activityText =
      grammaticalGender === 'feminine'
        ? (activity?.label ?? '').replace(/o$/, 'a').replace(/o (\w+)$/, 'a $1')
        : grammaticalGender === 'masculine'
          ? (activity?.label ?? '')
          : (activity?.neutral ?? p.activityLevel);
    const restrictionParts = this.summary(p).never.map((n, i) => {
      const t = n.kind === 'allergy' ? `sin ${n.label.toLowerCase()}` : n.kind === 'care' ? n.label.toLowerCase() : n.label.toLowerCase();
      return i === 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t;
    });
    const cuisines = p.likedCuisines.map((c, i) => (i === 0 ? c.label : c.label.toLowerCase())).join(', ');
    return [
      { section: 'goals', label: 'Objetivo', summary: p.goals.ids.map((g) => GOAL_SHORT[g] ?? g).join(' · ') },
      { section: 'activity', label: 'Tu ritmo', summary: `${activityText} · ${fmtKcal(p.nutritionTargets.kcal)}` },
      { section: 'restrictions', label: 'Restricciones', summary: restrictionParts.length ? restrictionParts.join(', ') : 'Ninguna' },
      { section: 'tastes', label: 'Gustos', summary: [cuisines, `${p.favoriteDishIds.length} favoritos`].filter(Boolean).join(' · ') },
      {
        section: 'kitchen',
        label: 'Tu cocina',
        summary: `${p.kitchen.mealsPerDay} comidas · ${p.kitchen.maxCookingMinutes === null ? 'sin prisa' : `${p.kitchen.maxCookingMinutes} min`}`,
      },
      { section: 'shopping', label: 'Compras', summary: p.shopping.storeIds.map((id) => this.catalog.store(id)?.name ?? id).join(', ') },
    ];
  }

  /** Revisa si un ingrediente choca con este usuario (para chips de conflicto en búsquedas). */
  conflictsFor(p: PreferencesRow | null, ingredientId: string) {
    return this.conflictsForFacts(p, this.catalog.facts(ingredientId));
  }

  /** Igual, con los datos a la mano: sirve para alimentos que aún no están en el catálogo local. */
  conflictsForFacts(p: PreferencesRow | null, facts: IngredientFacts) {
    return p ? conflictsOf(facts, this.restrictionsOf(p)) : [];
  }

  async userGender(userId: string) {
    return (await this.users.findById(userId))?.grammaticalGender ?? null;
  }
}
