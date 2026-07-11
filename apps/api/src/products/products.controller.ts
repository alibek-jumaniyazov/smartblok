import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ProductsService } from './products.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { AddProductPriceDto, CreateProductDto, ProductsQueryDto, UpdateProductDto } from './dto';

@Controller('products')
export class ProductsController {
  constructor(private service: ProductsService) {}

  /** AGENT sees only DEALER_SALE prices — factory cost kinds are stripped server-side. */
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query() q: ProductsQueryDto) {
    return this.service.findAll(user, q);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get(':id/prices')
  getPrices(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getPrices(id);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post(':id/prices')
  addPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddProductPriceDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.addPrice(id, dto, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post()
  create(@Body() dto: CreateProductDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user);
  }

  /** Soft-delete: deactivates the product (active=false). */
  @Roles('ADMIN', 'ACCOUNTANT')
  @Delete(':id')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.service.deactivate(id, user);
  }
}
