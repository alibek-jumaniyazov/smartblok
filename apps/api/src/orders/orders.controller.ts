import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import {
  AddCommentDto,
  AdminOrderPatchDto,
  ApplyActualLoadingDto,
  CancelOrderDto,
  CreateOrderDto,
  DrawFactoryAdvanceDto,
  OrderListQueryDto,
  PriceItemDto,
  SetFactoryPayIntentDto,
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

  // `GET /orders/board` va `PATCH /orders/:id/status` OLIB TASHLANDI (2026-07-22, egasi
  // qoidasi): buyurtma yaratilgan payti YAKUNLANADI, bosqichma-bosqich status yo'q. Route
  // ochiq qolsa ADMIN yakunlangan buyurtmani DELIVERED ga qaytarib, zavod tannarxi va
  // transport qarzini ledger'dan yechib tashlashi mumkin edi — «yaratilganda yakuniy»
  // invariantini buzadigan yagona tirik yo'l shu edi. Miqdorni tuzatish `PUT /orders/:id`
  // orqali (u supply+bonus ni to'liq reverse+repost qiladi).
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

  // Super-admin metadata patch — ANY status, moliyaga tegmaydi (moshina/haydovchi/izoh)
  @Roles('ADMIN')
  @Patch(':id/admin')
  adminPatch(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: AdminOrderPatchDto) {
    return this.service.adminPatch(id, dto, user);
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

  // Super-admin sotuv narxini tuzatish — ANY status; sale-delta CLIENT ledger'ga yoziladi
  @Roles('ADMIN')
  @Patch(':id/items/:itemId/admin-price')
  adminRepriceItem(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: PriceItemDto,
  ) {
    return this.service.adminRepriceItem(id, itemId, dto, user);
  }

  // Haqiqiy yuk (zavoddan chiqqach) — LOADING..DELIVERED; balanslar actual m³ ga moslashadi
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post(':id/actual-loading')
  applyActualLoading(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ApplyActualLoadingDto,
  ) {
    return this.service.applyActualLoading(id, dto, user);
  }

  /**
   * «AVANSDAN YECHISH» — settle part of this order from money standing at the factory.
   * The chosen channel (naqd / o'tkazma advance) fixes that slice's price basis.
   */
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post(':id/factory-advance-draw')
  drawFactoryAdvance(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DrawFactoryAdvanceDto,
  ) {
    return this.service.drawFactoryAdvance(id, dto, user);
  }

  /** Change «zavodga to'lov turi» after creation (naqd / o'tkazma / aniq emas). */
  @Roles('ADMIN', 'ACCOUNTANT')
  @Patch(':id/factory-pay-intent')
  setFactoryPayIntent(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetFactoryPayIntentDto,
  ) {
    return this.service.setFactoryPayIntent(id, dto, user);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Delete(':id')
  cancel(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.service.cancel(id, dto, user);
  }
}
