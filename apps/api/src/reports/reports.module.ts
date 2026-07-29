import { Module } from '@nestjs/common';
import { BonusModule } from '../bonus/bonus.module';
import { DebtsModule } from '../debts/debts.module';
import { FactoriesModule } from '../factories/factories.module';
import { PalletsModule } from '../pallets/pallets.module';
import { FactoryReportService } from './factory-report.service';
import { ReportsController } from './reports.controller';

/**
 * Tahlil hisobotlari.
 *
 * To'rtta modulni ATAYLAB import qiladi: hisobotdagi raqamlar saytdagi ekranlar bilan
 * bir xil bo'lishi shart, shuning uchun formulalar bu yerda qayta yozilmaydi —
 * FactoriesService (zavodga to'langan pul foldi), DebtsService (ochiq buyurtma qarzi),
 * PalletService (poddon), BonusService (hamyon + kuchdagi dastur) ning o'zi chaqiriladi.
 * LedgerService global CommonModule'dan keladi.
 */
@Module({
  imports: [FactoriesModule, DebtsModule, PalletsModule, BonusModule],
  controllers: [ReportsController],
  providers: [FactoryReportService],
  exports: [FactoryReportService],
})
export class ReportsModule {}
