import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'ACCOUNTANT')
@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}
  @Get('client/:id/statement') statement(@Param('id', ParseIntPipe) id: number) { return this.service.clientStatement(id); }
  @Get('svod') svod() { return this.service.svod(); }
}
