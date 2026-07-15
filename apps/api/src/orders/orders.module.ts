import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PalletsModule } from '../pallets/pallets.module';
import { BonusModule } from '../bonus/bonus.module';

@Module({
  imports: [PalletsModule, BonusModule],
  providers: [OrdersService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
