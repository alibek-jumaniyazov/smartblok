import { ConfigService } from '@nestjs/config';

// Fail fast instead of silently falling back to a public 'dev-secret': a missing/weak JWT_SECRET
// in production would let anyone forge an ADMIN token signed with the known constant.
export function requireJwtSecret(config?: ConfigService): string {
  const s = (config?.get<string>('JWT_SECRET') ?? process.env.JWT_SECRET) || '';
  if (s.length < 16) {
    throw new Error(
      'JWT_SECRET o‘rnatilmagan yoki juda qisqa (kamida 16 belgi). apps/api/.env faylida uzun tasodifiy qiymat bering.',
    );
  }
  return s;
}
