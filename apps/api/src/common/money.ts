import { Prisma } from '@prisma/client';

/** All money math goes through Prisma.Decimal — never JS floats. */
export type Money = Prisma.Decimal;
export const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v ?? 0);

export const ZERO = new Prisma.Decimal(0);

/** Round to whole tiyin-free UZS-cent grid (2dp) — storage precision of every money column. */
export const round2 = (v: Prisma.Decimal.Value): Prisma.Decimal => D(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Volumes are stored at 3dp (m³). */
export const round3 = (v: Prisma.Decimal.Value): Prisma.Decimal => D(v).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);

export const sum = (values: Prisma.Decimal.Value[]): Prisma.Decimal =>
  values.reduce<Prisma.Decimal>((acc, v) => acc.plus(D(v)), ZERO);

/** Workbook rule: |balance| < 1 UZS is float residue from back-solved prices — display as settled. */
export const isSettled = (balance: Prisma.Decimal.Value): boolean => D(balance).abs().lessThan(1);

/** Guard for client-supplied numerics that must be positive money. */
export const assertPositiveMoney = (v: Prisma.Decimal.Value, field: string): Prisma.Decimal => {
  const d = D(v);
  if (!d.isFinite() || d.lessThanOrEqualTo(0)) {
    throw new Error(`${field} musbat son bo'lishi kerak`);
  }
  return round2(d);
};
