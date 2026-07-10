import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { DebtsModule } from '../debts/debts.module';

@Module({ imports: [DebtsModule], providers: [DashboardService], controllers: [DashboardController] })
export class DashboardModule {}
