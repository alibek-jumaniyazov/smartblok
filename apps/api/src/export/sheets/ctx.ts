import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LedgerService } from '../../common/ledger.service';
import type { PalletService } from '../../pallets/pallets.service';
import type { KassaService } from '../../kassa/kassa.service';
import type { SettingsService } from '../../common/settings.service';
import type { Book } from '../xlsx/book';

/** Sana oynasi — Toshkent kunlaridan hosil qilingan UTC chegaralari. */
export interface Window {
  gte: Date;
  lt: Date;
}

/**
 * Varaq yozuvchilarga beriladigan umumiy kontekst.
 *
 * Har bir yozuvchi o'z ma'lumotini O'ZI Prisma'dan oladi — ataylab. HTTP ro'yxat
 * endpointlari orqali o'qish mumkin emas: `pageSize` ikki joyda 200 ga qotirilgan
 * (common/pagination.ts), shuning uchun ular to'liq dampni jimgina kesib tashlaydi.
 */
export interface Ctx {
  book: Book;
  prisma: PrismaService;
  ledger: LedgerService;
  pallets: PalletService;
  kassa: KassaService;
  settings: SettingsService;
  /** null ⇒ butun baza. */
  window: Window | null;
  /** Varaq izohlarida ko'rsatiladigan davr matni. */
  periodLabel: string;
}

/**
 * Harakat jadvallari uchun sana sharti.
 *
 * MUHIM: bu FAQAT harakat varaqlariga qo'llanadi (buyurtma, to'lov, kassa, paddon,
 * bosh daftar). Qoldiqlarga qo'llanmaydi — «1-iyulgacha bo'lgan qoldiq» degan narsa
 * yo'q, qoldiq har doim bugungi holat. Qoldiqni tanlangan davr ichidagi yozuvlardan
 * qayta hisoblasak, u saytdagi hech bir ekran bilan mos kelmaydi.
 */
export const dateWhere = (win: Window | null, field = 'date'): Record<string, unknown> =>
  win ? { [field]: { gte: win.gte, lt: win.lt } } : {};

/** Toshkent kunlaridan UTC oynasi (yuqori chegara — keyingi kunning yarim tuni). */
export const inWindow = (win: Window | null, d: Date | null | undefined): boolean => {
  if (!win || !d) return true;
  return d.getTime() >= win.gte.getTime() && d.getTime() < win.lt.getTime();
};

export const ZERO = new Prisma.Decimal(0);

/** Map'dan Decimal olish (yo'q bo'lsa 0). */
export const dec = (m: Map<string, Prisma.Decimal> | undefined, id: string): Prisma.Decimal =>
  m?.get(id) ?? ZERO;
