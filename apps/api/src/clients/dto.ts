import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

/**
 * Money arrives as a number or a numeric string (never floats server-side —
 * the service converts through Prisma.Decimal). `null` passes via @IsOptional.
 */
export function IsMoneyValue(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMoneyValue',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} raqam bo'lishi kerak`, ...options },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value === 'number') return Number.isFinite(value);
          if (typeof value === 'string') return /^-?\d+(\.\d+)?$/.test(value.trim());
          return false;
        },
      },
    });
  };
}

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  legalEntity?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsUUID()
  regionId?: string | null;

  /** ignored for AGENT users (forced to their own agent) */
  @IsOptional()
  @IsUUID()
  agentId?: string | null;

  /** null ⇒ unlimited; 0 ⇒ prepay only. ADMIN/ACCOUNTANT only — stripped for AGENT. */
  @IsOptional()
  @IsMoneyValue()
  creditLimit?: number | string | null;

  /** ADMIN/ACCOUNTANT only — stripped for AGENT. */
  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermDays?: number | null;
}

export class UpdateClientDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  legalEntity?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsUUID()
  regionId?: string | null;

  /** ADMIN/ACCOUNTANT only — stripped for AGENT. */
  @IsOptional()
  @IsUUID()
  agentId?: string | null;

  /** ADMIN/ACCOUNTANT only — stripped for AGENT. */
  @IsOptional()
  @IsMoneyValue()
  creditLimit?: number | string | null;

  /** ADMIN/ACCOUNTANT only — stripped for AGENT. */
  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermDays?: number | null;
}

export class CreateAliasDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class CreateClientPriceDto {
  @IsUUID()
  productId!: string;

  /** per-m³ price, stored at 6dp (back-solved lump-sum prices must survive) */
  @IsMoneyValue()
  pricePerM3!: number | string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}
