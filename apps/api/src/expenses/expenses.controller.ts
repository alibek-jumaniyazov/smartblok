import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto, ExpenseCategoryDto, ExpensesQueryDto, VoidExpenseDto } from './dto';

// Guards are global (JwtAuthGuard + default-deny RolesGuard); every route carries explicit @Roles.
@Controller('expenses')
export class ExpensesController {
  constructor(private service: ExpensesService) {}

  @Get()
  @Roles('ADMIN', 'ACCOUNTANT', 'CASHIER')
  findAll(@Query() q: ExpensesQueryDto) {
    return this.service.findAll(q);
  }

  @Get('categories')
  @Roles('ADMIN', 'ACCOUNTANT', 'CASHIER')
  categories() {
    return this.service.categories();
  }

  @Post()
  @Roles('ADMIN', 'ACCOUNTANT', 'CASHIER')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateExpenseDto) {
    return this.service.create(dto, user);
  }

  // No hard-delete endpoint: expenses are voided, the kassa row is reversed.
  @Post(':id/void')
  @Roles('ADMIN', 'ACCOUNTANT')
  void(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidExpenseDto,
  ) {
    return this.service.void(id, dto, user);
  }

  @Post('categories')
  @Roles('ADMIN', 'ACCOUNTANT')
  createCategory(@Body() dto: ExpenseCategoryDto) {
    return this.service.createCategory(dto);
  }

  @Put('categories/:id')
  @Roles('ADMIN', 'ACCOUNTANT')
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ExpenseCategoryDto) {
    return this.service.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @Roles('ADMIN', 'ACCOUNTANT')
  removeCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.removeCategory(id);
  }
}
