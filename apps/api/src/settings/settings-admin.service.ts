import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { D, round2 } from '../common/money';
import { RequestUser } from '../common/scoping';
import { PrismaService } from '../prisma/prisma.service';
import { effectivePalletPrice, MAX_PALLET_UNIT_PRICE } from '../common/pallet-debt';

type SettingValue = number | string | null | undefined;

/**
 * Whitelisted, per-key-validated writes over the global SettingsService.
 * Unknown keys are rejected; every change is audit-logged with before/after.
 */
@Injectable()
export class SettingsAdminService {
  constructor(
    private settings: SettingsService,
    private audit: AuditService,
    private prisma: PrismaService,
  ) {}

  private readonly validators: Record<string, (v: SettingValue) => number | null> = {
    /** max Σ debt of an agent's clients; null ⇒ unlimited, 0 ⇒ new orders blocked */
    agentDebtLimitDefault: (v) => {
      if (v === null) return null;
      const d = this.numeric(v, 'agentDebtLimitDefault');
      if (d.isNegative()) {
        throw new BadRequestException("agentDebtLimitDefault manfiy bo'lishi mumkin emas (null ⇒ cheksiz)");
      }
      return round2(d).toNumber();
    },
    truckCapacityPallets: (v) => {
      const d = this.numeric(v, 'truckCapacityPallets');
      if (!d.isInteger() || d.lessThan(1) || d.greaterThan(40)) {
        throw new BadRequestException("truckCapacityPallets 1 dan 40 gacha butun son bo'lishi kerak");
      }
      return d.toNumber();
    },
    saleMarginMinPct: (v) => {
      const d = this.numeric(v, 'saleMarginMinPct');
      if (d.isNegative() || d.greaterThan(100)) {
        throw new BadRequestException("saleMarginMinPct 0 dan 100 gacha bo'lishi kerak");
      }
      return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
    },
    /**
     * Current outstanding-pallet valuation on both client and factory cards.
     * Updating it never rewrites historical cash or lost-pallet postings.
     */
    palletPriceDefault: (v) => {
      const d = this.numeric(v, 'palletPriceDefault');
      if (d.lte(0) || d.greaterThan(MAX_PALLET_UNIT_PRICE) || d.decimalPlaces() > 2) {
        throw new BadRequestException("Paddon narxi musbat, 999 999 999 999 dan oshmagan va ko'pi bilan 2 kasr xona bo'lishi kerak");
      }
      return effectivePalletPrice(d.toString()).toNumber();
    },
  };

  async update(key: string, value: SettingValue, user: RequestUser) {
    const validator = this.validators[key];
    if (!validator) throw new BadRequestException(`Noma'lum sozlama kaliti: ${key}`);
    const next = validator(value);
    if (key === 'palletPriceDefault') {
      const price = next as number; // this key's validator never returns null
      return this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('palletPriceDefault'))`;
        const previous = await tx.appSetting.findUnique({ where: { key } });
        const before = effectivePalletPrice(previous?.value).toNumber();
        // A manual save deliberately clears import provenance even for an equal value.
        await tx.appSetting.upsert({ where: { key },
          create: { key, value: price, updatedBy: user.userId },
          update: { value: price, updatedBy: user.userId },
        });
        await this.audit.log({ tx, userId: user.userId, action: AuditAction.UPDATE,
          entity: 'AppSetting', entityId: key, before: { value: before }, after: { value: next } });
        return { key, value: next };
      });
    }
    const before = await this.settings.get<unknown>(key);
    await this.settings.set(key, next, user.userId);
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.UPDATE,
      entity: 'AppSetting',
      entityId: key,
      before: { value: before === undefined ? null : before },
      after: { value: next },
    });
    return { key, value: next };
  }

  private numeric(v: SettingValue, field: string): Prisma.Decimal {
    if (typeof v !== 'number' && typeof v !== 'string') {
      throw new BadRequestException(`${field} uchun son qiymat kiritilishi kerak`);
    }
    let d: Prisma.Decimal;
    try {
      d = D(v);
    } catch {
      throw new BadRequestException(`${field} son bo'lishi kerak`);
    }
    if (!d.isFinite()) throw new BadRequestException(`${field} son bo'lishi kerak`);
    return d;
  }
}
