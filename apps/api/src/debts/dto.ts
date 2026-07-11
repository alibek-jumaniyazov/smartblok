import { LedgerAccount } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PageQueryDto } from '../common/pagination';

export class DebtClientsQueryDto extends PageQueryDto {
  /** collection-forecast window in days (dueDate within [now, now+days]); default 7 */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365)
  days?: number = 7;
}

export class StatementQueryDto {
  @IsEnum(LedgerAccount)
  account!: LedgerAccount;

  @IsUUID()
  partyId!: string;

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;
}
