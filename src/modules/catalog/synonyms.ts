/** Nombres del mismo alimento: cualquiera encuentra a los demás. Normalizados, en singular. */
const SAME: string[][] = [
  ['banano', 'banana'],
  ['aguacate', 'palta'],
  ['frijol', 'frisol', 'poroto', 'caraota'],
  ['maiz', 'choclo', 'elote', 'mazorca'],
  ['mani', 'cacahuate'],
  ['papa', 'patata'],
  ['tomate', 'jitomate'],
  ['fresa', 'frutilla'],
  ['durazno', 'melocoton'],
  ['arveja', 'guisante', 'chicharo'],
  ['remolacha', 'betabel'],
  ['ahuyama', 'auyama', 'zapallo', 'calabaza'],
  ['soya', 'soja'],
  ['yogur', 'yogurt'],
  ['ajonjoli', 'sesamo'],
  ['camaron', 'gamba'],
  ['habichuela', 'ejote', 'judia verde'],
];

/** Lo que alguien busca con el nombre de una categoría. */
const KINDS: Record<string, string[]> = {
  cereal: ['hojuelas maiz', 'granola', 'avena'],
  pan: ['pan tajado', 'pan frances'],
  snack: ['papas fritas', 'mani', 'galletas'],
  pasaboca: ['papas fritas', 'mani', 'galletas'],
  enlatado: ['atun', 'frijol', 'maiz dulce'],
  fruta: ['manzana', 'banano', 'naranja'],
  gaseosa: ['refresco', 'cola'],
};

const FORMS = new Map<string, string[]>(Object.entries(KINDS));
for (const group of SAME) for (const name of group) FORMS.set(name, group.filter((n) => n !== name));

/** Otras búsquedas que valen por esta (solo consultas de un alimento: «pan», no «pan con queso»). */
export function alternativesFor(terms: string[]): string[] {
  const query = terms.join(' ');
  return FORMS.get(query) ?? FORMS.get(query.replace(/s$/, '')) ?? FORMS.get(query.replace(/es$/, '')) ?? [];
}
