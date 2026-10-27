import type { PalletReturnRow } from './types';

/**
 * «Поддон қайтариш» varag'idagi OMBOR qatorlari — mijoz emas, omborning o'z harakati.
 *
 * Egasining daftari ularni shunday hisoblaydi: «Мижозлар қолдиғи» faqat справочникдаги
 * mijoz nomlarini yig'adi, «Поддон қайтариш заводга» K4 («Мижозлардан келган поддон
 * сони») esa BUTUN jadvalni (SUM(Table48)). Ya'ni bu qatorlar hech kimning qarzi emas,
 * lekin ombordagi poddon soniga IMZOSI bilan qo'shiladi:
 *   «БРАК»            — yaroqsiz poddon: −35 hisobdan chiqarildi, +39 omborga qaytdi
 *   «РАЗНИЦА»         — sanoq farqi (inventarizatsiya): +52 ortiqcha chiqdi
 *   «ОМБОР ТУЗАТИШИ»  — sayt eksportining o'z yorlig'i (musbat tuzatishlar)
 * Ilgari faqat manfiy «БРАК» tanilardi va «РАЗНИЦА»/musbat «БРАК» mijoz deb o'qilib,
 * importni MIJOZ_YOQ bilan to'sardi.
 */
export const WAREHOUSE_PALLET_LABELS = ['ОМБОР ТУЗАТИШИ', 'БРАК', 'РАЗНИЦА'] as const;

export function isWarehousePalletMovement(row: Pick<PalletReturnRow, 'clientRaw'>): boolean {
  const label = row.clientRaw.replace(/\s+/g, ' ').trim().toLocaleUpperCase('ru-RU');
  return (WAREHOUSE_PALLET_LABELS as readonly string[]).includes(label);
}
