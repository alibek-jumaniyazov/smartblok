import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { PageQueryDto } from '../common/pagination';
import { IsRetiredField } from '../common/validators';

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

export class PalletTxQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID()
  clientId?: string;

  @IsOptional() @IsUUID()
  factoryId?: string;
}

export class ClientReturnDto {
  @IsUUID()
  clientId!: string;

  @Type(() => Number) @IsInt() @IsPositive()
  qty!: number;

  @IsDateString()
  date!: string;

  @IsOptional() @IsUUID()
  orderId?: string;

  @IsOptional() @IsString()
  note?: string;
}

export class FactoryReturnDto {
  @IsUUID()
  factoryId!: string;

  @Type(() => Number) @IsInt() @IsPositive()
  qty!: number;

  @IsDateString()
  date!: string;

  /**
   * RETIRED 2026-07-23 — a pallet returned to the factory is worth NO money
   * («zavod u paddonlar uchun pul bermaydi»): the dealer owes the factory a COUNT and
   * handing the pallets back discharges that count, nothing financial. Sending a price
   * here is now a hard 400 rather than a silent no-op, so no caller can end up believing
   * a factory return moved money.
   */
  @IsRetiredField("Paddon zavodga faqat SONI bilan qaytariladi — narx yuborilmaydi")
  unitPrice?: never;

  @IsOptional() @IsString()
  note?: string;
}

export class ChargeLostDto {
  @IsUUID()
  clientId!: string;

  @Type(() => Number) @IsInt() @IsPositive()
  qty!: number;

  @IsDateString()
  date!: string;

  /** UZS per pallet; defaults to 130 000 when omitted */
  @IsOptional() @IsMoneyValue()
  unitPrice?: number | string;

  @IsOptional() @IsString()
  note?: string;
}
