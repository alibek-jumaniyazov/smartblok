-- Bekor qilishda tanlangan PUL rejimini buyurtmada saqlash (egasi qoidasi, 2026-07-29).
--
-- Bekor qilingandan keyin buyurtma kartochkasi pul qayerda qolganini AYTA OLMASDI: mijoz
-- avansidami, zavodda avansmi, yoki ikkala hujjat ham storno qilinganmi. Aynan «pul ko'zdan
-- g'oyib bo'ldi» shikoyati shundan tug'ilgan, shuning uchun tanlov endi qatorning o'zida
-- yozilib qoladi (audit izidan tashqari, ekranda ko'rsatish uchun ham).
--
-- Eski (shu migratsiyagacha bekor qilingan) qatorlarda NULL bo'lib qoladi — tanlov o'sha
-- paytda yozilmagani ROST, uni taxmin qilib to'ldirish yolg'on bo'lardi. UI NULL'ni
-- «rejim yozilmagan» deb ko'rsatadi.

CREATE TYPE "CancelMoneyMode" AS ENUM ('REFUND', 'VOID_ALL');

ALTER TABLE "Order" ADD COLUMN "cancelMoneyMode" "CancelMoneyMode";

-- Rejim faqat BEKOR QILINGAN buyurtmada bo'lishi mumkin: tirik buyurtmada turgan qiymat
-- «bu buyurtma bekor qilingan» degan yolg'on ma'noni ekranga olib chiqardi.
ALTER TABLE "Order" ADD CONSTRAINT "order_cancel_money_mode_only_when_cancelled" CHECK (
  "cancelMoneyMode" IS NULL OR "status" = 'CANCELLED'
);
