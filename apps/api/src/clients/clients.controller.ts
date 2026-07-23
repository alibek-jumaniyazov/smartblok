import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { ClientsService } from './clients.service';
import { AdjustBalanceDto } from '../common/adjust-balance.dto';
import { ClientQueryDto, CreateAliasDto, CreateClientDto, CreateClientPriceDto, UpdateClientDto } from './dto';

@Controller('clients')
export class ClientsController {
  constructor(private service: ClientsService) {}

  @Get()
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  list(@CurrentUser() user: RequestUser, @Query() query: ClientQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: RequestUser) {
    return this.service.detail(id, user);
  }

  @Post()
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  create(@Body() dto: CreateClientDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateClientDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user);
  }

  /** «Balansni nazorat qilish» — off-book manual balance correction (ADMIN only). */
  @Post(':id/adjust-balance')
  @Roles('ADMIN')
  adjustBalance(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdjustBalanceDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.adjustBalance(id, dto, user);
  }

  @Post(':id/aliases')
  @Roles('ADMIN', 'ACCOUNTANT')
  addAlias(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CreateAliasDto) {
    return this.service.addAlias(id, dto);
  }

  @Delete(':id/aliases/:aliasId')
  @Roles('ADMIN', 'ACCOUNTANT')
  removeAlias(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('aliasId', new ParseUUIDPipe()) aliasId: string,
  ) {
    return this.service.removeAlias(id, aliasId);
  }

  @Post(':id/prices')
  @Roles('ADMIN', 'ACCOUNTANT')
  addPrice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateClientPriceDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.addPrice(id, dto, user);
  }
}
