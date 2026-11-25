import { describe, expect, it } from 'vitest';
import { DaysService } from '../../src/modules/home/days.service.js';
import { addDays } from '../../src/core/shared/time.js';

const today = new Date().toISOString().slice(0, 10);
const log = (localDate: string, kcal: number, skipped = false) => ({ localDate, kcal, proteinG: 10, carbsG: 20, fatG: 5, skipped });
const service = (logs: unknown[]) =>
  new DaysService(
    {} as never,
    { between: async () => logs } as never,
    { getOrThrow: async () => ({ nutritionTargets: { kcal: 2000, proteinG: 100, carbsG: 200, fatG: 60, fiberG: 25 } }) } as never,
    {} as never,
    {} as never,
  );

describe('historial', () => {
  it('suma por día, del más nuevo al más viejo, con los días vacíos y sin las saltadas', async () => {
    const r = await service([log(today, 400), log(today, 300), log(today, 0, true), log(addDays(today, -2), 500)]).history('u', addDays(today, -2), today);
    expect(r.target).toEqual({ kcal: 2000, proteinG: 100, carbsG: 200, fatG: 60 });
    expect(r.days.map((d) => [d.date, d.meals, d.consumed.kcal])).toEqual([
      [today, 2, 700],
      [addDays(today, -1), 0, 0],
      [addDays(today, -2), 1, 500],
    ]);
  });

  it('rechaza rangos al revés o de más de 31 días', async () => {
    await expect(service([]).history('u', today, addDays(today, -1))).rejects.toThrow();
    await expect(service([]).history('u', addDays(today, -31), today)).rejects.toThrow();
  });
});
