import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

/** A signed money value: a number or numeric string, sign allowed (unlike IsMoneyValue's
 *  positive-only cousins). Zero passes validation here and is rejected in the service. */
function IsSignedMoney(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isSignedMoney',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} raqam bo'lishi kerak`, ...options },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value === 'number') return Number.isFinite(value);
          if (typeof value === 'string') return /^\s*-?\d+(\.\d+)?\s*$/.test(value);
          return false;
        },
      },
    });
  };
}

/**
 * «Balansni nazorat qilish» — an owner off-book correction of ONE party's balance. Posts a
 * single OFFBOOK_ADJUSTMENT ledger row (no kassa row): it moves that party's own balance +
 * statement, but is excluded from the dashboard company rollups and the transactions journal.
 */
export class AdjustBalanceDto {
  /**
   * Signed delta applied to the party's ledger balance:
   *  • CLIENT  — >0 ⇒ the client owes us more; <0 ⇒ we owe the client (credit).
   *  • FACTORY — posted to the PAYABLE bucket: >0 ⇒ our debt to the factory shrinks (payable
   *    rises toward 0); <0 ⇒ our debt grows.
   * Must be nonzero — the service rejects 0.
   */
  @IsSignedMoney()
  amount!: number | string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /** business date for the statement row; defaults to today. */
  @IsOptional()
  @IsDateString()
  date?: string;
}
