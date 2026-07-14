import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
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

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string | null;

  /** display ordering only */
  @IsOptional()
  @IsInt()
  sortNo?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /**
   * Max Σ of his clients' debt. null ⇒ AppSetting default; 0 ⇒ new orders blocked.
   * ADMIN only — stripped for ACCOUNTANT.
   */
  @IsOptional()
  @IsMoneyValue()
  debtLimit?: number | string | null;

  /**
   * Optional login: when username+password are both supplied, an AGENT-role User is
   * auto-created in the same transaction and linked to this agent (so the agent can
   * log in and appears on the Users page). Omit both to create an agent without a login.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(100)
  password?: string;
}

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsInt()
  sortNo?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** ADMIN only — stripped for ACCOUNTANT. */
  @IsOptional()
  @IsMoneyValue()
  debtLimit?: number | string | null;
}
