import { Module } from '@nestjs/common';
import { FactoriesService } from './factories.service';
import { FactoriesController } from './factories.controller';
import { PalletsModule } from '../pallets/pallets.module';
import { DebtsModule } from '../debts/debts.module';

// PalletsModule: the factory card reads pallet COUNTS from the one canonical formula
// instead of re-deriving them (the two used to disagree after an order cancel).
// `exports`: the AI assistant's read-only tools reuse this service so its answers quote
// the SAME payable/advance/paid-total figures the factory screens do.
@Module({
  imports: [PalletsModule, DebtsModule],
  providers: [FactoriesService],
  controllers: [FactoriesController],
  exports: [FactoriesService],
})
export class FactoriesModule {}
