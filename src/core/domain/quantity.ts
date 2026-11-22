/**
 * Cantidades del contrato: `{ value, unit, display }`.
 * El backend escala y arma `display` en español; el front solo lo muestra.
 */
export const UNITS = ['g', 'kg', 'ml', 'l', 'unit', 'clove', 'tbsp', 'tsp', 'cup', 'pinch', 'toTaste', 'all'] as const;
export type Unit = (typeof UNITS)[number];

export type Quantity = { value: number | null; unit: Unit; display: string };
export type QuantityInput = { value: number; unit: Unit };

const LABELS: Record<Unit, [singular: string, plural: string]> = {
  g: ['g', 'g'],
  kg: ['kg', 'kg'],
  ml: ['ml', 'ml'],
  l: ['l', 'l'],
  unit: ['und', 'und'],
  clove: ['diente', 'dientes'],
  tbsp: ['cda', 'cda'],
  tsp: ['cdta', 'cdta'],
  cup: ['taza', 'tazas'],
  pinch: ['pizca', 'pizcas'],
  toTaste: ['al gusto', 'al gusto'],
  all: ['todo', 'todo'],
};

/** Gramos (o ml, asumiendo densidad 1) por unidad cuando la conversión no depende del ingrediente. */
const FIXED_GRAMS: Partial<Record<Unit, number>> = { g: 1, kg: 1000, ml: 1, l: 1000, tbsp: 15, tsp: 5, cup: 240, pinch: 0.5 };

const numberEs = (n: number): string => {
  const rounded = n >= 100 ? Math.round(n / 5) * 5 : n >= 10 ? Math.round(n) : Math.round(n * 4) / 4;
  return rounded.toLocaleString('es-CO', { maximumFractionDigits: 2 });
};

/** `unitLabel` permite al ingrediente nombrar su unidad («atado», «lata»). */
export function formatQuantity(value: number | null, unit: Unit, unitLabel?: [string, string]): string {
  if (unit === 'toTaste' || unit === 'all') return LABELS[unit][0];
  if (value === null) return LABELS[unit][0];
  const [one, many] = unit === 'unit' && unitLabel ? unitLabel : LABELS[unit];
  const n = numberEs(value);
  return `${n} ${value === 1 ? one : many}`;
}

export function quantity(value: number | null, unit: Unit, unitLabel?: [string, string]): Quantity {
  const v = value === null ? null : Math.round(value * 100) / 100;
  return { value: v, unit, display: formatQuantity(v, unit, unitLabel) };
}

export function scale(value: number | null, factor: number): number | null {
  return value === null ? null : value * factor;
}

/**
 * Convierte a gramos. `gramsPerUnit` viene del ingrediente (un huevo ≈ 50 g, un diente de ajo ≈ 5 g).
 * Devuelve null si no se puede convertir (al gusto, todo, o unidad sin equivalencia).
 */
export function toGrams(value: number | null, unit: Unit, gramsPerUnit: Partial<Record<Unit, number>> = {}): number | null {
  if (value === null) return null;
  const perUnit = gramsPerUnit[unit] ?? FIXED_GRAMS[unit];
  return perUnit === undefined ? null : value * perUnit;
}

export const isUnit = (u: string): u is Unit => (UNITS as readonly string[]).includes(u);

/** Escala de calor 0–9 del modo cocina. 0 = fuego apagado. */
export function heatLabel(level: number): string {
  if (level <= 0) return 'Apagado';
  if (level <= 3) return 'Bajo';
  if (level <= 6) return 'Medio';
  return 'Alto';
}
