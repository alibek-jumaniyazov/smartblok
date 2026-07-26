import { IsOptional, Matches } from 'class-validator';

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * To'liq eksport oynasi (Toshkent kunlari, `to` — o'sha kun ham kiradi).
 *
 * Ikkalasi ham ixtiyoriy: bo'sh qoldirilsa BUTUN baza chiqadi. Sana berilsa ham
 * faqat HARAKAT varaqlari (buyurtma, to'lov, kassa, paddon, bosh daftar) qisqaradi
 * — joriy qoldiqlar va ma'lumotnomalar har doim to'liq bo'ladi, chunki «2-iyulgacha
 * bo'lgan qoldiq» degan narsa yo'q: qoldiq — bugungi holat.
 *
 * DIQQAT: `main.ts` da ValidationPipe `forbidNonWhitelisted` bilan ishlaydi —
 * bu yerda e'lon qilinmagan har qanday query parametr 400 qaytaradi (jimgina
 * tashlab yuborilmaydi). Umumiy «semiz» ListQueryDto ishlatmang.
 */
export class ExportQueryDto {
  @IsOptional()
  @Matches(DATE_RE, { message: "from formati YYYY-MM-DD bo'lishi kerak" })
  from?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: "to formati YYYY-MM-DD bo'lishi kerak" })
  to?: string;
}
