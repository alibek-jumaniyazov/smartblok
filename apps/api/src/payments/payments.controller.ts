import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { PaymentsService } from './payments.service';
import { AllocateDto, CreatePaymentDto, PaymentsQueryDto, VoidPaymentDto } from './dto';

/**
 * Payments are append-only: create → (allocate) → void. There is intentionally
 * NO delete endpoint — financial history is immutable.
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** AGENT sees only CLIENT_IN payments of his own clients (service-scoped). */
  @Get()
  @Roles('ADMIN', 'ACCOUNTANT', 'CASHIER', 'AGENT')
  findAll(@CurrentUser() user: RequestUser, @Query() query: PaymentsQueryDto) {
    return this.payments.findAll(user, query);
  }

  @Get(':id')
  @Roles('ADMIN', 'ACCOUNTANT', 'CASHIER', 'AGENT')
  findOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.findOne(id, user);
  }

  /**
   * AGENT is admitted only for kind=CLIENT_IN on his own clients — the per-kind
   * split of the role matrix is enforced in the service (roles are static per route).
   */
  @Post()
  @Roles('ADMIN', 'ACCOUNTANT', 'CASHIER', 'AGENT')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreatePaymentDto) {
    return this.payments.create(dto, user);
  }

  /** CLIENT_IN (aging/settlement) and FACTORY_OUT (cost finalization) only. */
  @Post(':id/allocations')
  @Roles('ADMIN', 'ACCOUNTANT')
  allocate(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AllocateDto,
  ) {
    return this.payments.allocate(id, dto, user);
  }

  /** Undo ONE settlement without touching the rest of the payment. */
  @Post(':id/allocations/:allocationId/void')
  @Roles('ADMIN', 'ACCOUNTANT')
  voidAllocation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
    @Body() dto: VoidPaymentDto,
  ) {
    return this.payments.voidAllocation(id, allocationId, dto, user);
  }

  @Post(':id/void')
  @Roles('ADMIN', 'ACCOUNTANT')
  void(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidPaymentDto,
  ) {
    return this.payments.voidPayment(id, dto, user);
  }
}
