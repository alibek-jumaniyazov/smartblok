/**
 * Yuklangan Excel faylining nomi — kirillcha harflar buzilmasin.
 *
 * Brauzer multipart'da fayl nomini UTF-8 baytlari bilan yuboradi, multer 2 / busboy esa
 * ularni latin1 deb o'qiydi: «Система газаблок (1).xlsb» → «Ð¡Ð¸Ñ\u0081Ñ\u0082ÐµÐ¼Ð° …».
 * Shu baytlar qayta UTF-8 sifatida o'qiladi — lekin FAQAT natija toza UTF-8 bo'lsa.
 * Lotincha nom, allaqachon to'g'ri unicode nom yoki haqiqiy latin1 nom («café.xlsx»)
 * o'zgarmaydi. Bazada eski buzilgan nom bo'lsa, o'qishda ham shu funksiya tiklaydi.
 */
export function utf8FileName(name: string): string {
  if (!/[\u0080-ÿ]/.test(name) || /[^\u0000-ÿ]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}
