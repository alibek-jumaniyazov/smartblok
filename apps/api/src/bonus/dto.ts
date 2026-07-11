import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { PageQueryDto } from '../common/pagination';

/**
 * Money arrives as a number or a numeric string; the service converts it with
 * assertPositiveMoney (common/money) — never parseFloat/Number for math.
 */
export function IsMoneyValue(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isMoneyValue',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value === 'number') return Number.isFinite(value) && value > 0;
          if (typeof value === 'string') return /^\d+(\.\d+)?$/.test(value.trim()) && Number(value) > 0;
          return false;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} musbat son bo'lishi kerak`;
        },
      },
    });
  };
}

export class BonusTxQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID()
  factoryId?: string;
}

export class BonusWithdrawDto {
  @IsUUID()
  factoryId!: string;

  @IsMoneyValue()
  amount!: number | string;

  @IsUUID()
  cashboxId!: string;

  @IsOptional() @IsDateString()
  date?: string;

  @IsOptional() @IsString()
  note?: string;
}

export class BonusOffsetDto {
  @IsUUID()
  factoryId!: string;

  @IsMoneyValue()
  amount!: number | string;

  @IsOptional() @IsDateString()
  date?: string;

  @IsOptional() @IsString()
  note?: string;
}

export class BonusReverseDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
