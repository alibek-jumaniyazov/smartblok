import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(private service: ProductsService) {}
  @Get() findAll(@Query() q: any) { return this.service.findAll(q); }
  @Roles('ADMIN', 'ACCOUNTANT') @Post() create(@Body() d: any) { return this.service.create(d); }
  @Roles('ADMIN', 'ACCOUNTANT') @Put(':id') update(@Param('id') id: string, @Body() d: any) { return this.service.update(id, d); }
  @Roles('ADMIN', 'ACCOUNTANT') @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
}
