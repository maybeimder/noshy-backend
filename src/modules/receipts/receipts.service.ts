import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { ReceiptsRepository, ReceiptRow } from './receipts.repository.js';
import type { Storage } from '../../infrastructure/storage/storage.js';
import type { ReceiptParser } from './receipts.providers.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { PantryService } from '../pantry/pantry.service.js';
import { cop } from '../../core/shared/money.js';
import { Errors, field } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';

export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'];
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
const STOPWORDS = new Set(['de', 'la', 'el', 'con', 'sin', 'en', 'kg', 'x12']);
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

/**
 * Facturas: la subida es síncrona (202), el procesamiento lo hace el observer `receipts` con `receipt.uploaded`.
 * Al terminar emite `receipt.parsed` y de ahí salen despensa, aprendizajes y el mensaje del chef.
 */
export class ReceiptsService {
  constructor(
    private readonly db: Db,
    private readonly repo: ReceiptsRepository,
    private readonly storage: Storage,
    private readonly parser: ReceiptParser,
    private readonly catalog: CatalogService,
    private readonly pantry: PantryService,
    private readonly outbox: Outbox,
  ) {}

  dto(r: ReceiptRow) {
    return {
      id: r.id,
      status: r.status,
      store: r.storeId ? { id: r.storeId, name: this.catalog.store(r.storeId)?.name ?? r.storeId } : null,
      purchasedAt: r.purchasedAt?.toISOString() ?? null,
      total: r.total !== null ? cop(r.total) : null,
      itemsCount: r.itemsCount,
      learned: r.learned,
      pantryAdded: r.pantryAdded,
      failureReason: r.failureReason,
    };
  }

  async upload(userId: string, file: { buffer: Buffer; contentType: string }, storeId: string | null) {
    if (!RECEIPT_TYPES.includes(file.contentType)) throw Errors.unsupportedMedia('Sube una foto (JPG, PNG, HEIC) o un PDF.');
    if (file.buffer.length > RECEIPT_MAX_BYTES) throw Errors.tooLarge('La factura pesa más de 10 MB.');
    if (storeId && !this.catalog.store(storeId)) throw Errors.validation([field('storeId', 'INVALID_OPTION', 'Tienda desconocida.')]);
    const id = newId('receipt');
    const key = `receipts/${userId}/${id}`;
    await this.storage.put(key, file.buffer, file.contentType);
    await this.db.transaction(async (tx) => {
      await this.repo.insert(tx, { id, userId, status: 'processing', storeId, fileKey: key, contentType: file.contentType });
      await this.outbox.record(tx, 'receipt.uploaded', { userId, receiptId: id });
    });
    this.outbox.kick();
    return { receiptId: id, status: 'processing' as const };
  }

  async get(userId: string, id: string) {
    const r = await this.repo.byId(userId, id);
    if (!r) throw Errors.notFound('Esa factura no existe.');
    return this.dto(r);
  }

  /** Relaciona una línea de factura con un ingrediente: todas sus palabras significativas deben aparecer. */
  matchIngredient(raw: string): string | null {
    const text = norm(raw);
    let best: { id: string; score: number } | null = null;
    for (const ing of this.catalog.search('', 1000)) {
      const words = ing.searchText.split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
      if (words.length === 0) continue;
      const hit = words.filter((w) => text.includes(w.slice(0, Math.max(4, w.length - 1)))).length;
      if (hit === words.length || (words.length >= 2 && hit >= 2)) {
        const score = hit * 10 + words.join('').length;
        if (!best || score > best.score) best = { id: ing.id, score };
      }
    }
    return best?.id ?? null;
  }

  async process(receiptId: string, tz: string) {
    const r = await this.repo.byIdAny(receiptId);
    if (!r || r.status !== 'processing') return;
    const file = await this.storage.get(r.fileKey);
    const parsed = await this.parser.parse(file ?? Buffer.alloc(0), r.contentType, r.storeId);
    await this.repo.saveRaw(r.id, r.userId, this.parser.name, parsed.raw);
    if (!parsed.ok) {
      await this.db.transaction(async (tx) => {
        await this.repo.update(tx, r.id, { status: 'failed', failureReason: parsed.reason });
        await this.outbox.record(tx, 'receipt.failed', { userId: r.userId, receiptId: r.id, reason: parsed.reason });
      });
      return;
    }
    const storeId = r.storeId ?? (parsed.storeHint && this.catalog.store(parsed.storeHint) ? parsed.storeHint : null);
    const lines = parsed.lines.map((l) => {
      const id = newId('receiptItem');
      const ingredientId = this.matchIngredient(l.rawLabel);
      const product = ingredientId
        ? (this.catalog.productsFor(ingredientId).find((p) => l.brand && p.brand.toLowerCase() === l.brand.toLowerCase()) ?? this.catalog.genericProduct(ingredientId))
        : undefined;
      return { ...l, id, ingredientId, productId: product?.id ?? null };
    });
    const matched = lines.filter((l) => l.ingredientId);
    const brands = [...new Set(lines.map((l) => l.brand).filter((b): b is string => !!b))];
    const purchasedAt = parsed.purchasedAt ?? r.createdAt;
    await this.db.transaction(async (tx) => {
      await this.repo.insertItems(
        tx,
        lines.map((l) => ({ id: l.id, receiptId: r.id, rawLabel: l.rawLabel, brand: l.brand, price: l.price, ingredientId: l.ingredientId, productId: l.productId, addToPantry: !!l.ingredientId })),
      );
      const added = await this.pantry.addPurchased(
        tx,
        r.userId,
        tz,
        matched.map((l) => {
          const p = l.productId ? this.catalog.product(l.productId) : null;
          return { ingredientId: l.ingredientId!, productId: l.productId, value: p?.packValue ?? null, unit: p?.packUnit ?? null, storeId, price: l.price, purchasedAt, receiptItemId: l.id };
        }),
        'receipt',
      );
      await this.repo.update(tx, r.id, {
        status: 'parsed',
        storeId,
        purchasedAt,
        total: parsed.total,
        itemsCount: lines.length,
        learned: { brandsCount: brands.length, productsCount: matched.length },
        pantryAdded: added.length,
      });
      await this.outbox.record(tx, 'receipt.parsed', {
        userId: r.userId,
        receiptId: r.id,
        storeId,
        purchasedAt: purchasedAt.toISOString(),
        ingredientIds: matched.map((l) => l.ingredientId!),
        brands,
      });
    });
  }

  /** «Tu factura de Éxito»: las líneas con su toggle «A mi despensa». */
  async items(userId: string, receiptId: string) {
    const r = await this.repo.byId(userId, receiptId);
    if (!r) throw Errors.notFound('Esa factura no existe.');
    const items = await this.repo.items(r.id);
    return {
      receipt: this.dto(r),
      items: items.map((i) => ({
        id: i.id,
        rawLabel: i.rawLabel,
        label: i.ingredientId ? this.catalog.label(i.ingredientId) : null,
        brand: i.brand,
        price: cop(i.price),
        ingredientId: i.ingredientId,
        addToPantry: i.addToPantry,
      })),
    };
  }

  async reviewItem(userId: string, tz: string, receiptId: string, itemId: string, addToPantry: boolean) {
    const r = await this.repo.byId(userId, receiptId);
    if (!r) throw Errors.notFound('Esa factura no existe.');
    if (r.status !== 'parsed') throw Errors.conflict('RECEIPT_NOT_PARSED', 'La factura todavía no está lista.');
    const item = await this.repo.item(r.id, itemId);
    if (!item) throw Errors.notFound('Esa línea no está en la factura.');
    if (addToPantry && !item.ingredientId) throw Errors.unprocessable('NOT_A_FOOD_ITEM', 'No reconocimos ese producto como comida.');
    if (item.addToPantry !== addToPantry) {
      await this.db.transaction(async (tx) => {
        await this.repo.updateItem(tx, item.id, { addToPantry });
        if (addToPantry) {
          const p = item.productId ? this.catalog.product(item.productId) : null;
          await this.pantry.addPurchased(
            tx,
            userId,
            tz,
            [{ ingredientId: item.ingredientId!, productId: item.productId, value: p?.packValue ?? null, unit: p?.packUnit ?? null, storeId: r.storeId, price: item.price, purchasedAt: r.purchasedAt ?? r.createdAt, receiptItemId: item.id }],
            'receipt',
          );
        } else {
          await this.pantry.removeByReceiptItem(tx, userId, item.id);
        }
        await this.outbox.record(tx, 'receipt.item_reviewed', { userId, receiptId: r.id, itemId: item.id, addToPantry });
      });
      this.outbox.kick();
    }
    return (await this.items(userId, receiptId)).items.find((i) => i.id === itemId)!;
  }
}
