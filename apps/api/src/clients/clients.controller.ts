import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('clients')
export class ClientsController {
  constructor(private service: ClientsService) {}
  @Get() findAll(@CurrentUser() user: any) { return this.service.findAll(user); }
  @Get(':id') findOne(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT') @Post() create(@Body() d: any) { return this.service.create(d); }
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT') @Put(':id') update(@Param('id', ParseIntPipe) id: number, @Body() d: any) { return this.service.update(id, d); }
  @Roles('ADMIN') @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}
