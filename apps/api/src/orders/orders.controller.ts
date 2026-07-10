import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
@Controller('orders')
export class OrdersController {
  constructor(private service: OrdersService) {}
  @Get() findAll(@CurrentUser() user: any, @Query() q: any) { return this.service.findAll(user, q); }
  @Get(':id') findOne(@CurrentUser() user: any, @Param('id') id: string) { return this.service.findOne(id, user); }
  @Post() create(@CurrentUser() user: any, @Body() d: any) { return this.service.create(d, user); }
  @Put(':id') update(@CurrentUser() user: any, @Param('id') id: string, @Body() d: any) { return this.service.update(id, d, user); }
  @Patch(':id/status') setStatus(@CurrentUser() user: any, @Param('id') id: string, @Body('status') status: string) { return this.service.setStatus(id, status, user); }
  @Patch(':id/advance') advance(@CurrentUser() user: any, @Param('id') id: string) { return this.service.advance(id, user); }
  @Roles('ADMIN', 'ACCOUNTANT') @Delete(':id') remove(@CurrentUser() user: any, @Param('id') id: string) { return this.service.remove(id, user); }
}
