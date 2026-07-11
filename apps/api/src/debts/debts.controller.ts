import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { DebtsService } from './debts.service';
import { DebtClientsQueryDto, StatementQueryDto } from './dto';

// Guards are global (JwtAuthGuard + default-deny RolesGuard); every route carries explicit @Roles.
@Controller('debts')
export class DebtsController {
  constructor(private service: DebtsService) {}

  @Get('summary')
  @Roles('ADMIN', 'ACCOUNTANT')
  summary() {
    return this.service.summary();
  }

  @Get('clients')
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  clients(@CurrentUser() user: RequestUser, @Query() q: DebtClientsQueryDto) {
    return this.service.clients(user, q);
  }

  @Get('statement')
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  statement(@CurrentUser() user: RequestUser, @Query() q: StatementQueryDto) {
    return this.service.statement(user, q);
  }
}
