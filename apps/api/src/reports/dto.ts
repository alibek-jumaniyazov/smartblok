import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Zavod hisobotining oynasi: BITTA zavod + Toshkent kunlaridagi sana oralig'i.
 *
 * DIQQAT: `main.ts` da ValidationPipe `forbidNonWhitelisted` bilan ishlaydi — bu yerda
 * e'lon qilinmagan har qanday query parametr BUTUN so'rovni 400 qiladi (jimgina tashlab
 * yuborilmaydi). Aynan shu Mijozlar sahifasidagi agent filtrini o'ldirgan edi, shuning
 * uchun umumiy «semiz» ListQueryDto ISHLATILMAYDI — har endpoint o'z DTO si bilan yuradi.
 */
export class FactoryReportQueryDto {
  /** Majburiy: «hamma zavod bo'yicha» degan hisobot yo'q — har zavodning o'z narxnomasi bor. */
  @IsUUID('4', { message: "factoryId noto'g'ri — zavodni ro'yxatdan tanlang" })
  factoryId!: string;

  @IsOptional()
  @Matches(DATE_RE, { message: "from formati YYYY-MM-DD bo'lishi kerak" })
  from?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: "to formati YYYY-MM-DD bo'lishi kerak" })
  to?: string;
}

/** Hisobot ostidagi buyurtmalar ro'yxati — server sahifalash bilan. */
export class FactoryReportOrdersQueryDto extends FactoryReportQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 20;
}
