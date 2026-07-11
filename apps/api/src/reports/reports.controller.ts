import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { OrdersRegisterQueryDto, SvodQueryDto } from './dto';
import { ReportsService } from './reports.service';

// Guards are global (JwtAuthGuard + RolesGuard via APP_GUARD).
@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('svod')
  svod(@Query() q: SvodQueryDto) {
    return this.service.svod(q.from, q.to);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('orders-register')
  ordersRegister(@Query() q: OrdersRegisterQueryDto) {
    return this.service.ordersRegister(q);
  }
}
