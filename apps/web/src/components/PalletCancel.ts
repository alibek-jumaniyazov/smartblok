// Paddon harakatini bekor qilish (storno) — IKKALA sirt uchun BITTA matn manbai.
//
// Bir xil qator ikki joyda ko'rinadi: /paddonlar jurnalida va mijoz kartochkasining
// «Paddonlar» defterida. Ilgari tasdiq oynasi matni ikkala faylda alohida yozilgan edi;
// bittasi o'zgarsa, foydalanuvchi bir xil tugmani bosib ikki xil oqibat o'qirdi. Endi
// sarlavha, oqibatlar ro'yxati va muvaffaqiyat xabari SHU YERDA — sahifalar faqat
// raqamlarni uzatadi.
//
// Server ikki turni bekor qiladi (POST /pallets/transactions/:id/reverse):
//   RETURN  → «Mijoz qaytardi» (RETURNED_BY_CLIENT) — PULSIZ, diller zaxirasidan yechadi;
//   CHARGE  → «Yo'qotilganini undirish» (CHARGED_LOST) — mijozning PUL qarzini kamaytiradi.
// Oqibatlar ro'yxati aynan shu farqni aytadi — «bekor qilinadi» degan quruq gap emas.
import type { ImpactFact } from './LedgerImpactPreview';
import type { TFn } from '../lib/i18n';
import { fmtNum, fmtUZS } from '../lib/format';

export type PalletCancelKind = 'RETURN' | 'CHARGE';

/** Bekor qilinadigan tur — boshqasi uchun `null` (server ham aynan shu ikkitasini qabul qiladi). */
export function palletCancelKind(type: string): PalletCancelKind | null {
  if (type === 'RETURNED_BY_CLIENT') return 'RETURN';
  if (type === 'CHARGED_LOST') return 'CHARGE';
  return null;
}

/**
 * Huquq kaliti tur bo'yicha AJRALADI: qaytarishni agent ham bekor qiladi (u yozgan),
 * undirish esa pul amali ⇒ faqat A·B. Server ham aynan shu chegarani qo'yadi (AGENT
 * undirish qatorida 403 oladi), demak tugmani ko'rsatib qo'yish «bosdim — xato chiqdi»
 * degan holatni yasagan bo'lardi.
 */
export function palletCancelAllowed(
  kind: PalletCancelKind,
  perms: { canReverseReturn: boolean; canReverseCharge: boolean },
): boolean {
  return kind === 'RETURN' ? perms.canReverseReturn : perms.canReverseCharge;
}

export const palletCancelTitle = (kind: PalletCancelKind): string =>
  kind === 'RETURN' ? 'Qaytarishni bekor qilish' : 'Undirishni bekor qilish';

export const palletCancelPlaceholder = (kind: PalletCancelKind): string =>
  kind === 'RETURN'
    ? 'Nega bekor qilinmoqda? (masalan: paddon boshqa mijozdan olingan)'
    : "Nega bekor qilinmoqda? (masalan: paddon topildi / xato mijozdan undirilgan)";

/** Jadvaldagi «bekor qilingan» yorlig'i — tur bo'yicha, chunki fakt ham har xil. */
export const palletCancelledLabel = (kind: PalletCancelKind): string =>
  kind === 'RETURN' ? 'Bekor qilingan' : 'Undirish bekor qilingan';

/**
 * Tasdiqdan OLDIN ko'rsatiladigan oqibatlar. `amount` — undirilgan summa (qator narxi ×
 * soni); u serverdan kelgan `unitPrice` dan hisoblanadi, sozlamadagi BUGUNGI narxdan emas:
 * narx o'zgargan bo'lsa, oyna qaytariladigan summani yolg'on aytardi.
 */
export function palletCancelFacts(args: {
  kind: PalletCancelKind;
  t: TFn;
  clientName: string;
  qty: number;
  /** faqat CHARGE uchun — undirilgan jami summa (so'm); noma'lum bo'lsa null */
  amount?: number | null;
}): ImpactFact[] {
  const { kind, t, clientName, qty } = args;
  const n = fmtNum(qty);
  const keepsHistory: ImpactFact = {
    text: t("Qator o'chirilmaydi: asl yozuv ham, uni bekor qilgan storno ham defterda qoladi"),
    tone: 'neutral',
  };

  if (kind === 'RETURN') {
    return [
      {
        text: t('«{client}» hisobiga {n} dona paddon qaytadi — qarzi shunga oshadi', {
          client: clientName,
          n,
        }),
        tone: 'warning',
      },
      {
        text: t("Diller qo'lidagi bo'sh zaxira {n} donaga kamayadi", { n }),
        tone: 'neutral',
      },
      { text: t("Pul harakati yo'q — mijozning pul qarzi o'zgarmaydi"), tone: 'neutral' },
      keepsHistory,
    ];
  }

  return [
    {
      text:
        args.amount != null && args.amount > 0
          ? t('«{client}» ning pul qarzi {sum} ga kamayadi', {
              client: clientName,
              sum: fmtUZS(args.amount),
            })
          : t('«{client}» ning pul qarzi undirilgan summaga kamayadi', { client: clientName }),
      tone: 'success',
    },
    {
      text: t('{n} dona paddon yana «{client}» hisobiga qaytadi — paddon qarzi shunga oshadi', {
        n,
        client: clientName,
      }),
      tone: 'warning',
    },
    {
      text: t("Diller qo'lidagi zaxira o'zgarmaydi — yo'qolgan paddon qo'limizga qaytmagan edi"),
      tone: 'neutral',
    },
    keepsHistory,
  ];
}

/**
 * Amaldan KEYINGI xabar. Yakuniy paddon qoldig'ini ham, yechilgan summani ham SERVER
 * aytadi (`clientPalletBalance`, `reversedAmount`) — ekran o'zi «+qty» deb hisoblab
 * qo'ysa, bekor qilingan buyurtma stornosi davom etgan holatda yolg'on gapirardi.
 */
export function palletCancelSuccess(
  kind: PalletCancelKind,
  t: TFn,
  res: { clientPalletBalance?: number; reversedAmount?: string | null } | undefined,
): string {
  const left = res?.clientPalletBalance;
  const amount = res?.reversedAmount != null ? Number(res.reversedAmount) : null;

  if (kind === 'CHARGE') {
    if (amount != null && amount > 0 && typeof left === 'number') {
      return t('Undirish bekor qilindi — {sum} qarzdan yechildi, mijozda {n} dona paddon qoldi', {
        sum: fmtUZS(amount),
        n: fmtNum(left),
      });
    }
    if (amount != null && amount > 0) {
      return t('Undirish bekor qilindi — {sum} mijoz qarzidan yechildi', { sum: fmtUZS(amount) });
    }
    return t('Undirish bekor qilindi');
  }

  return typeof left === 'number'
    ? t('Qaytarish bekor qilindi — mijozda {n} dona paddon qoldi', { n: fmtNum(left) })
    : t('Qaytarish bekor qilindi');
}
