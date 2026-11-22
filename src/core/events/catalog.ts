/**
 * Catálogo de eventos de dominio. Es el contrato entre módulos: quien emite no conoce a quien escucha.
 * Convención: `<agregado>.<hecho en pasado>`. Los payloads llevan IDs, no objetos completos.
 */
export type EventPayloads = {
  'user.registered': { userId: string; method: 'password' | 'google' | 'apple' };
  'user.email_verification_requested': { userId: string; verificationId: string };
  'user.email_verified': { userId: string };
  'user.settings_updated': { userId: string; sections: string[] };
  'user.deleted': { userId: string; storageKeys: string[] };
  'data_export.requested': { userId: string; exportId: string };
  'onboarding.completed': { userId: string; menuId: string; skippedSteps: string[] };
  'preferences.updated': { userId: string; sections: string[]; targetsRecalculated: boolean };

  'pantry.items_added': { userId: string; itemIds: string[]; ingredientIds: string[]; source: string };
  'pantry.item_updated': { userId: string; itemId: string; ingredientId: string };
  'pantry.item_removed': { userId: string; itemId: string; ingredientId: string; addToShoppingList: boolean };
  'pantry.items_consumed': { userId: string; sessionId: string; updates: { itemId: string; ingredientId: string; remainingPct: number; removed: boolean }[] };

  'receipt.uploaded': { userId: string; receiptId: string };
  'receipt.parsed': { userId: string; receiptId: string; storeId: string | null; purchasedAt: string | null; ingredientIds: string[]; brands: string[] };
  'receipt.failed': { userId: string; receiptId: string; reason: string };
  'receipt.item_reviewed': { userId: string; receiptId: string; itemId: string; addToPantry: boolean };

  'menu.generated': { userId: string; menuId: string; weekStart: string; recipeIds: string[] };
  'menu.entry_added': { userId: string; menuId: string; entryId: string; recipeId: string; servings: number };
  'menu.entry_changed': { userId: string; menuId: string; entryId: string; fromRecipeId: string; toRecipeId: string; servings: number };
  'menu.entry_removed': { userId: string; menuId: string; entryId: string; recipeId: string };

  'shopping.list_created': { userId: string; listId: string; weekStart: string };
  'shopping.item_checked': { userId: string; listId: string; itemId: string; checked: boolean };
  'shopping.item_swapped': { userId: string; listId: string; itemId: string; productId: string; brand: string; savings: number };
  'shopping.checked_out': { userId: string; listId: string; storeId: string; pantryItemIds: string[]; spent: number };

  'meal.logged': { userId: string; mealId: string; localDate: string; slot: string; recipeId: string | null; source: 'manual' | 'cooking' };
  'meal.deleted': { userId: string; mealId: string; localDate: string };

  'cooking.started': { userId: string; sessionId: string; recipeId: string };
  'cooking.events_recorded': { userId: string; sessionId: string; timerExtensions: { stepIndex: number; addedSeconds: number }[] };
  'cooking.completed': {
    userId: string;
    sessionId: string;
    recipeId: string;
    rating: number | null;
    localDate: string;
    weekday: number;
    slot: string | null;
    tags: string[];
  };
  'cooking.abandoned': { userId: string; sessionId: string; recipeId: string; atStepIndex: number; reason: string | null };

  'recipe.saved': { userId: string; recipeId: string; saved: boolean };
  'recipe.liked': { userId: string; recipeId: string; liked: boolean };
  'recipe.adapted': { userId: string; recipeId: string; adaptationId: string; source: 'auto' | 'proposal' };
  'recipe.publish_requested': { userId: string; recipeId: string };
  'recipe.published': { userId: string; recipeId: string };
  'recipe.rejected': { userId: string; recipeId: string; reason: string };
  'comment.created': { userId: string; recipeId: string; commentId: string; recipeAuthorId: string | null };
  'user.followed': { userId: string; followeeId: string; following: boolean };

  'chef.message_sent': { userId: string; threadId: string; messageId: string; inputType: string };
  'chef.feedback_given': { userId: string; messageId: string; blockId: string; rating: 'up' | 'down'; recipeId: string | null };
  'insight.voted': { userId: string; insightId: string; vote: 'up' | 'down' };
  'nudge.dismissed': { userId: string; nudgeId: string; kind: string; reason: 'dismissed' | 'acted' };
};

export type EventType = keyof EventPayloads;

/**
 * Lista en tiempo de ejecución de los tipos del catálogo. La usa el `DomainEventFactory` para rechazar
 * eventos desconocidos al rehidratar desde el event store o desde RabbitMQ.
 * El `satisfies` + el chequeo de abajo hacen que olvidar un tipo aquí sea un error de compilación.
 */
export const EVENT_TYPES = [
  'user.registered',
  'user.email_verification_requested',
  'user.email_verified',
  'user.settings_updated',
  'user.deleted',
  'data_export.requested',
  'onboarding.completed',
  'preferences.updated',
  'pantry.items_added',
  'pantry.item_updated',
  'pantry.item_removed',
  'pantry.items_consumed',
  'receipt.uploaded',
  'receipt.parsed',
  'receipt.failed',
  'receipt.item_reviewed',
  'menu.generated',
  'menu.entry_added',
  'menu.entry_changed',
  'menu.entry_removed',
  'shopping.list_created',
  'shopping.item_checked',
  'shopping.item_swapped',
  'shopping.checked_out',
  'meal.logged',
  'meal.deleted',
  'cooking.started',
  'cooking.events_recorded',
  'cooking.completed',
  'cooking.abandoned',
  'recipe.saved',
  'recipe.liked',
  'recipe.adapted',
  'recipe.publish_requested',
  'recipe.published',
  'recipe.rejected',
  'comment.created',
  'user.followed',
  'chef.message_sent',
  'chef.feedback_given',
  'insight.voted',
  'nudge.dismissed',
] as const satisfies readonly EventType[];

type MissingInList = Exclude<EventType, (typeof EVENT_TYPES)[number]>;
const _everyTypeListed: MissingInList extends never ? true : MissingInList = true;
void _everyTypeListed;
