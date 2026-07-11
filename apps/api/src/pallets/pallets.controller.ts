import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { PalletService } from './pallets.service';
import { ChargeLostDto, ClientReturnDto, FactoryReturnDto, PalletTxQueryDto } from './dto';

@Controller('pallets')
export class PalletsController {
  constructor(private readonly pallets: PalletService) {}

  @Get('balances')
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  balances(@CurrentUser() user: RequestUser) {
    return this.pallets.balances(user);
  }

  @Get('transactions')
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  transactions(@Query() q: PalletTxQueryDto, @CurrentUser() user: RequestUser) {
    return this.pallets.transactions(q, user);
  }

  @Post('client-return')
  @Roles('ADMIN', 'ACCOUNTANT')
  clientReturn(@Body() dto: ClientReturnDto, @CurrentUser() user: RequestUser) {
    return this.pallets.recordClientReturn(dto, user.userId);
  }

  @Post('factory-return')
  @Roles('ADMIN', 'ACCOUNTANT')
  factoryReturn(@Body() dto: FactoryReturnDto, @CurrentUser() user: RequestUser) {
    return this.pallets.returnToFactory(dto, user.userId);
  }

  @Post('charge-lost')
  @Roles('ADMIN', 'ACCOUNTANT')
  chargeLost(@Body() dto: ChargeLostDto, @CurrentUser() user: RequestUser) {
    return this.pallets.chargeLost(dto, user.userId);
  }
}
