import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'ACCOUNTANT', 'CASHIER')
@Controller('expenses')
export class ExpensesController {
  constructor(private service: ExpensesService) {}
  @Get() findAll() { return this.service.findAll(); }
  @Get('summary') summary() { return this.service.summary(); }
  @Get('categories') categories() { return this.service.categories(); }
  @Post() create(@Body() d: any) { return this.service.create(d); }
  @Post('categories') createCategory(@Body() d: any) { return this.service.createCategory(d); }
  @Delete('categories/:id') removeCategory(@Param('id') id: string) { return this.service.removeCategory(id); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
}
