import type { MealSlotId } from './catalog.js';

/**
 * Franjas del día. `mealsPerDay` cuenta comidas principales; los snacks se agregan aparte (Q13).
 * El backend arma las franjas y el front no las deduce.
 */
export type SlotDef = { slot: MealSlotId; label: string; window: { from: string; to: string } };

const ALL: Record<MealSlotId, SlotDef> = {
  breakfast: { slot: 'breakfast', label: 'Desayuno', window: { from: '06:00', to: '10:00' } },
  snack1: { slot: 'snack1', label: 'Snack 1', window: { from: '10:00', to: '12:00' } },
  lunch: { slot: 'lunch', label: 'Almuerzo', window: { from: '12:00', to: '15:00' } },
  snack2: { slot: 'snack2', label: 'Snack 2', window: { from: '15:00', to: '18:00' } },
  dinner: { slot: 'dinner', label: 'Cena', window: { from: '18:00', to: '21:30' } },
};

export function slotsFor(mealsPerDay: number): SlotDef[] {
  if (mealsPerDay <= 1) return [ALL.lunch];
  if (mealsPerDay === 2) return [ALL.lunch, ALL.dinner];
  if (mealsPerDay === 3) return [ALL.breakfast, ALL.snack1, ALL.lunch, ALL.dinner];
  return [ALL.breakfast, ALL.snack1, ALL.lunch, ALL.snack2, ALL.dinner];
}

export const slotDef = (slot: MealSlotId) => ALL[slot];

/** Franja actual según la hora local (`HH:mm`). Fuera de toda ventana: la próxima. */
export function currentSlot(slots: SlotDef[], hhmm: string): MealSlotId | null {
  const inside = slots.find((s) => hhmm >= s.window.from && hhmm < s.window.to);
  if (inside) return inside.slot;
  const next = slots.find((s) => hhmm < s.window.from);
  return next?.slot ?? null;
}

export type SlotStatus = 'logged' | 'current' | 'pending' | 'skipped';
