import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { KassaService } from './kassa.service';
import {
  CreateCashboxDto,
  KassaSummaryQueryDto,
  ManualCashDto,
  ReverseCashDto,
  SetCashboxBalanceDto,
  TransactionsQueryDto,
  TransferCashDto,
  UpdateCashboxDto,
} from './dto';

// Guards are global (JwtAuthGuard + default-deny RolesGuard); every route carries explicit @Roles.
@Controller('kassa')
export class KassaController {
  constructor(private service: KassaService) {}

  @Get('cashboxes')
  @Roles('ADMIN', 'ACCOUNTANT', 'CASHIER')
  cashboxes() {
    return this.service.cashboxes();
  }

  @Post('cashboxes')
  @Roles('ADMIN', 'ACCOUNTANT')
  createCashbox(@CurrentUser() user: RequestUser, @Body() dto: CreateCashboxDto) {
    return this.service.createCashbox(dto, user);
  }

  @Put('cashboxes/:id')
  @Roles('ADMIN', 'ACCOUNTANT')
  updateCashbox(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCashboxDto,
  ) {
    return this.service.updateCashbox(id, dto, user);
  }

  /**
   * «Kassa balansini tahrirlash» — set the box's balance to an exact figure. Writes one
   * off-book correction row: the balance moves, but it never counts as kirim/chiqim. ADMIN
   * only — deliberately narrower than the PUT above, which A/B both hold. Lives on this
   * controller so RealtimeInterceptor broadcasts the `kassa` change like every other write.
   */
  @Post('cashboxes/:id/balance')
  @Roles('ADMIN')
  setCashboxBalance(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCashboxBalanceDto,
  ) {
    return this.service.setBalance(id, dto, user);
  }

  @Delete('cashboxes/:id')
  @Roles('ADMIN', 'ACCOUNTANT')
  deleteCashbox(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteCashbox(id, user);
  }

  @Get('transactions')
  @Roles('ADMIN', 'ACCOUNTANT', 'CASHIER')
  transactions(@Query() q: TransactionsQueryDto) {
    return this.service.transactions(q);
  }

  @Post('manual')
  @Roles('ADMIN', 'ACCOUNTANT', 'CASHIER')
  manual(@CurrentUser() user: RequestUser, @Body() dto: ManualCashDto) {
    return this.service.manual(dto, user);
  }

  // Move money between two cashboxes / bank accounts (same currency). Source can't go < 0.
  @Post('transfer')
  @Roles('ADMIN', 'ACCOUNTANT', 'CASHIER')
  transfer(@CurrentUser() user: RequestUser, @Body() dto: TransferCashDto) {
    return this.service.transfer(dto, user);
  }

  // No hard-delete endpoint: corrections are compensating REVERSAL rows only.
  @Post('transactions/:id/reverse')
  @Roles('ADMIN', 'ACCOUNTANT')
  reverse(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseCashDto,
  ) {
    return this.service.reverse(id, dto, user);
  }

  @Get('summary')
  @Roles('ADMIN', 'ACCOUNTANT', 'CASHIER')
  summary(@Query() q: KassaSummaryQueryDto) {
    return this.service.summary(q);
  }
}
