import { addDays, weekStart } from '../shared/time.js';

export const STREAK_MIN_PER_WEEK = 3;

/**
 * Semanas seguidas con al menos 3 recetas cocinadas.
 * La semana en curso cuenta si ya llegó al mínimo; si no, se empieza a contar desde la anterior.
 */
export function streakWeeks(cookedLocalDates: string[], today: string, minPerWeek = STREAK_MIN_PER_WEEK): number {
  const perWeek = new Map<string, number>();
  for (const d of cookedLocalDates) {
    const w = weekStart(d);
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }
  let cursor = weekStart(today);
  if ((perWeek.get(cursor) ?? 0) < minPerWeek) cursor = addDays(cursor, -7);
  let streak = 0;
  while ((perWeek.get(cursor) ?? 0) >= minPerWeek) {
    streak++;
    cursor = addDays(cursor, -7);
  }
  return streak;
}
