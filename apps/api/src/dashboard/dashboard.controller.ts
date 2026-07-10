import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

// Previously guarded only by JwtAuthGuard — any authenticated user could read company-wide
// financials and every agent's numbers. Now role-guarded, and the service scopes an AGENT to
// their own agentId (their sales/clients only) so nothing global leaks to a low-privilege login.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
@Controller('dashboard')
export class DashboardController {
  constructor(private service: DashboardService) {}
  @Get('summary') summary(@CurrentUser() user: any) { return this.service.summary(user); }
  @Get('sales-trend') salesTrend(@CurrentUser() user: any) { return this.service.salesTrend(user); }
  @Get('agent-performance') agentPerformance(@CurrentUser() user: any) { return this.service.agentPerformance(user); }
  @Get('order-funnel') orderFunnel(@CurrentUser() user: any) { return this.service.orderFunnel(user); }
}
