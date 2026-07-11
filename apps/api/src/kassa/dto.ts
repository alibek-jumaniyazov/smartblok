import { CashDirection, CashSource } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
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

export class KassaSummaryQueryDto {
  @IsOptional() @IsDateString()
  dateFrom?: string;

  @IsOptional() @IsDateString()
  dateTo?: string;
}
