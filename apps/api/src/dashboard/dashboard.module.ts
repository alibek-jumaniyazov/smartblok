import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// LedgerService/AuditService come from the @Global() CommonModule.
@Module({ providers: [DashboardService], controllers: [DashboardController] })
export class DashboardModule {}
