import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RequestUser } from '../common/scoping';
import { DashboardService } from './dashboard.service';
import { AgentsRankingQueryDto, SummaryQueryDto, TrendsQueryDto } from './dto';

// Guards are global (JwtAuthGuard + RolesGuard via APP_GUARD).
// ADMIN/ACCOUNTANT see company-wide numbers; AGENT gets the same routes scoped
// to their own agentId inside the service; CASHIER only gets /dashboard/kassa.
@Controller('dashboard')
export class DashboardController {
  constructor(private service: DashboardService) {}

  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  @Get('summary')
  summary(@Query() q: SummaryQueryDto, @CurrentUser() user: RequestUser) {
    return this.service.summary(user, q);
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  @Get('trends')
  trends(@Query() q: TrendsQueryDto, @CurrentUser() user: RequestUser) {
    return this.service.trends({ days: q.days, from: q.from, to: q.to }, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('agents-ranking')
  agentsRanking(@Query() q: AgentsRankingQueryDto) {
    return this.service.agentsRanking(q.month);
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'CASHIER')
  @Get('kassa')
  kassa() {
    return this.service.kassa();
  }
}
