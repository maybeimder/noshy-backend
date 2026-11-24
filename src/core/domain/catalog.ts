/**
 * Opciones fijas del onboarding. Son código y no tabla porque la lógica depende de ellas
 * (fórmula de calorías, restricciones). Platos, tiendas e ingredientes sí viven en la base.
 */
export const GOALS = [
  { id: 'eatHealthier', label: 'Comer más sano', description: 'Más verduras y comida real', icon: 'salad' },
  { id: 'saveTime', label: 'Ahorrar tiempo', description: 'Recetas de 20 min o menos', icon: 'bolt' },
  { id: 'loseWeight', label: 'Bajar de peso', description: 'Déficit suave y saciante', icon: 'scale' },
  { id: 'gainMuscle', label: 'Ganar músculo', description: 'Más proteína en cada plato', icon: 'muscle' },
  { id: 'maintain', label: 'Mantenerme', description: 'Equilibrio sin pensarlo', icon: 'balance' },
  { id: 'custom', label: 'Personalizado', description: 'Cuéntaselo a tu chef', icon: 'chef', allowsNote: true },
] as const;
export type GoalId = (typeof GOALS)[number]['id'];
export const GOAL_IDS = GOALS.map((g) => g.id) as [GoalId, ...GoalId[]];

export const ACTIVITY_LEVELS = [
  { id: 'sedentary', label: 'Tranquilo', description: 'Trabajo sentado la mayor parte del día', neutral: 'Ritmo tranquilo' },
  { id: 'active', label: 'Activo', description: 'Camino o entreno 2–3 días por semana', neutral: 'Ritmo activo' },
  { id: 'veryActive', label: 'Muy activo', description: 'Entreno casi todos los días', neutral: 'Ritmo muy activo' },
] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number]['id'];
export const ACTIVITY_IDS = ACTIVITY_LEVELS.map((a) => a.id) as [ActivityLevel, ...ActivityLevel[]];

export const DIET_STYLES = [
  { id: 'omnivore', label: 'Omnívoro', excludes: [] },
  { id: 'vegetarian', label: 'Vegetariano', excludes: ['meat', 'fish', 'shellfish'] },
  { id: 'vegan', label: 'Vegano', excludes: ['meat', 'fish', 'shellfish', 'dairy', 'egg', 'animal'] },
  { id: 'pescatarian', label: 'Pescetariano', excludes: ['meat'] },
  { id: 'flexitarian', label: 'Flexitariano', excludes: [] },
] as const;
export type DietStyle = (typeof DIET_STYLES)[number]['id'];
export const DIET_IDS = DIET_STYLES.map((d) => d.id) as [DietStyle, ...DietStyle[]];

/** Alergias: el id coincide con el alérgeno marcado en el ingrediente. */
export const ALLERGIES = [
  { id: 'lactose', label: 'Sin lactosa', short: 'Lactosa' },
  { id: 'gluten', label: 'Sin gluten', short: 'Gluten' },
  { id: 'egg', label: 'Sin huevo', short: 'Huevo' },
  { id: 'shellfish', label: 'Sin mariscos', short: 'Mariscos' },
  { id: 'nuts', label: 'Sin frutos secos', short: 'Frutos secos' },
] as const;
export type AllergyId = (typeof ALLERGIES)[number]['id'];
export const ALLERGY_IDS = ALLERGIES.map((a) => a.id) as [AllergyId, ...AllergyId[]];

export const CARE = [
  { id: 'lessSodium', label: 'Menos sodio', short: 'Sodio extra' },
  { id: 'lessSugar', label: 'Menos azúcar', short: 'Azúcar extra' },
  { id: 'moreFiber', label: 'Más fibra', short: 'Más fibra' },
] as const;
export type CareId = (typeof CARE)[number]['id'];
export const CARE_IDS = CARE.map((c) => c.id) as [CareId, ...CareId[]];

export const SKILL_LEVELS = [
  { id: 'basic', label: 'Básico' },
  { id: 'intermediate', label: 'Me defiendo' },
  { id: 'advanced', label: 'Avanzado' },
] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number]['id'];
export const SKILL_IDS = SKILL_LEVELS.map((s) => s.id) as [SkillLevel, ...SkillLevel[]];

export const EQUIPMENT = [
  { id: 'airfryer', label: 'Airfryer' },
  { id: 'oven', label: 'Horno' },
  { id: 'blender', label: 'Licuadora' },
  { id: 'pressureCooker', label: 'Olla a presión' },
  { id: 'microwave', label: 'Microondas' },
] as const;
export type EquipmentId = (typeof EQUIPMENT)[number]['id'];
export const EQUIPMENT_IDS = EQUIPMENT.map((e) => e.id) as [EquipmentId, ...EquipmentId[]];

export const COOKING_TIMES = [
  { maxMinutes: 15, label: '15 min' },
  { maxMinutes: 30, label: '30 min', default: true },
  { maxMinutes: 45, label: '45 min' },
  { maxMinutes: null, label: 'Sin prisa' },
] as const;

export const ONBOARDING_STEPS = ['goals', 'activity', 'restrictions', 'tastes', 'kitchen', 'shopping'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const LIMITS = {
  maxGoals: 2,
  mealsPerDay: { min: 1, max: 6, default: 3 },
  maxCustomExclusions: 10,
  maxFavoriteDishes: 20,
  weeklyBudget: { min: 50_000, max: 1_500_000, step: 10_000, default: 180_000, currency: 'COP' as const },
};

export const STORAGES = ['fridge', 'pantry', 'freezer'] as const;
export type Storage = (typeof STORAGES)[number];

export const MEAL_SLOTS = ['breakfast', 'snack1', 'lunch', 'snack2', 'dinner'] as const;
export type MealSlotId = (typeof MEAL_SLOTS)[number];

export const DIFFICULTIES = [
  { id: 'easy', label: 'Fácil' },
  { id: 'medium', label: 'Media' },
  { id: 'hard', label: 'Difícil' },
] as const;
export type Difficulty = (typeof DIFFICULTIES)[number]['id'];

/** Etiquetas de cocinas (para «Gustos: Colombiana, italiana»). */
export const CUISINES: Record<string, string> = {
  korean: 'Coreana',
  colombian: 'Colombiana',
  italian: 'Italiana',
  mexican: 'Mexicana',
  hawaiian: 'Hawaiana',
  american: 'Americana',
  international: 'Internacional',
  indian: 'India',
  japanese: 'Japonesa',
};

export const labelOf = <T extends { id: string; label: string }>(list: readonly T[], id: string): string =>
  list.find((x) => x.id === id)?.label ?? id;

export const CATEGORY_LABELS: Record<string, string> = {
  produce: 'Frutas y verduras',
  protein: 'Carnes y huevos',
  seafood: 'Pescados y mariscos',
  dairy: 'Lácteos',
  staples: 'Despensa',
  spices: 'Especias',
  bakery: 'Panadería',
  drinks: 'Bebidas',
};
