-- Paddon stornosi 1:1 dan 1:N ga (egasining shikoyati, 2026-08-13).
--
-- MUAMMO. Buyurtma bekor qilinganda uning paddon stornosi mijoz O'SHA PAYTDA ushlab
-- turgan songa qadar QIRQILADI (pallets.service.ts reverseForOrder) — aks holda mijoz
-- qoldig'i manfiyga tushib, qo'limizda yo'q paddon «zaxira» bo'lib paydo bo'lardi.
-- Qirqilgan bo'lak keyinroq — mijoz qo'lidagi son qaytadan ko'tarilganda — davom
-- ettirilishi kerak edi, lekin `reversalOfId` UNIQUE bo'lgani uchun asl qatorning
-- yagona storno uyasi band bo'lib qolardi va bo'lak ABADIY osilib qolardi.
--
-- Natijada mijoz kartochkasi bekor qilingan buyurtmaning paddonini o'ziniki qilib
-- ko'rsatardi: «Mijozga jami berilgan 5 · Mijoz qaytargan 0 · Hozir mijozda 5» —
-- va o'sha 5 dona QAYSI buyurtmadan kelgani hech qayerda yozilmagan edi. Bu egasining
-- «bekor qilinganlar hech qayerda hisoblanmaydi» qoidasini buzadi.
--
-- YECHIM. Bitta qator bir nechta storno oladi; har biri o'z bo'lagini yopadi.
-- Yagona chegara — Σ|storno| ≤ asl qator qty'si — QATORLAR ARO, ya'ni CHECK bilan
-- ifodalab bo'lmaydi. U kodda, mijoz qatorining FOR UPDATE qulfi ostida ushlanadi
-- (o'sha qulf qaytarish/undirish chegaralarini ham ushlaydi), bazada esa quyidagi
-- qisman unique indeks eng muhim yarmini saqlab qoladi.

-- 1) Asl qatorning turi storno qatoriga ko'chiriladi. Bu denormalizatsiya faqat bitta
--    narsa uchun: qisman unique indeks predikati BOSHQA qatorga (asliga) qarolmaydi.
ALTER TABLE "PalletTransaction" ADD COLUMN "reversalOfType" "PalletTransactionType";

UPDATE "PalletTransaction" pt
SET "reversalOfType" = src."type"
FROM "PalletTransaction" src
WHERE pt."reversalOfId" = src."id";

-- 2) Global UNIQUE olib tashlanadi — endi yetkazish qatori bir nechta bo'lak storno oladi.
DROP INDEX IF EXISTS "PalletTransaction_reversalOfId_key";

-- 3) …lekin BUTUN QATOR bo'yicha bekor qilinadigan ikki tur uchun «bir marta» qoidasi
--    BAZADA qoladi. «Mijoz qaytardi» va «Yo'qotilganini undirish» qisman stornolanmaydi
--    va mumkin ham emas: undirishning pul tomoni LedgerEntry.reversalOfId UNIQUE bilan
--    baribir bitta stornoga qulflangan, ya'ni ikkinchi storno paddonni qaytarib, pulni
--    qaytarmasdan ketardi. `PaymentAllocation_active_pair` bilan bir xil idioma.
CREATE UNIQUE INDEX "PalletTransaction_whole_row_reversal_once"
  ON "PalletTransaction" ("reversalOfId")
  WHERE "reversalOfId" IS NOT NULL
    AND "reversalOfType" IN ('RETURNED_BY_CLIENT', 'CHARGED_LOST');

-- 4) UNIQUE indeks o'chgani bilan ustunning YAGONA indeksi ham ketdi. pallet-stats.ts
--    va dealerInHand har bir o'qishda aynan shu ustun bo'yicha LEFT JOIN qiladi.
CREATE INDEX "PalletTransaction_reversalOfId_idx" ON "PalletTransaction" ("reversalOfId");
