import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER')
@Controller('payments')
export class PaymentsController {
  constructor(private service: PaymentsService) {}
  @Get() findAll(@CurrentUser() user: any, @Query() q: any) { return this.service.findAll(user, q); }
  @Post() create(@CurrentUser() user: any, @Body() d: any) { return this.service.create(d, user); }
  @Roles('ADMIN', 'ACCOUNTANT') @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
}
