import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private service: PaymentsService) {}
  @Get() findAll(@CurrentUser() user: any, @Query() q: any) { return this.service.findAll(user, q); }
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT') @Post() create(@Body() d: any) { return this.service.create(d); }
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT') @Put(':id') update(@Param('id', ParseIntPipe) id: number, @Body() d: any) { return this.service.update(id, d); }
  @Roles('ADMIN', 'ACCOUNTANT') @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}
