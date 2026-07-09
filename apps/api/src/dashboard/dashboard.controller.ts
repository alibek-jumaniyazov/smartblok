import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private service: DashboardService) {}
  @Get('summary') summary() { return this.service.summary(); }
  @Get('sales-trend') trend() { return this.service.salesTrend(); }
  @Get('agent-performance') agents() { return this.service.agentPerformance(); }
  @Get('order-funnel') funnel() { return this.service.orderFunnel(); }
}
