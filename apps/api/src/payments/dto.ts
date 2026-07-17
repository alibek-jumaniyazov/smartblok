import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  registerDecorator,
  ValidateNested,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { PaymentKind, PaymentMethod } from '@prisma/client';
import { PageQueryDto } from '../common/pagination';

/**
 * Money arrives as a number or a numeric string (Decimal-safe transport).
 * Positivity/rounding is enforced in the service via assertPositiveMoney —
 * this decorator only guarantees the shape.
 */
export function IsMoneyValue(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMoneyValue',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) =>
          (typeof value === 'number' && Number.isFinite(value)) ||
          (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())),
        defaultMessage: (args: ValidationArguments) =>
          `${args?.property} raqam yoki raqamli satr bo'lishi kerak`,
      },
    });
  };
}

export class AllocationItemDto {
  @IsUUID()
  orderId!: string;

  @IsMoneyValue()
  amount!: number | string;
}

export class CreatePaymentDto {
  @IsDateString()
  date!: string;

  @IsEnum(PaymentKind)
  kind!: PaymentKind;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  /**
   * UZS (so'm) part. For CLICK/TERMINAL/BANK it is the whole amount. For CASH it is
   * the so'm portion of a UZS / UZS+USD payment (may be 0/omitted for a pure-USD naqd).
   * The stored `amount` = this + usdAmount × rate.
   */
  @IsOptional()
  @IsMoneyValue()
  amount?: number | string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  /** naqd (CASH) only: dollar part of a USD / UZS+USD payment. */
  @IsOptional()
  @IsMoneyValue()
  usdAmount?: number | string;

  /** naqd (CASH) only: UZS per USD (required when usdAmount > 0). */
  @IsOptional()
  @IsMoneyValue()
  rate?: number | string;

  /**
   * Cashbox for the so'm part. naqd/click → a {CASH,CLICK} kassa box; terminal/bank →
   * a {TERMINAL,BANK} bank box. UZS currency. Required for every kind except
   * TRANSPORT_DIRECT (which must NOT have one) unless the naqd payment is pure-USD.
   */
  @IsOptional()
  @IsUUID()
  cashboxId?: string;

  /** naqd (CASH) only: the USD kassa box for the dollar part (required when usdAmount > 0). */
  @IsOptional()
  @IsUUID()
  usdCashboxId?: string;

  @IsOptional()
  @IsUUID()
  payerEntityId?: string;

  @IsOptional()
  @IsUUID()
  receiverEntityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  payerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  receiverName?: string;

  /** optional cash breakdown, e.g. {"100000": 5, "50000": 2} */
  @IsOptional()
  @IsObject()
  denominations?: Record<string, number>;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /** client-generated key; a repeat submit returns the original payment */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;

  /** inline order allocations (same semantics as POST /payments/:id/allocations) */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllocationItemDto)
  allocations?: AllocationItemDto[];
}

export class AllocateDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AllocationItemDto)
  allocations!: AllocationItemDto[];
}

export class VoidPaymentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  /**
   * Allow the reversal even if it would drive a cashbox balance negative (the cash
   * of an incoming payment was already spent). Off by default: the caller is warned
   * and must explicitly confirm.
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/**
 * Query-string booleans arrive as "true"/"false". With enableImplicitConversion
 * the transform's `value` is already Boolean("false") === true, so read the raw
 * source value from `obj` instead.
 */
const queryBool = (key: string) => ({ obj }: { obj: Record<string, unknown> }) => {
  const raw = obj?.[key];
  return raw === true || raw === 'true' || raw === '1';
};

export class PaymentsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(PaymentKind)
  kind?: PaymentKind;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Transform(queryBool('reconciled'))
  @IsBoolean()
  reconciled?: boolean;

  /** voided=true includes voided payments (excluded by default) */
  @IsOptional()
  @Transform(queryBool('voided'))
  @IsBoolean()
  voided?: boolean;
}
