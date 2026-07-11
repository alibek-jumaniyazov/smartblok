import { BonusProgramKind } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

/** Accepts a positive number or a positive numeric string (money-style input). */
function IsPositiveNumeric(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isPositiveNumeric',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} musbat son bo'lishi kerak`, ...options },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value === 'number') return Number.isFinite(value) && value > 0;
          if (typeof value === 'string') {
            return /^\s*\d+(\.\d+)?\s*$/.test(value) && !/^\s*0+(\.0+)?\s*$/.test(value);
          }
          return false;
        },
      },
    });
  };
}

export class CreateFactoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateFactoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/**
 * Versioned insert — a new BonusProgram row per change, rows are never updated.
 * kind↔field pairing is re-validated in the service with Decimal math.
 */
export class SetBonusProgramDto {
  @IsEnum(BonusProgramKind)
  kind!: BonusProgramKind;

  @IsOptional()
  @IsPositiveNumeric()
  ratePerM3?: number | string;

  @IsOptional()
  @IsPositiveNumeric()
  percent?: number | string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}
