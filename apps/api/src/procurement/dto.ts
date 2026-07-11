import {
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { PageQueryDto } from '../common/pagination';

/** Accepts a positive number or a positive numeric string (money input). */
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

export class MatrixQueryDto {
  @IsOptional()
  @IsUUID()
  regionId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;
}

export class RoutesQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @IsOptional()
  @IsUUID()
  regionId?: string;
}

/** Versioned insert (like prices) — route rows are never updated or deleted. */
export class CreateRouteDto {
  @IsUUID()
  factoryId!: string;

  @IsUUID()
  regionId!: string;

  @IsPositiveNumeric()
  costPerTruck!: number | string;

  /** defaults to the truckCapacityPallets app setting (fallback 19) when omitted */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(40)
  capacityPallets?: number;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}
