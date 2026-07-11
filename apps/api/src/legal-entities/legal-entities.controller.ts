import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { LegalEntitiesService } from './legal-entities.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { CreateLegalEntityDto, UpdateLegalEntityDto } from './dto';

@Controller('legal-entities')
export class LegalEntitiesController {
  constructor(private service: LegalEntitiesService) {}

  /** CASHIER included — payment forms need payer/receiver entity pickers. */
  @Roles('ADMIN', 'ACCOUNTANT', 'CASHIER')
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post()
  create(@Body() dto: CreateLegalEntityDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLegalEntityDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.update(id, dto, user);
  }

  /** Soft-delete: deactivates the entity (active=false). */
  @Roles('ADMIN', 'ACCOUNTANT')
  @Delete(':id')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.service.deactivate(id, user);
  }
}
