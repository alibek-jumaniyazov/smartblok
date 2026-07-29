import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RequestUser } from '../common/scoping';
import { FactoryReportOrdersQueryDto, FactoryReportQueryDto } from './dto';
import { FactoryReportService } from './factory-report.service';
import { buildFactoryReportWorkbook } from './factory-report.xlsx';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Egasining tahlil ekranlari.
 *
 * ROL: faqat ADMIN va BUXGALTER — hisobot zavod TANNARXINI ochadi, bu esa AGENT
 * ko'rmaydigan raqam (factories.detail ham aynan shu ikki rolda). @Roles() ni olib
 * tashlamang: dekoratorsiz handler ADMIN-only bo'lib qoladi va faqat ogohlantirish
 * yoziladi (roles.guard.ts).
 */
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: FactoryReportService) {}

  /** «Zavod bo'yicha hisobot» — bitta zavod, bitta davr, hamma kesim. */
  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('factory')
  factory(@Query() q: FactoryReportQueryDto) {
    return this.service.factoryReport(q);
  }

  /** Hisobot ostidagi buyurtmalar ro'yxati (server sahifalash + butun filtr yakunlari). */
  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('factory/orders')
  factoryOrders(@Query() q: FactoryReportOrdersQueryDto) {
    return this.service.factoryReportOrders(q);
  }

  /** O'sha hisobotning Excel varianti — raqamlar aynan yuqoridagi servisdan. */
  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('factory/xlsx')
  async factoryXlsx(
    @Query() q: FactoryReportQueryDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const data = await this.service.factoryReportBundle(q);
    const { buffer, filename } = await buildFactoryReportWorkbook(data, {
      name: user.name,
      role: user.role,
    });

    // Fayl nomi kirillcha. Eski brauzerlar uchun ASCII zaxira nom, zamonaviylari uchun
    // RFC 5987 `filename*` — ikkalasi ham yuboriladi. `Content-Type` aniq bo'lmasa
    // helmet() ning `nosniff` i tufayli brauzer faylni jadval deb qabul qilmaydi.
    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.set({
      'Content-Type': XLSX_MIME,
      'Content-Disposition':
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(buffer);
  }
}
