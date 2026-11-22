import { z } from 'zod';

export const RegisterBody = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.email().max(200),
  password: z.string().min(8).max(200),
  acceptedTermsVersion: z.string().min(1).max(20),
  grammaticalGender: z.enum(['feminine', 'masculine', 'neutral']).nullish(),
});

export const LoginBody = z.object({ email: z.email(), password: z.string().min(1).max(200) });

export const OAuthParams = z.object({ provider: z.enum(['google', 'apple']) });
export const OAuthBody = z.object({
  idToken: z.string().min(10),
  nonce: z.string().nullish(),
  name: z.string().trim().max(60).nullish(),
  acceptedTermsVersion: z.string().min(1).max(20),
});

export const RefreshBody = z.object({ refreshToken: z.string().min(10) });
