import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  buildMessage,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateBy,
  ValidateNested,
  ValidationOptions,
} from 'class-validator';
import { OrderStatus, TransportMode } from '@prisma/client';
import { PageQueryDto } from '../common/pagination';

/**
 * Money/volume inputs arrive as a number or a numeric string (Decimal fields
 * serialize to strings). The DTO only shape-checks; sign/positivity and all
 * arithmetic happen in the service via Prisma.Decimal (common/money.ts).
 */
const NUMERIC_RE = /^\d+(\.\d+)?$/;
export function IsMoneyValue(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isMoneyValue',
      validator: {
        validate: (v: unknown) =>
          (typeof v === 'number' && Number.isFinite(v) && v >= 0) ||
          (typeof v === 'string' && NUMERIC_RE.test(v.trim())),
        defaultMessage: buildMessage(
          (eachPrefix) => eachPrefix + "$property musbat raqam yoki raqamli matn bo'lishi kerak",
          options,
        ),
      },
    },
    options,
  );
}

export class OrderItemDto {
  @IsUUID()
  productId!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  palletCount?: number;

  @IsOptional() @IsMoneyValue()
  quantityM3?: number | string;

  @IsOptional() @IsMoneyValue()
  salePricePerM3?: number | string;

  @IsOptional() @IsMoneyValue()
  saleLumpSum?: number | string;

  @IsOptional() @IsMoneyValue()
  palletPrice?: number | string;

  @IsOptional() @IsBoolean()
  pricePending?: boolean;
}

export class CreateOrderDto {
  @IsUUID()
  clientId!: string;

  @IsDateString()
  date!: string;

  @IsOptional() @IsUUID()
  vehicleId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  driverName?: string;

  @IsOptional() @IsEnum(TransportMode)
  transportMode?: TransportMode;

  @IsOptional() @IsMoneyValue()
  transportCost?: number | string;

  @IsOptional() @IsMoneyValue()
  transportCharge?: number | string;

  /** maps to items' provisionalPriceKind: CASH → FACTORY_CASH, BANK (default) → FACTORY_BANK */
  @IsOptional() @IsIn(['CASH', 'BANK'])
  intendedPaymentMethod?: 'CASH' | 'BANK';

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}

/** ADMIN/ACCOUNTANT only, status NEW/CONFIRMED only. Items are a FULL replace. */
export class UpdateOrderDto {
  @IsOptional() @IsDateString()
  date?: string;

  @IsOptional() @IsUUID()
  vehicleId?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  driverName?: string;

  @IsOptional() @IsEnum(TransportMode)
  transportMode?: TransportMode;

  @IsOptional() @IsMoneyValue()
  transportCost?: number | string;

  @IsOptional() @IsMoneyValue()
  transportCharge?: number | string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}

export class SetStatusDto {
  @IsEnum(OrderStatus)
  to!: OrderStatus;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class CancelOrderDto {
  @IsString() @IsNotEmpty() @MaxLength(2000)
  reason!: string;
}

export class AddCommentDto {
  @IsString() @IsNotEmpty() @MaxLength(4000)
  text!: string;
}

export class OrderListQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional() @IsUUID()
  clientId?: string;

  @IsOptional() @IsUUID()
  factoryId?: string;

  @IsOptional() @IsDateString()
  dateFrom?: string;

  @IsOptional() @IsDateString()
  dateTo?: string;
}
