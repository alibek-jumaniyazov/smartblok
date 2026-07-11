import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService],
  // exported so order/bonus flows can reuse the provisional→final cost engine
  exports: [PaymentsService],
})
export class PaymentsModule {}
