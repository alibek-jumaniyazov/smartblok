import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// LedgerService comes from the @Global() CommonModule.
@Module({ providers: [ReportsService], controllers: [ReportsController] })
export class ReportsModule {}
