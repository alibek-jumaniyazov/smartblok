import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
@Controller('clients')
export class ClientsController {
  constructor(private service: ClientsService) {}
  @Get() findAll(@CurrentUser() user: any) { return this.service.findAll(user); }
  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() create(@Body() d: any) { return this.service.create(d); }
  @Put(':id') update(@Param('id') id: string, @Body() d: any) { return this.service.update(id, d); }
  @Roles('ADMIN') @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
}
