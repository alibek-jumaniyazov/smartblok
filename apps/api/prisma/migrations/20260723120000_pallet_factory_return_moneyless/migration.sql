-- Paddon zavod tomonida PULSIZ (egasining qoidasi).
--
-- «Zavod u paddonlar uchun pul bermaydi — faqat paddonlar SONIDA qarz bo'lamiz.»
-- Ya'ni zavodga paddon qaytarish moliyaviy hodisa EMAS: u faqat sonni yopadi.
-- Kod allaqachon shunday ishlaydi; bu migratsiya qoidani ma'lumotlar bazasi
-- darajasida qotiradi, toki kelajakda hech kim (import, skript, yangi endpoint)
-- paddon qaytarishga pul ulab yubora olmasin.

-- 1) Tarixiy tozalash: hech qanday pul yozuvi BOG'LANMAGAN RETURNED_TO_FACTORY
--    qatorlaridagi o'lik `unitPrice` olib tashlanadi (u faqat ekranda «Jami / hisobga
--    +X so'm» degan yolg'onni chizardi — hech qayerda pul harakatlantirmagan).
--    Pul yozuvi bog'langan qatorlar TEGILMAYDI: ular tarix, va ularning summasi
--    LedgerEntry'da yashaydi — audit izi buzilmasligi kerak.
UPDATE "PalletTransaction" pt
SET "unitPrice" = NULL
WHERE pt."type" = 'RETURNED_TO_FACTORY'
  AND pt."unitPrice" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" le WHERE le."palletTransactionId" = pt."id");

-- 2) Bundan buyon zavodga qaytarilgan paddon narx ko'tara olmaydi.
--    NOT VALID: yuqoridagi UPDATE'dan omon qolgan (pul yozuvi bor) tarixiy qatorlar
--    joyida qoladi, lekin YANGI qator hech qachon narx bilan yozilmaydi.
ALTER TABLE "PalletTransaction"
  ADD CONSTRAINT "pallet_factory_return_moneyless"
  CHECK ("type" <> 'RETURNED_TO_FACTORY' OR "unitPrice" IS NULL) NOT VALID;

-- 3) LedgerSource.PALLET_RETURN_CREDIT butunlay iste'foda (2026-07-21). Enum qiymati
--    tarixiy qatorlar uchun qoladi, ammo YANGI yozuv yozib bo'lmaydi — «zavodga paddon
--    qaytardim → zavod hisobiga pul tushdi» zanjiri endi mumkin emas.
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "ledger_no_pallet_return_credit"
  CHECK ("source" <> 'PALLET_RETURN_CREDIT') NOT VALID;
