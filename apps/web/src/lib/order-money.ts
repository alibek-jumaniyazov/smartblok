// Buyurtma puli — mijoz tomonidagi YAGONA formula (api common/transport.ts oynasi).
//
// Egasining qoidasi: transport HAR DOIM savdo summasi ICHIDA. «Shofyorga mijoz
// to'laydi» rejimida mijoz o'sha ulushni to'g'ridan-to'g'ri shofyorga beradi, ya'ni
// dillerga faqat qolgani qarz bo'ladi. Server ham aynan shu hisobni yuboradi
// (`clientOutstanding`), shuning uchun EKRAN qarzni o'zi hisoblamaydi — bu yerdagi
// funksiyalar faqat KO'RSATISH uchun (bo'linishni ochiq yozish, progress maxraji).

import { num } from './format';
import type { Money, TransportMode } from './types';

/** shu funksiyalar uchun kerak bo'lgan minimal buyurtma shakli. */
export interface OrderMoneyLike {
  transportMode: TransportMode;
  transportCost: Money | number | null | undefined;
  saleTotal: Money | number | null | undefined;
}

/**
 * Savdo summasining mijoz shofyorga o'z qo'li bilan beradigan ulushi — bu hech qachon
 * dillerning oladigan puli emas. Boshqa rejimlarda 0.
 * Xato kiritilgan (savdodan katta) transport qarzni manfiy qilib yubormasligi uchun
 * savdo summasi bilan cheklanadi.
 */
export function clientDirectTransport(o: OrderMoneyLike): number {
  if (o.transportMode !== 'CLIENT_PAYS_DRIVER') return 0;
  const sale = Math.max(0, num(o.saleTotal));
  const cost = Math.max(0, num(o.transportCost));
  return Math.min(cost, sale);
}

/** Mijoz dillerga qancha qarzdor bo'ladi: savdo summasi − shofyorga ketgan ulush. */
export function clientChargeable(o: OrderMoneyLike): number {
  return Math.max(0, num(o.saleTotal) - clientDirectTransport(o));
}
