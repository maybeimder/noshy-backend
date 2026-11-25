/**
 * OCR + interpretación de facturas. Un parser real (servicio de visión o LLM) implementa la misma interfaz.
 * `MockReceiptParser` devuelve una factura plausible para desarrollar el flujo completo sin proveedor.
 */
export type ParsedReceipt =
  | {
      ok: true;
      storeHint: string | null;
      purchasedAt: Date | null;
      total: number;
      lines: { rawLabel: string; brand: string | null; price: number }[];
      raw: unknown;
    }
  | { ok: false; reason: 'unreadable' | 'notAReceipt' | 'unsupportedStore'; raw: unknown };

export interface ReceiptParser {
  readonly name: string;
  parse(file: Buffer, contentType: string, storeId: string | null): Promise<ParsedReceipt>;
}

export class MockReceiptParser implements ReceiptParser {
  readonly name = 'mock';
  async parse(file: Buffer, _contentType: string, storeId: string | null): Promise<ParsedReceipt> {
    if (file.length < 16) return { ok: false, reason: 'unreadable', raw: { bytes: file.length } };
    const purchasedAt = new Date(Date.now() - 2 * 86_400_000);
    const lines = [
      { rawLabel: 'PECHUGA POLLO MAC POLLO 500G', brand: 'Mac Pollo', price: 12900 },
      { rawLabel: 'TOMATE CHONTO KG', brand: null, price: 4200 },
      { rawLabel: 'HUEVOS AA KIKES X12', brand: 'Kikes', price: 4500 },
      { rawLabel: 'BEBIDA AVENA ALPINA SIN AZUCAR 1L', brand: 'Alpina', price: 8900 },
      { rawLabel: 'ESPINACA BABY 250G', brand: null, price: 7100 },
      { rawLabel: 'BOLSA PLASTICA', brand: null, price: 100 },
    ];
    return {
      ok: true,
      storeHint: storeId ?? 'exito',
      purchasedAt,
      total: lines.reduce((a, l) => a + l.price, 0),
      lines,
      raw: { parser: 'mock', lines },
    };
  }
}

export class NoneReceiptParser implements ReceiptParser {
  readonly name = 'none';
  async parse(): Promise<ParsedReceipt> {
    return { ok: false, reason: 'unreadable', raw: null };
  }
}
