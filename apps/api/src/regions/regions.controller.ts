import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { RegionsService } from './regions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('regions')
export class RegionsController {
  constructor(private service: RegionsService) {}
  @Get() findAll() { return this.service.findAll(); }
  @Roles('ADMIN', 'ACCOUNTANT') @Post() create(@Body() d: any) { return this.service.create(d); }
  @Roles('ADMIN', 'ACCOUNTANT') @Put(':id') update(@Param('id', ParseIntPipe) id: number, @Body() d: any) { return this.service.update(id, d); }
  @Roles('ADMIN') @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}
