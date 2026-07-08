import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { PalletsService } from './pallets.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pallets')
export class PalletsController {
  constructor(private service: PalletsService) {}
  @Get() findAll(@Query() q: any) { return this.service.findAll(q); }
  @Get('summary') summary() { return this.service.summary(); }
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT') @Post('return') createReturn(@Body() d: any) { return this.service.createReturn(d); }
  @Roles('ADMIN', 'ACCOUNTANT') @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}
