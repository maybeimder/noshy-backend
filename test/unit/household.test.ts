import { describe, expect, it } from 'vitest';
import { acceptsUnit, gramsPerMeasure, otherUnits, type Measurable } from '../../src/core/domain/household.js';

const ing = (searchText: string, o: Partial<Measurable> = {}): Measurable => ({ searchText, allowedUnits: ['g', 'kg'], gramsPerUnit: {}, typicalPack: { unit: 'g' }, ...o });

describe('medidas de un ingrediente', () => {
  it('cualquier ingrediente se puede pesar o medir en casa; ml y l solo en líquidos', () => {
    expect(otherUnits(ing('arroz'))).toEqual(['cup', 'tbsp', 'tsp']);
    expect(acceptsUnit(ing('huevos', { allowedUnits: ['unit'], typicalPack: { unit: 'unit' } }), 'g')).toBe(true);
    expect(acceptsUnit(ing('huevos', { allowedUnits: ['unit'], typicalPack: { unit: 'unit' } }), 'ml')).toBe(false);
    expect(acceptsUnit(ing('salsa de soya', { allowedUnits: ['tbsp', 'tsp'], typicalPack: { unit: 'ml' } }), 'ml')).toBe(true);
    expect(acceptsUnit(ing('arroz'), 'clove')).toBe(false);
  });

  it('la taza pesa según el alimento; lo propio manda sobre lo aproximado', () => {
    expect(gramsPerMeasure(ing('arroz blanco'))).toEqual({ cup: 185, tbsp: 11.6, tsp: 3.9 });
    expect(gramsPerMeasure(ing('harina de avena')).cup).toBe(125);
    expect(gramsPerMeasure(ing('arroz', { gramsPerUnit: { cup: 184 } })).cup).toBe(184);
    expect(gramsPerMeasure(ing('bebida de avena', { allowedUnits: ['ml', 'l'] }))).toEqual({});
    expect(gramsPerMeasure(ing('pechuga de pollo'))).toEqual({});
  });
});
