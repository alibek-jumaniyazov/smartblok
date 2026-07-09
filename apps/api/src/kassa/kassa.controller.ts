import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { KassaService } from './kassa.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'ACCOUNTANT', 'CASHIER')
@Controller('kassa')
export class KassaController {
  constructor(private service: KassaService) {}
  @Get('summary') summary() { return this.service.summary(); }
  @Get('cashboxes') cashboxes() { return this.service.cashboxes(); }
  @Post('cashboxes') createCashbox(@Body() d: any) { return this.service.createCashbox(d); }
  @Get('transactions') transactions(@Query('cashboxId') cashboxId?: string) { return this.service.transactions(cashboxId); }
  @Post('transactions') createTransaction(@Body() d: any) { return this.service.createTransaction(d); }
  @Delete('transactions/:id') removeTransaction(@Param('id') id: string) { return this.service.removeTransaction(id); }
}
