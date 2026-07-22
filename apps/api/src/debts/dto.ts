import { LedgerAccount } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PageQueryDto } from '../common/pagination';

export class DebtClientsQueryDto extends PageQueryDto {
  /** collection-forecast window in days (dueDate within [now, now+days]); default 7 */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365)
  days?: number = 7;

  /**
   * Which side to list: 'avans' = clients in credit (prepaid, our liability);
   * default 'debt' = clients who owe us. The debts board is for collecting debt,
   * so only debtors show unless 'avans' is explicitly requested.
   *
   * 'debt' also covers IN-KIND debt (R4): a money-settled client still holding our
   * pallets is a debtor and is listed with `palletOnly: true`. 'avans' stays money-only.
   */
  @IsOptional() @IsIn(['debt', 'avans'])
  dir?: 'debt' | 'avans';
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
