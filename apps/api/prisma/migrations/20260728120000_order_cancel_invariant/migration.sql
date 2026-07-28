-- Bekor qilingan buyurtma: `status` va `cancelledAt` bir-biridan AJRALIB KETMASIN.
--
-- Nima uchun (2026-07-28): «bekor qilingan buyurtma hech qayerda hisoblanmaydi»
-- qoidasi butun kod bazasi bo'ylab BITTA predikatga tayanadi — `status <> 'CANCELLED'`
-- (qarang: src/common/order-scope.ts). Ilgari shart uch xil imloda yozilgan edi va
-- ulardan biri `cancelledAt IS NULL` edi. Bugun uchalasi bir xil javob beradi, chunki
-- bekor qilish ikkala ustunni birga yozadi — lekin buni BAZADA hech narsa majbur
-- qilmasdi. Bitta migratsiya, bitta qo'lda UPDATE yoki bitta yangi kod yo'li ularni
-- ajratib yuborsa, ba'zi ekranlar bekor qilinganni sanay boshlardi, boshqalari yo'q —
-- va hech qayerda xato ko'rinmasdi, shunchaki raqamlar bir-biriga to'g'ri kelmasdi.
--
-- Shuning uchun invariant endi sxemada turadi: CANCELLED bo'lsa `cancelledAt` bor,
-- bo'lmasa yo'q.

-- 1) Avval mavjud ma'lumot tuzatiladi, aks holda constraint eski bazada tushmaydi.
--    Ikki tomonlama: sanasi yo'q bekorlarga sana qo'yiladi (tarixiy yozuvlar uchun
--    `updatedAt` eng yaqin haqiqatga o'xshash taxmin), bekor bo'lmagan qatorlardan
--    esa qolib ketgan sana o'chiriladi.
UPDATE "Order"
SET "cancelledAt" = COALESCE("updatedAt", "createdAt", now())
WHERE "status" = 'CANCELLED' AND "cancelledAt" IS NULL;

UPDATE "Order"
SET "cancelledAt" = NULL
WHERE "status" <> 'CANCELLED' AND "cancelledAt" IS NOT NULL;

-- 2) Invariant.
ALTER TABLE "Order"
  ADD CONSTRAINT "order_cancelled_at_matches_status"
  CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));
