import {
  IsDateString,
  IsIn,
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

export class ExpensesQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID()
  categoryId?: string;

  @IsOptional() @IsUUID()
  cashboxId?: string;

  @IsOptional() @IsDateString()
  dateFrom?: string;

  @IsOptional() @IsDateString()
  dateTo?: string;

  /** voided rows are excluded unless includeVoided=true */
  @IsOptional() @IsIn(['true', 'false'])
  includeVoided?: string;
}

export class CreateExpenseDto {
  @IsDateString()
  date!: string;

  @IsMoneyValue()
  amount!: number | string;

  @IsOptional() @IsUUID()
  categoryId?: string;

  /** required — every expense leaves a kassa */
  @IsUUID()
  cashboxId!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class VoidExpenseDto {
  @IsString() @IsNotEmpty() @MaxLength(1000)
  reason!: string;
}

export class ExpenseCategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string;
}
