import { PriceKind } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { PageQueryDto } from '../common/pagination';

/** Accepts a positive number or a positive numeric string (money/volume input). */
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

export class ProductsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  factoryId?: string;
}

export class CreateProductDto {
  @IsUUID()
  factoryId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  size?: string;

  @IsPositiveNumeric()
  m3PerPallet!: number | string;

  @IsOptional()
  @IsInt()
  @Min(1)
  blocksPerPallet?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  size?: string;

  @IsOptional()
  @IsPositiveNumeric()
  m3PerPallet?: number | string;

  @IsOptional()
  @IsInt()
  @Min(1)
  blocksPerPallet?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Versioned insert into the three-kind price book — price rows are never updated. */
export class AddProductPriceDto {
  @IsEnum(PriceKind)
  kind!: PriceKind;

  @IsPositiveNumeric()
  pricePerM3!: number | string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}
