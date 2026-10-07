// Entrada única (HTTP y RabbitMQ) del módulo de lista de compras.
import { defineHandler } from '../../../core/commands/command-bus';
import { shoppingListInputSchema } from '../http/shopping-list.dto';
import { createShoppingList } from '../shopping-list.service';

export const ShoppingListHandlers = {
  generate: 'shopping.generate'
} as const;

export const shoppingListHandlers = [
  defineHandler({
    name: ShoppingListHandlers.generate,
    schema: shoppingListInputSchema,
    execute: ({ userId, data }) => createShoppingList(userId, data)
  })
];
