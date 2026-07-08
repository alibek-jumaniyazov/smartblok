import { Module } from '@nestjs/common';
import { FactoryPaymentsService } from './factory-payments.service';
import { FactoryPaymentsController } from './factory-payments.controller';
@Module({ providers: [FactoryPaymentsService], controllers: [FactoryPaymentsController] })
export class FactoryPaymentsModule {}
