import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { BonusService } from './bonus.service';
import { BonusOffsetDto, BonusTxQueryDto, BonusWithdrawDto } from './dto';

@Controller('bonus')
export class BonusController {
  constructor(private readonly bonus: BonusService) {}

  @Get('wallets')
  @Roles('ADMIN', 'ACCOUNTANT')
  wallets() {
    return this.bonus.wallets();
  }

  @Get('transactions')
  @Roles('ADMIN', 'ACCOUNTANT')
  transactions(@Query() q: BonusTxQueryDto) {
    return this.bonus.transactions(q);
  }

  @Post('withdraw')
  @Roles('ADMIN', 'ACCOUNTANT')
  withdraw(@Body() dto: BonusWithdrawDto, @CurrentUser() user: RequestUser) {
    return this.bonus.withdraw(dto, user.userId);
  }

  @Post('offset')
  @Roles('ADMIN', 'ACCOUNTANT')
  offset(@Body() dto: BonusOffsetDto, @CurrentUser() user: RequestUser) {
    return this.bonus.offsetDebt(dto, user.userId);
  }
}
