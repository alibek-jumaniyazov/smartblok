import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DebtsModule } from '../debts/debts.module';
import { FactoriesModule } from '../factories/factories.module';
import { KassaModule } from '../kassa/kassa.module';
import { PalletsModule } from '../pallets/pallets.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatToolsService } from './tools';

/**
 * Saqlanadigan AI suhbat + uning MA'LUMOTGA ULANGAN tool'lari.
 *
 * Bu modul boshqa domen modullarini FAQAT o'qish uchun import qiladi va o'zi hech
 * kimga import qilinmaydi — shuning uchun aylanma bog'liqlik (circular dependency)
 * bo'lishi mumkin emas. PrismaService/LedgerService global CommonModule dan keladi.
 * Modelni .env dagi ANTHROPIC_MODEL boshqaradi.
 */
@Module({
  imports: [DashboardModule, KassaModule, DebtsModule, PalletsModule, FactoriesModule],
  controllers: [ChatController],
  providers: [ChatService, ChatToolsService],
  exports: [ChatService],
})
export class ChatModule {}
