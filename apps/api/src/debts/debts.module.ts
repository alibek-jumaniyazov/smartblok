import { Module } from '@nestjs/common';
import { PalletsModule } from '../pallets/pallets.module';
import { DebtsService } from './debts.service';
import { DebtsController } from './debts.controller';

// PalletsModule: pallet COUNTS come from the one canonical formula (PalletService) —
// this board used to re-implement the client one and drifted from the pallets page.
@Module({
  imports: [PalletsModule],
  providers: [DebtsService],
  controllers: [DebtsController],
  exports: [DebtsService],
})
export class DebtsModule {}
