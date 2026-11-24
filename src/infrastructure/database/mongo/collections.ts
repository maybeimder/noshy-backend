import type { Db, Collection } from 'mongodb';

/**
 * Colecciones de Mongo: lo documental o de alto volumen.
 * - chef_threads / chef_messages: conversación con bloques tipados de forma variable.
 * - cooking_events: telemetría de modo cocina (muchos eventos por sesión).
 * - user_signals / insights: aprendizaje del chef.
 * - receipt_scans: salida cruda del OCR de facturas.
 * - products_slim: catálogo de alimentos (USDA + Open Food Facts). Lo carga otro proceso; aquí es de SOLO LECTURA.
 */

export type ChefContext = { type: 'main' } | { type: 'recipe'; recipeId: string; title: string };

export type ChefThreadDoc = {
  _id: string;
  userId: string;
  contextKey: string; // "main" | "recipe:<id>" (único por usuario)
  context: ChefContext;
  lastMessageAt: Date | null;
  lastReadAt: Date | null;
  createdAt: Date;
};

export type ChefBlock =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'recipeCard'; recipe: Record<string, unknown>; actions: string[] }
  | { id: string; type: 'quickReplies'; options: { id: string; label: string; prompt?: string }[] }
  | { id: string; type: 'feedbackPrompt'; targetBlockId: string; label: string; allowAnotherIdea: boolean }
  | { id: string; type: 'learnedInsight'; insightId: string; text: string }
  | { id: string; type: 'suggestedPrompts'; options: { id: string; label: string }[] }
  | { id: string; type: 'adaptationProposal'; proposalId: string; recipeId: string; summary: string; changes: string[] };

export type ChefMessageDoc = {
  _id: string;
  threadId: string;
  userId: string;
  role: 'chef' | 'user';
  createdAt: Date;
  proactive?: boolean;
  clientMessageId?: string;
  blocks: ChefBlock[];
  feedback?: Record<string, 'up' | 'down'>;
  /** Recetas ya mostradas en este hilo, para que «Otra idea» no repita. */
  recipeIds?: string[];
  status: 'complete' | 'streaming' | 'failed';
};

export type CookingEventDoc = {
  _id: string; // dedupe: sessionId|type|step|substep|at
  sessionId: string;
  userId: string;
  type: string;
  stepIndex?: number;
  subStepIndex?: number;
  addedSeconds?: number;
  command?: string;
  enabled?: boolean;
  at: Date;
  receivedAt: Date;
};

export type SignalKind =
  | 'cooked'
  | 'rated'
  | 'brandPurchased'
  | 'brandSwapped'
  | 'ideaFeedback'
  | 'liked'
  | 'mealLogged'
  | 'timerExtended';

export type UserSignalDoc = {
  userId: string;
  kind: SignalKind;
  at: Date;
  weekday?: number;
  slot?: string;
  recipeId?: string;
  tags?: string[];
  brand?: string;
  value?: number;
  eventId: string;
};

export type InsightDoc = {
  _id: string;
  userId: string;
  key: string; // estable: "weekdayFlavor:2:creamy", "brand:Alpina"
  text: string;
  confidence: number;
  evidence: { count: number; kind: 'recipes' | 'receipts'; label: string };
  userVote: 'up' | 'down' | null;
  status: 'active' | 'rejected';
  updatedAt: Date;
};

export type ReceiptScanDoc = { _id: string; userId: string; parser: string; raw: unknown; createdAt: Date };

/** Alimento de `products_slim`. Los datos son de la comunidad: casi todo puede faltar. */
export type FoodDoc = {
  _id: string; // «usda:1», «7702…»
  name: string;
  displayName?: string;
  brand?: string; // «generic» = sin marca
  state?: 'raw' | 'cooked' | 'canned' | 'plain';
  /** Nombre y marca normalizados (minúsculas, sin tildes). */
  search: string;
  suspect?: boolean;
  quantity?: string | null;
  per100g?: { kcal?: number | null; protein_g?: number | null; carbs_g?: number | null; fat_g?: number | null; fiber_g?: number | null };
  servings?: { label: string; grams: number }[];
  nova?: number | null;
  allergens?: string[];
  ingredients?: string | null;
  dietTags?: string[];
  labels?: string[];
  foodGroups?: string[];
  /** Foto del producto (Open Food Facts). */
  image?: string | null;
  popularity?: number;
  completeness?: number;
};

/** Receta de `recipes_raw` (RecipeNLG): en inglés, sin macros ni porciones. Solo lectura. */
export type RawRecipeDoc = { _id: number; title: string; ingredients?: string[]; directions?: string[]; ner?: string[]; nIngredients?: number };

export type MongoCollections = {
  chefThreads: Collection<ChefThreadDoc>;
  chefMessages: Collection<ChefMessageDoc>;
  cookingEvents: Collection<CookingEventDoc>;
  userSignals: Collection<UserSignalDoc>;
  insights: Collection<InsightDoc>;
  receiptScans: Collection<ReceiptScanDoc>;
};

export function collections(db: Db): MongoCollections {
  return {
    chefThreads: db.collection<ChefThreadDoc>('chef_threads'),
    chefMessages: db.collection<ChefMessageDoc>('chef_messages'),
    cookingEvents: db.collection<CookingEventDoc>('cooking_events'),
    userSignals: db.collection<UserSignalDoc>('user_signals'),
    insights: db.collection<InsightDoc>('insights'),
    receiptScans: db.collection<ReceiptScanDoc>('receipt_scans'),
  };
}

export async function ensureIndexes(c: MongoCollections): Promise<void> {
  await c.chefThreads.createIndex({ userId: 1, contextKey: 1 }, { unique: true });
  await c.chefMessages.createIndex({ threadId: 1, createdAt: -1 });
  await c.chefMessages.createIndex({ userId: 1, clientMessageId: 1 });
  await c.cookingEvents.createIndex({ sessionId: 1, at: 1 });
  await c.userSignals.createIndex({ userId: 1, kind: 1, at: -1 });
  await c.userSignals.createIndex({ eventId: 1, kind: 1 });
  await c.insights.createIndex({ userId: 1, key: 1 }, { unique: true });
  await c.insights.createIndex({ userId: 1, status: 1, confidence: -1 });
}
