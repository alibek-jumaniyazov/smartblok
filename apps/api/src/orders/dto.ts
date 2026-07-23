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
import { FactoryBucket, FactoryPayIntent, OrderStatus, TransportMode } from '@prisma/client';
import { PageQueryDto } from '../common/pagination';
import { IsRetiredField } from '../common/validators';

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

  /**
   * RETIRED 2026-07-23 — a pallet is an in-kind deposit, never a cost component: the
   * factory charges nothing for it and pays nothing back, so every OrderItem books
   * palletPrice = 0. The field is rejected rather than ignored, so no caller can send a
   * pallet price and believe it landed in the order's cost.
   */
  @IsRetiredField("Paddon buyurtmada PULSIZ — paddon narxi yuborilmaydi")
  palletPrice?: never;

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

  /** what the driver gets for this trip — always INSIDE the goods total, never on top */
  @IsOptional() @IsMoneyValue()
  transportCost?: number | string;

  /**
   * The owner's three buttons — how the dealer means to pay the factory:
   *   CASH    «zavodga naqd orqali to'lanadi»     → cost basis FACTORY_CASH
   *   BANK    «zavodga o'tkazma orqali to'lanadi» → cost basis FACTORY_BANK
   *   UNKNOWN «to'lov usuli aniq emas»            → both prices shown, may settle mixed
   * Omitted ⇒ UNKNOWN.
   */
  @IsOptional() @IsEnum(FactoryPayIntent)
  factoryPayIntent?: FactoryPayIntent;

  /** @deprecated pre-2026-07-21 two-way toggle; kept so older clients keep working */
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

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  /** «zavodga to'lov turi» — omit to keep whatever the order already carries */
  @IsOptional() @IsEnum(FactoryPayIntent)
  factoryPayIntent?: FactoryPayIntent;

  /** @deprecated pre-2026-07-21 two-way toggle */
  @IsOptional() @IsIn(['CASH', 'BANK'])
  intendedPaymentMethod?: 'CASH' | 'BANK';

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

// `SetStatusDto` olib tashlandi — bosqichma-bosqich status yo'q (2026-07-22).

/**
 * Bekor qilishda pul qanday yechilishi (egasi qoidasi, 2026-07-22 kechqurun):
 *
 *  • `REFUND` («Ha — mijozga qaytariladi», default) — mijoz BIZGA to'lagani unga NAQD
 *    qaytariladi (kassadan chiqim, kassa buyurtmadan oldingi holatga qaytadi), shofyorga
 *    o'z qo'li bilan bergani esa balansida KREDIT bo'lib qoladi — transportni diller o'z
 *    zimmasiga oladi. Ya'ni mijoz to'lagan har bir so'm qaytadi: bir qismi naqd, bir qismi
 *    kredit bo'lib. Zavodga to'langani kassaga qaytariladi.
 *  • `VOID_ALL` («Yo'q — hamma o'tkazmalar yo'qolsin») — shu buyurtma uchun qilingan HAMMA
 *    to'lov yo'q bo'ladi: mijozniki ham, shofyornikisi ham, kassadagisi ham, zavodnikisi ham.
 *    Mijoz balansi 0, kassa buyurtmadan oldingi holatda, zavod 0 — buyurtma umuman
 *    berilmagandek, to'lov umuman qilinmagandek.
 *
 * Ikkalasida ham kassa buyurtmadan OLDINGI holatiga qaytadi; farq — mijozda transport
 * krediti qoladimi (REFUND) yoki u ham yo'q bo'ladimi (VOID_ALL).
 */
export enum CancelMoneyMode {
  REFUND = 'REFUND',
  VOID_ALL = 'VOID_ALL',
}

export class CancelOrderDto {
  @IsString() @IsNotEmpty() @MaxLength(2000)
  reason!: string;

  /** Eski klientlar mode yubormaydi — ular uchun REFUND (mijoz oqlanadigan yumshoq yo'l). */
  @IsOptional() @IsEnum(CancelMoneyMode)
  mode?: CancelMoneyMode;
}

export class AddCommentDto {
  @IsString() @IsNotEmpty() @MaxLength(4000)
  text!: string;
}

export class OrderListQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(OrderStatus)
  status?: OrderStatus;

  /**
   * Orders-page tab filter. 'paid' ⇒ the client has fully settled the order; 'unpaid' ⇒ the
   * client still owes something (a partially-paid order counts as unpaid). Cancelled orders
   * are excluded from both. Omitted ⇒ «Barcha buyurtmalar».
   */
  @IsOptional() @IsIn(['paid', 'unpaid'])
  paid?: 'paid' | 'unpaid';

  @IsOptional() @IsUUID()
  clientId?: string;

  @IsOptional() @IsUUID()
  agentId?: string;

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

/**
 * «AVANSDAN YECHISH» — settle part of this order from money already standing at the
 * factory. The chosen channel decides the price basis for the slice it buys, which is
 * why the bucket (not a free-form priceKind) is the input.
 */
export class DrawFactoryAdvanceDto {
  @IsIn([FactoryBucket.ADVANCE_CASH, FactoryBucket.ADVANCE_BANK])
  bucket!: 'ADVANCE_CASH' | 'ADVANCE_BANK';

  /** omit ⇒ draw as much as this order still needs, capped by what the channel holds */
  @IsOptional() @IsMoneyValue()
  amount?: number | string;

  @IsOptional() @IsDateString()
  date?: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

/** Change the factory-payment intent after creation (owner: everything is editable). */
export class SetFactoryPayIntentDto {
  @IsEnum(FactoryPayIntent)
  factoryPayIntent!: FactoryPayIntent;
}
