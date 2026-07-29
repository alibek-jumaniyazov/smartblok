import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PalletsModule } from '../pallets/pallets.module';
import { BonusModule } from '../bonus/bonus.module';
import { PaymentsModule } from '../payments/payments.module';
import { DebtsModule } from '../debts/debts.module';

@Module({
  // PaymentsModule does not import OrdersModule, so this is a plain one-way dependency:
  // «avansdan yechish» reuses the allocation + cost engine instead of forking it.
  imports: [PalletsModule, BonusModule, PaymentsModule, DebtsModule],
  providers: [OrdersService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
