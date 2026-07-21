import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { CreateVehicleDto, UpdateVehicleDto, VehicleQueryDto } from './dto';

@Controller('vehicles')
export class VehiclesController {
  constructor(private service: VehiclesService) {}

  /** AGENT gets the order-form shape (no balances); ADMIN/ACCOUNTANT get balances too. */
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query() q: VehicleQueryDto) {
    return this.service.findAll(user, q);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post()
  create(@Body() dto: CreateVehicleDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVehicleDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user);
  }

  /** Soft-delete: deactivates the vehicle (active=false). */
  @Roles('ADMIN', 'ACCOUNTANT')
  @Delete(':id')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.service.deactivate(id, user);
  }
}
