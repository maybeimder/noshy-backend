import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'El nombre es obligatorio.'),
  email: z.string().trim().email('Debe ser un email válido.'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.')
});

export const loginSchema = z.object({
  email: z.string().trim().email('Debe ser un email válido.'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.')
});

export const authHeaderSchema = z.object({
  authorization: z.string().regex(/^Bearer\s+.+$/, 'El token de autorización es inválido.')
});
