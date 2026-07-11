import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import {
  AddCommentDto,
  CancelOrderDto,
  CreateOrderDto,
  OrderListQueryDto,
  PriceItemDto,
  SetStatusDto,
  UpdateOrderDto,
} from './dto';

// Guards are global (JwtAuthGuard + default-deny RolesGuard) — every route
// carries an explicit @Roles. AGENT access is row-scoped inside the service.
@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query() q: OrderListQueryDto) {
    return this.service.findAll(user, q);
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  @Get(':id/timeline')
  timeline(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.timeline(id, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  @Get(':id/comments')
  listComments(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listComments(id, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  @Post(':id/comments')
  addComment(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: AddCommentDto) {
    return this.service.addComment(id, dto, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  @Get(':id')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.findOne(id, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateOrderDto) {
    return this.service.create(dto, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Put(':id')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateOrderDto) {
    return this.service.update(id, dto, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  @Patch(':id/status')
  setStatus(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.service.setStatus(id, dto, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Patch(':id/items/:itemId/price')
  priceItem(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: PriceItemDto,
  ) {
    return this.service.priceItem(id, itemId, dto, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Delete(':id')
  cancel(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.service.cancel(id, dto, user);
  }
}
