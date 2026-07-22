import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { FactoriesService } from './factories.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { PageQueryDto } from '../common/pagination';
import { AdjustBalanceDto } from '../common/adjust-balance.dto';
import { CreateFactoryDto, SetBonusProgramDto, UpdateFactoryDto } from './dto';

@Controller('factories')
export class FactoriesController {
  constructor(private service: FactoriesService) {}

  /** Role-shaped: AGENT gets only { id, name, active }; ADMIN/ACCOUNTANT get financials. */
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query() q: PageQueryDto) {
    return this.service.findAll(user, q);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get(':id/bonus-program')
  getBonusProgram(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getBonusProgram(id);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post(':id/bonus-program')
  setBonusProgram(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetBonusProgramDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.setBonusProgram(id, dto, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post()
  create(@Body() dto: CreateFactoryDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFactoryDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user);
  }

  /** Soft-delete: deactivates the factory (active=false), never hard-deletes. */
  @Roles('ADMIN', 'ACCOUNTANT')
  @Delete(':id')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.service.deactivate(id, user);
  }

  /** «Balansni nazorat qilish» — off-book manual balance correction (ADMIN only). */
  @Roles('ADMIN')
  @Post(':id/adjust-balance')
  adjustBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustBalanceDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.adjustBalance(id, dto, user);
  }
}
