import { describe, expect, it } from 'vitest';
import { matchesText } from '../../src/core/shared/text-search.js';

describe('búsqueda por texto', () => {
  it('ignora tildes y mayúsculas, y pide todas las palabras', () => {
    expect(matchesText('limon POLLO', 'Pollo al Limón')).toBe(true);
    expect(matchesText('pollo coco', 'Pollo al limón', 'Leche de coco')).toBe(true);
    expect(matchesText('pollo res', 'Pollo al limón')).toBe(false);
    expect(matchesText('  ', 'x')).toBe(true);
    expect(matchesText(undefined, null)).toBe(true);
  });
});
