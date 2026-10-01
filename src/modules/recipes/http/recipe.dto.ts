import { z } from 'zod';

export const recipeIngredientSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del ingrediente es obligatorio.'),
  quantity: z.number().positive('La cantidad debe ser mayor que cero.'),
  unit: z.string().trim().min(1, 'La unidad es obligatoria.')
});

export const recipeSchema = z.object({
  title: z.string().trim().min(2, 'El título de la receta es obligatorio.'),
  ingredients: z.array(recipeIngredientSchema).min(1, 'Debe haber al menos un ingrediente.'),
  instructions: z.array(z.string().trim().min(1, 'Cada paso debe tener texto.')).min(1, 'Debe haber al menos un paso.')
});
