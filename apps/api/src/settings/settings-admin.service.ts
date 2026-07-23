import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { D, round2 } from '../common/money';
import { RequestUser } from '../common/scoping';

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
     * Price a CLIENT is billed for a pallet he LOST — the only pallet money in the system.
     * Orders book pallets at 0 and a factory return moves nothing, so this never reaches
     * the factory. 0 ⇒ «not configured»: the owner-locked 130 000 applies.
     */
    palletPriceDefault: (v) => {
      const d = this.numeric(v, 'palletPriceDefault');
      if (d.isNegative()) {
        throw new BadRequestException("palletPriceDefault manfiy bo'lishi mumkin emas (0 ⇒ standart 130 000 amal qiladi)");
      }
      return round2(d).toNumber();
    },
  };

  async update(key: string, value: SettingValue, user: RequestUser) {
    const validator = this.validators[key];
    if (!validator) throw new BadRequestException(`Noma'lum sozlama kaliti: ${key}`);
    const next = validator(value);
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
