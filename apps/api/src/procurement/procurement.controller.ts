import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ProcurementService } from './procurement.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { CreateRouteDto, MatrixQueryDto, RoutesQueryDto } from './dto';

@Controller('procurement')
export class ProcurementController {
  constructor(private service: ProcurementService) {}

  /** Landed-cost matrix exposes factory cost prices — never for AGENT. */
  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('matrix')
  matrix(@Query() q: MatrixQueryDto) {
    return this.service.matrix(q.regionId, q.productId);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('routes')
  listRoutes(@Query() q: RoutesQueryDto) {
    return this.service.listRoutes(q);
  }

  /** Versioned insert — routes are never updated or deleted (like price-book rows). */
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('routes')
  createRoute(@Body() dto: CreateRouteDto, @CurrentUser() user: RequestUser) {
    return this.service.createRoute(dto, user);
  }
}
