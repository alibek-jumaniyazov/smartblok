import type { PalletReturnRow } from './types';

/** Explicit warehouse entries are not customer identities. «БРАК» is damaged
 * stock; the export label also supports signed recoveries and corrections. */
export function isWarehousePalletMovement(row: Pick<PalletReturnRow, 'clientRaw' | 'qty'>): boolean {
  const label = row.clientRaw.trim().toLocaleUpperCase('ru-RU');
  return label === 'ОМБОР ТУЗАТИШИ' || (label === 'БРАК' && row.qty !== null && row.qty < 0);
}
