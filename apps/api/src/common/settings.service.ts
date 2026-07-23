import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const SETTING_KEYS = {
  /** number | null (null ⇒ unlimited). Per-agent Agent.debtLimit overrides. */
  agentDebtLimitDefault: 'agentDebtLimitDefault',
  /** default pallets per truck when a vehicle has no own capacity */
  truckCapacityPallets: 'truckCapacityPallets',
  /** minimum allowed sale margin over factory price, % (guards lump-sum entry) */
  saleMarginMinPct: 'saleMarginMinPct',
  /**
   * Price charged to a CLIENT for a pallet he lost — the only place a pallet is worth
   * money. Not a factory price: returning pallets to the factory earns nothing.
   * null / 0 ⇒ not configured, the owner-locked 130 000 applies.
   */
  palletPriceDefault: 'palletPriceDefault',
} as const;

const DEFAULTS: Record<string, unknown> = {
  [SETTING_KEYS.agentDebtLimitDefault]: null,
  [SETTING_KEYS.truckCapacityPallets]: 19,
  [SETTING_KEYS.saleMarginMinPct]: 0,
  [SETTING_KEYS.palletPriceDefault]: null,
};

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get<T = unknown>(key: string): Promise<T> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    return (row ? (row.value as T) : (DEFAULTS[key] as T)) as T;
  }

  async set(key: string, value: unknown, updatedBy?: string): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value: value as object, updatedBy },
      update: { value: value as object, updatedBy },
    });
  }

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.appSetting.findMany();
    const merged: Record<string, unknown> = { ...DEFAULTS };
    for (const r of rows) merged[r.key] = r.value;
    return merged;
  }
}
