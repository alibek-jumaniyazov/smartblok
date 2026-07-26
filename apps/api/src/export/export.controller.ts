import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { ExportQueryDto } from './dto';
import { ExportService } from './export.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('export')
export class ExportController {
  constructor(private readonly service: ExportService) {}

  /**
   * Butun biznesning bitta Excel faylga to'liq eksporti.
   *
   * ROL: faqat ADMIN va BUXGALTER. Bu ataylab — AGENT tokeni bilan chaqirilsa
   * o'qish yo'llari uni o'z mijozlari bilan cheklaydi va natijada «to'liq baza»
   * deb atalgan, aslida yarim fayl chiqadi (scoping.ts). @Roles() ni olib
   * tashlamang: dekoratorsiz handler ADMIN-only bo'lib qoladi va faqat ogohlantirish
   * yoziladi (roles.guard.ts).
   */
  @Get('xlsx')
  @Roles('ADMIN', 'ACCOUNTANT')
  async xlsx(
    @Query() query: ExportQueryDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.service.buildWorkbook(query, user);

    // Fayl nomi kirillcha bo'ladi. Eski brauzerlar uchun ASCII zaxira nom, zamonaviylari
    // uchun RFC 5987 `filename*` — ikkalasi ham yuboriladi.
    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.set({
      // helmet() `nosniff` qo'yadi — MIME aniq bo'lmasa brauzer faylni jadval deb qabul qilmaydi
      'Content-Type': XLSX_MIME,
      'Content-Disposition':
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(buffer);
  }
}
