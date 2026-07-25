import { Module } from '@nestjs/common';
import { PalletsModule } from '../pallets/pallets.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// LedgerService/AuditService come from the @Global() CommonModule.
// PalletsModule: the paddon block reads the ONE canonical pallet formula from
// PalletService instead of re-folding the ledger (same reason DebtsModule imports it).
// No cycle — PalletsModule imports nothing.
@Module({
  imports: [PalletsModule],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
