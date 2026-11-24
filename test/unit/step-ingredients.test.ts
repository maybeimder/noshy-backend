import { describe, expect, it } from 'vitest';
import { assignStepIngredients } from '../../src/core/domain/step-ingredients.js';

const ings = (...labels: string[]) => labels.map((label, i) => ({ id: `i${i}`, label }));
const assign = (steps: string[], labels: string[]) => assignStepIngredients(steps.map((text) => ({ text })), ings(...labels)).map((s) => s.map((k) => labels[k]));

describe('mise en place por paso', () => {
  it('cada ingrediente va donde se usa, con plurales y tildes', () => {
    expect(assign(['Sazona el lomo y séllalo.', 'Derrite la mantequilla con el ajo y saltea los camarones.', 'Termina con limón.'], ['Lomo de res', 'Camarón', 'Mantequilla', 'Ajo', 'Limón Tahití'])).toEqual([
      ['Lomo de res'],
      ['Camarón', 'Mantequilla', 'Ajo'],
      ['Limón Tahití'],
    ]);
  });
  it('«sal» no es «salsa» y la mención más clara gana a la primera vaga', () => {
    expect(assign(['Haz la salsa.', 'Cocina la pasta con sal.', 'Agrega la salsa de soya.'], ['Sal', 'Salsa de soya'])).toEqual([[], ['Sal'], ['Salsa de soya']]);
    expect(assign(['Hierve la pasta.', 'Sofríe la pasta de tomate.'], ['Pasta de tomate'])).toEqual([[], ['Pasta de tomate']]);
  });
  it('ninguno se pierde y lo declarado manda', () => {
    expect(assign(['Hornea.', 'Sirve.'], ['Vainilla'])).toEqual([['Vainilla'], []]);
    expect(assign(['Precalienta el horno.', 'Mezcla todo.'], ['Vainilla'])).toEqual([[], ['Vainilla']]);
    expect(assignStepIngredients([{ text: 'Usa el ajo' }, { text: 'Sirve', ingredientIds: ['i0', 'x'] }], ings('Ajo', 'Sal'))).toEqual([[1], [0]]);
    expect(assignStepIngredients([], ings('Ajo'))).toEqual([]);
  });
});
