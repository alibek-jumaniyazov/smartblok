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

/**
 * One-time / ad-hoc truck entered inline on an order. It is NOT saved to the fleet
 * (minted as a hidden oneTime=true Vehicle so the VEHICLE transport ledger keeps its
 * FK integrity) and never appears in the vehicle picker. Its transport is still
 * charged/paid like any other truck.
 */
export class OneTimeVehicleDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string;

  @IsOptional() @IsString() @MaxLength(50)
  plate?: string;

  @IsOptional() @IsString() @MaxLength(200)
  driver?: string;

  @IsOptional() @IsString() @MaxLength(50)
  phone?: string;
}

export class CreateOrderDto {
  @IsUUID()
  clientId!: string;

  @IsDateString()
  date!: string;

  @IsOptional() @IsUUID()
  vehicleId?: string;

  /** ad-hoc truck (mutually exclusive with vehicleId; ignored if vehicleId is set) */
  @IsOptional() @ValidateNested() @Type(() => OneTimeVehicleDto)
  oneTimeVehicle?: OneTimeVehicleDto;

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

/**
 * Super-admin metadata patch — ANY status. Faqat ledger'ga ta'sir qilmaydigan
 * maydonlar: moshina, haydovchi, izoh. Moliyaviy maydonlar (narx, hajm, summa)
 * bu yerda o'zgarmaydi — ular UpdateOrderDto (NEW/CONFIRMED) yoki cancel+qayta orqali.
 */
export class AdminOrderPatchDto {
  @IsOptional() @IsUUID()
  vehicleId?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  driverName?: string | null;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
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

export class PriceItemDto {
  @IsOptional()
  @IsMoneyValue()
  salePricePerM3?: string | number;

  @IsOptional()
  @IsMoneyValue()
  saleLumpSum?: string | number;
}

/**
 * Actual delivered VOLUME per item, entered at LOADING (NO price fields — security).
 * Pallet actuals are intentionally NOT accepted here: changing pallet counts would
 * desync the in-kind pallet ledger (RECEIVED_FROM_FACTORY / DELIVERED_TO_CLIENT) from
 * the money cost. Only the load volume (m³) rescales the order.
 */
export class ActualLoadingItemDto {
  @IsUUID()
  itemId!: string;

  @IsOptional() @IsMoneyValue()
  actualQuantityM3?: number | string;
}

export class ApplyActualLoadingDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ActualLoadingItemDto)
  items!: ActualLoadingItemDto[];
}
