import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { KassaModule } from '../kassa/kassa.module';
import { PalletsModule } from '../pallets/pallets.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

/**
 * To'liq Excel eksporti.
 *
 * Uchta modulni ATAYLAB import qiladi: eksportdagi raqamlar saytdagi ekranlar bilan
 * bir xil bo'lishi shart, shuning uchun formulalar bu yerda qayta yozilmaydi —
 * DashboardService (KPI), PalletService (paddon) va KassaService (kassa qoldiqlari)
 * ning o'zi chaqiriladi. LedgerService, SettingsService va AuditService global
 * CommonModule'dan keladi.
 */
@Module({
  imports: [DashboardModule, KassaModule, PalletsModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
