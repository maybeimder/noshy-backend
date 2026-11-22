import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { createPostgres, type Db } from '../postgres/postgres.client.js';
import * as t from '../postgres/schema.js';
import { recipeNutrition } from '../../../core/domain/nutrition.js';
import { BRANDED_PRODUCTS, CATEGORY_LABELS, COMMUNITY_USERS, CUISINES, DISHES, INGREDIENTS, RECIPES, STORES, SUBSTITUTES } from './data.js';

const CDN = 'https://cdn.noshy.app';

/** Carga el catálogo. Idempotente: se puede correr varias veces. */
export async function seed(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const s of STORES) {
      await tx.insert(t.stores).values({ id: s.id, name: s.name, logoUrl: s.logoUrl, sort: s.sort }).onConflictDoUpdate({ target: t.stores.id, set: { name: s.name, logoUrl: s.logoUrl, sort: s.sort } });
    }
    for (const d of DISHES) {
      const row = { id: d.id, label: d.label, imageUrl: d.imageUrl, cuisineId: d.cuisineId, flavorTags: d.flavorTags, sort: d.sort };
      await tx.insert(t.dishes).values(row).onConflictDoUpdate({ target: t.dishes.id, set: row });
    }
    for (const i of INGREDIENTS) {
      const row = {
        id: i.id,
        label: i.label,
        icon: i.icon,
        categoryId: i.cat,
        categoryLabel: CATEGORY_LABELS[i.cat]!,
        defaultStorage: i.storage,
        shelfLifeDays: i.life,
        allergens: i.allergens ?? [],
        dietFlags: i.diet ?? [],
        flavorTags: i.flavor ?? [],
        nutritionPer100g: i.n ? { kcal: i.n[0], proteinG: i.n[1], carbsG: i.n[2], fatG: i.n[3], fiberG: i.n[4] } : null,
        gramsPerUnit: i.gpu ?? {},
        unitLabel: i.unitLabel ?? null,
        defaultUnit: i.unit,
        allowedUnits: i.units,
        typicalPack: { value: i.pack.value, unit: i.pack.unit, label: i.pack.label },
        isBasic: i.basic ?? false,
        searchText: i.label.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''),
      };
      await tx.insert(t.ingredients).values(row).onConflictDoUpdate({ target: t.ingredients.id, set: row });
    }
    await tx.delete(t.ingredientSubstitutes);
    await tx.insert(t.ingredientSubstitutes).values(SUBSTITUTES.map((s) => ({ ingredientId: s.from, substituteId: s.to, reason: s.reason, priority: s.priority ?? 1 })));

    // Productos: uno genérico por ingrediente + los de marca, con precio por tienda.
    const products = [
      ...INGREDIENTS.map((i) => ({ id: `prd_gen_${i.id.slice(4)}`, ingredientId: i.id, brand: 'Genérico', label: i.label, value: i.pack.value, unit: i.pack.unit, packLabel: i.pack.label, base: i.pack.price, cat: i.cat, tags: [] as string[] })),
      ...BRANDED_PRODUCTS.map((b) => ({ ...b, packLabel: b.packLabel, cat: INGREDIENTS.find((i) => i.id === b.ingredientId)!.cat, tags: b.tags ?? [] })),
    ];
    for (const p of products) {
      const row = { id: p.id, ingredientId: p.ingredientId, brand: p.brand, label: p.label, packValue: p.value, packUnit: p.unit, packLabel: p.packLabel, tags: p.tags };
      await tx.insert(t.products).values(row).onConflictDoUpdate({ target: t.products.id, set: row });
      for (const s of STORES) {
        if (s.onlyCategories && !s.onlyCategories.includes(p.cat)) continue;
        const price = Math.round((p.base * s.factor) / 100) * 100;
        await tx
          .insert(t.productPrices)
          .values({ productId: p.id, storeId: s.id, price })
          .onConflictDoUpdate({ target: [t.productPrices.productId, t.productPrices.storeId], set: { price } });
      }
    }

    for (const u of COMMUNITY_USERS) {
      await tx
        .insert(t.users)
        .values({ id: u.id, name: u.name, lastName: u.lastName, email: u.email, emailVerified: true, onboardingStatus: 'completed', acceptedTermsVersion: '2026-09', avatarUrl: `${CDN}/u/${u.name.toLowerCase()}.webp` })
        .onConflictDoNothing();
    }

    const ingById = new Map(INGREDIENTS.map((i) => [i.id, i]));
    for (const r of RECIPES) {
      const nutrition = recipeNutrition(
        r.ingredients.map(([id, value, unit]) => {
          const i = ingById.get(id)!;
          return {
            value,
            unit,
            nutrition: { per100g: i.n ? { kcal: i.n[0], proteinG: i.n[1], carbsG: i.n[2], fatG: i.n[3], fiberG: i.n[4] } : null, gramsPerUnit: i.gpu ?? {} },
          };
        }),
        r.servings,
      );
      const publishedAt = new Date(Date.now() - (r.publishedDaysAgo ?? 120) * 86_400_000);
      const row = {
        id: r.id,
        authorType: r.author ? 'user' : 'noshy',
        authorId: r.author ?? null,
        status: 'published',
        title: r.title,
        slug: r.slug,
        imageUrl: `${CDN}/recipes/${r.slug}.webp`,
        cuisineId: r.cuisineId,
        cuisineLabel: CUISINES[r.cuisineId] ?? r.cuisineId,
        dishId: r.dishId,
        tags: r.tags,
        flavorTags: r.flavorTags,
        mealSlots: r.mealSlots,
        timeMin: r.time[0],
        timeMax: r.time[1],
        baseServings: r.servings,
        difficulty: r.difficulty,
        steps: r.steps,
        nutritionPerServing: nutrition.perServing,
        nutritionStatus: nutrition.status,
        chefConsultable: { enabled: r.chefConsultable ?? true, useMyStyle: true, suggestSubstitutes: true },
        ratingSum: r.rating?.[0] ?? 0,
        ratingCount: r.rating?.[1] ?? 0,
        likesCount: r.likes ?? 0,
        publishedAt,
      };
      await tx.insert(t.recipes).values(row).onConflictDoUpdate({ target: t.recipes.id, set: row });
      await tx.delete(t.recipeIngredients).where(sql`${t.recipeIngredients.recipeId} = ${r.id}`);
      await tx.insert(t.recipeIngredients).values(r.ingredients.map(([ingredientId, value, unit, prep], position) => ({ recipeId: r.id, ingredientId, value, unit, prep: prep ?? null, position })));
    }
  });
}

/** Carga el catálogo solo si la base está vacía (arranque de la API). No pisa likes ni ratings reales. */
export async function seedIfEmpty(db: Db): Promise<boolean> {
  const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from stores`);
  if ((r.rows[0]?.n ?? 0) > 0) return false;
  await seed(db);
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no está definido');
  const pg = createPostgres(url);
  await seed(pg.db);
  await pg.close();
  console.log('Catálogo cargado');
}
