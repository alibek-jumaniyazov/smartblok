import { Controller, Get, Header, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RequestUser } from '../common/scoping';
import { DashboardService } from './dashboard.service';
import { AgentsRankingQueryDto, SummaryQueryDto, TrendsQueryDto } from './dto';
import { DailyReportService } from './daily-report.service';
import { dailyReportWorkbook } from './daily-report.xlsx';
import { AuditService } from '../common/audit.service';

// Guards are global (JwtAuthGuard + RolesGuard via APP_GUARD).
// ADMIN/ACCOUNTANT see company-wide numbers; AGENT gets the same routes scoped
// to their own agentId inside the service; CASHIER only gets /dashboard/kassa.
@Controller('dashboard')
export class DashboardController {
  constructor(private service: DashboardService, private readonly dailyReport: DailyReportService,
    private readonly audit: AuditService) {}

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('daily-report')
  @Header('Cache-Control', 'no-store')
  daily(@Query() q: SummaryQueryDto) {
    return this.dailyReport.report(q);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('daily-report/xlsx')
  async dailyXlsx(@Query() q: SummaryQueryDto, @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const report = await this.dailyReport.report(q);
    const buffer = await dailyReportWorkbook(report);
    const filename = `Smartblok-kunlik-hisob-${report.from}-${report.to}.xlsx`;
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length), 'Cache-Control': 'no-store' });
    await this.audit.log({ userId: user.userId, action: 'EXPORT', entity: 'DashboardDailyReport',
      after: { from: report.from, to: report.to, days: report.days.length } });
    return new StreamableFile(buffer);
  }

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
