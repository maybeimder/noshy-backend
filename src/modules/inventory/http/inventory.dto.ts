import { z } from 'zod';

export const inventoryItemSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del ingrediente es obligatorio.'),
  quantity: z.number().positive('La cantidad debe ser mayor que cero.'),
  unit: z.string().trim().min(1, 'La unidad es obligatoria.')
});
