import { OrderStatus, Prisma } from '@prisma/client';

/**
 * BEKOR QILINGAN BUYURTMA HECH QAYERDA HISOBLANMAYDI (egasi qoidasi, 2026-07-28).
 *
 * Bekor qilingan buyurtmaning savdo summasi, tannarxi, transporti, hajmi, paddoni,
 * bonusi, foydasi — va hatto SONI ham — foydalanuvchiga ko'rinadigan biror yakunga
 * qo'shilmaydi: dashboard, ro'yxat yakunlari, mijoz/agent/zavod/moshina/mahsulot
 * kartochkalari, qarzlar, Excel eksporti, AI chat javoblari.
 *
 * Qator sifatida ro'yxatda KO'RINISHI mumkin (qizil «Bekor» yorlig'i bilan) — bu
 * qoidani buzmaydi: ko'rsatish hisoblash emas. Buzadigani — o'sha qatorning
 * raqamlari yig'indiga tushib ketishi.
 *
 * ── Nega bitta joyda? ──
 * Bu shart kod bazasi bo'ylab 20 dan ortiq joyda qo'lda yozilgan edi va uchta
 * turli shaklda: `status: { not: CANCELLED }`, xom SQL `o."status" <> 'CANCELLED'`
 * va `o."cancelledAt" IS NULL`. Uchtasi bugun bir xil javob beradi (bekor qilish
 * ikkalasini birga yozadi), lekin bittasini unutgan yangi so'rov JIMGINA noto'g'ri
 * raqam chiqaradi — ekranda hech qanday xato ko'rinmaydi, shunchaki summa katta
 * bo'ladi. Shuning uchun yagona manba: quyidagi ikki eksport.
 *
 * ── `status` yoki `cancelledAt`? ──
 * KANONIK predikat — `status`. `cancelledAt` shunchaki VAQT belgisi: u
 * `cancel()` da statusga birga yoziladi, lekin hech qanday cheklov uni statusga
 * bog'lab turmaydi, ya'ni kelajakda ajralib ketishi mumkin. Status esa enum va
 * buyurtma hayotining yagona rasmiy holati.
 */
export const NOT_CANCELLED: Prisma.OrderWhereInput = { status: { not: OrderStatus.CANCELLED } };

/**
 * Berilgan filtrni «faqat tirik buyurtmalar» bilan KESISHTIRADI.
 *
 * ATAYLAB `AND`, spread emas: `{ ...where, ...NOT_CANCELLED }` chaqiruvchi o'zi
 * yuborgan `status` shartini jimgina yeb qo'yardi (masalan `?status=COMPLETED`
 * bilan kelgan so'rov butunlay boshqa savolga javob berardi). `AND` esa ikkala
 * shartni ham saqlaydi.
 */
export const liveOrders = (where?: Prisma.OrderWhereInput): Prisma.OrderWhereInput =>
  where && Object.keys(where).length ? { AND: [where, NOT_CANCELLED] } : { ...NOT_CANCELLED };

/** Bog'liq modeldan (OrderItem, PalletTransaction, …) buyurtma orqali filtrlash. */
export const liveOrderRelation = (where?: Prisma.OrderWhereInput) => ({ order: liveOrders(where) });

/**
 * Xom SQL uchun o'sha shart. `Prisma.sql` fragmenti — `WHERE ... AND ${NOT_CANCELLED_SQL}`
 * ko'rinishida qo'shiladi. Jadval taxallusi `o` bo'lishi shart (butun kod bazasida shunday).
 */
export const NOT_CANCELLED_SQL = Prisma.sql`o."status" <> 'CANCELLED'`;
