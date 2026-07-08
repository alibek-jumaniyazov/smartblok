import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ProcurementService } from './procurement.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('procurement')
export class ProcurementController {
  constructor(private service: ProcurementService) {}

  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  @Get('matrix')
  matrix(@Query('regionId') regionId: string) { return this.service.matrix(regionId); }

  @Roles('ADMIN', 'ACCOUNTANT') @Get('prices') listPrices() { return this.service.listPrices(); }
  @Roles('ADMIN', 'ACCOUNTANT') @Post('prices') createPrice(@Body() d: any) { return this.service.createPrice(d); }
  @Roles('ADMIN', 'ACCOUNTANT') @Put('prices/:id') updatePrice(@Param('id') id: string, @Body() d: any) { return this.service.updatePrice(id, d); }
  @Roles('ADMIN', 'ACCOUNTANT') @Delete('prices/:id') removePrice(@Param('id') id: string) { return this.service.removePrice(id); }

  @Roles('ADMIN', 'ACCOUNTANT') @Get('routes') listRoutes() { return this.service.listRoutes(); }
  @Roles('ADMIN', 'ACCOUNTANT') @Post('routes') createRoute(@Body() d: any) { return this.service.createRoute(d); }
  @Roles('ADMIN', 'ACCOUNTANT') @Put('routes/:id') updateRoute(@Param('id') id: string, @Body() d: any) { return this.service.updateRoute(id, d); }
  @Roles('ADMIN', 'ACCOUNTANT') @Delete('routes/:id') removeRoute(@Param('id') id: string) { return this.service.removeRoute(id); }
}
