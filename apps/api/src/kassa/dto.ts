import { CashboxType, CashDirection, CashSource, Currency } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { PageQueryDto } from '../common/pagination';

/** Positive number, or a positive numeric string. Final Decimal conversion happens in the service via assertPositiveMoney. */
const MONEY_STRING = /^(?=.*[1-9])\d+(\.\d+)?$/;

export function IsMoneyValue(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMoneyValue',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} musbat son bo'lishi kerak`,
        ...options,
      },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value === 'number') return Number.isFinite(value) && value > 0;
          if (typeof value === 'string') return MONEY_STRING.test(value.trim());
          return false;
        },
      },
    });
  };
}

export class TransactionsQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID()
  cashboxId?: string;

  /** split the journal by cashbox family — 'cash' (non-BANK) or 'bank' (BANK). */
  @IsOptional() @IsIn(['cash', 'bank'])
  scope?: 'cash' | 'bank';

  @IsOptional() @IsEnum(CashDirection)
  direction?: CashDirection;

  @IsOptional() @IsEnum(CashSource)
  source?: CashSource;

  @IsOptional() @IsDateString()
  dateFrom?: string;

  @IsOptional() @IsDateString()
  dateTo?: string;
}

export class ManualCashDto {
  @IsUUID()
  cashboxId!: string;

  /** STRICT: anything other than IN/OUT is rejected (v2 silently defaulted to IN, inverting money). */
  @IsEnum(CashDirection, { message: "direction faqat IN yoki OUT bo'lishi mumkin" })
  direction!: CashDirection;

  @IsMoneyValue()
  amount!: number | string;

  @IsOptional() @IsDateString()
  date?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class ReverseCashDto {
  @IsString() @IsNotEmpty() @MaxLength(1000)
  reason!: string;
}

/** Move money between two cashboxes/bank accounts (same currency). Source must not go below zero. */
export class TransferCashDto {
  @IsUUID()
  fromCashboxId!: string;

  @IsUUID()
  toCashboxId!: string;

  @IsMoneyValue()
  amount!: number | string;

  @IsOptional() @IsDateString()
  date?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class KassaSummaryQueryDto {
  @IsOptional() @IsDateString()
  dateFrom?: string;

  @IsOptional() @IsDateString()
  dateTo?: string;
}

export class CreateCashboxDto {
  @IsString() @IsNotEmpty() @Matches(/\S/, { message: "nomi bo'sh bo'lishi mumkin emas" }) @MaxLength(120)
  name!: string;

  @IsEnum(CashboxType)
  type!: CashboxType;

  @IsOptional() @IsEnum(Currency)
  currency?: Currency;
}

export class UpdateCashboxDto {
  @IsOptional() @IsString() @IsNotEmpty() @Matches(/\S/, { message: "nomi bo'sh bo'lishi mumkin emas" }) @MaxLength(120)
  name?: string;

  @IsOptional() @IsBoolean()
  active?: boolean;
}
