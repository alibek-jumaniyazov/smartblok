/**
 * ═══════ SHABLON QO'RIQCHISI ═══════
 *
 * Import faqat JORIY shaklni qabul qilishi shart. Bu shunchaki qulaylik emas — XAVFSIZLIK:
 * eski shablonning «Лист1» varag'i ham 3-qatorida `Агент`+`Клиент` sarlavhalariga ega, ya'ni
 * u YANGI parserning belgilariga qisman to'g'ri keladi. Agar tekshiruv bo'shashsa, noto'g'ri
 * fayl JIMGINA qabul qilinib, butunlay boshqa ustunlardan pul yasalgan bo'lardi
 * (yangi `A` = «Тўлов тури», eskisida `A` = «В-о»).
 *
 * Shuning uchun bu yerda uch xil «noto'g'ri fayl» sinaladi va uchalasi ham RAD ETILISHI kerak.
 *
 *   cd apps/api && npx tsx test/import/template-guard.ts
 */
import ExcelJS from 'exceljs';
import { parseWorkbook } from '../../src/import/import.service';
import { TemplateMismatchError } from '../../src/import/parse/workbook.reader';

let fails = 0;
const mustReject = async (label: string, buf: Buffer) => {
  try {
    await parseWorkbook(buf);
    fails++;
    console.error(`  ✗ ${label}: QABUL QILINDI (jim xato xavfi!)`);
  } catch (e) {
    if (e instanceof TemplateMismatchError) {
      console.log(`  ✓ ${label} rad etildi — ${(e as Error).message.slice(0, 90)}…`);
    } else {
      fails++;
      console.error(`  ✗ ${label}: boshqa xato bilan yiqildi — ${(e as Error).message.slice(0, 120)}`);
    }
  }
};

const toBuffer = async (wb: ExcelJS.Workbook): Promise<Buffer> =>
  Buffer.from(await wb.xlsx.writeBuffer());

async function main() {
  console.log('— noto‘g‘ri fayllar rad etiladimi —');

  { // 1) ESKI shablon: «Лист1» + «Агент»/«Клиент» sarlavhalari (eng xavfli holat)
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Лист1');
    ws.getRow(3).values = ['В-о', 'Поставшик', 'Агент', 'Клиент', 'Дата', '№ авто', 'Размер', 'Блок Куб'];
    ws.getRow(4).values = [1, 'Газоблок', 'Жамол', 'Мижоз', new Date('2026-07-01'), '01 A 111 AA', '600x300x200', 10];
    await mustReject('eski shablon («Лист1» jurnali)', await toBuffer(wb));
  }

  { // 2) butunlay begona fayl
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.getRow(1).values = ['a', 'b', 'c'];
    await mustReject('begona xlsx', await toBuffer(wb));
  }

  { // 3) справочник BOR, lekin «Товар» ustunlari eski shakl — IKKINCHI qatlam tekshiruvi.
    //    Bu eng nozik holat: fayl «to'g'ri»ga o'xshaydi, lekin ustunlari boshqa joyda.
    const wb = new ExcelJS.Workbook();
    const m = wb.addWorksheet('Кўрсаткичлар');
    m.getRow(10).values = ['Расмий ном', 'Варианти-1', 'Варианти-2', 'Эски варақ', 'Агент'];
    m.getRow(11).values = ['Мижоз', '', '', '', 'Жамол'];
    const t = wb.addWorksheet('Товар');
    t.getRow(3).values = ['В-о', 'Поставшик', 'Агент', 'Клиент', 'Дата', '№ авто', 'Размер', 'Блок Куб'];
    await mustReject('справочник bor, «Товар» ustunlari eski', await toBuffer(wb));
  }

  { // 4) «Товар» to‘g‘ri, lekin «Оплата» varag‘i umuman yo‘q — pul jimgina yo‘qolmasin
    const wb = new ExcelJS.Workbook();
    const m = wb.addWorksheet('Кўрсаткичлар');
    m.getRow(10).values = ['Расмий ном', 'Варианти-1', 'Варианти-2', 'Эски варақ', 'Агент'];
    m.getRow(11).values = ['Мижоз', '', '', '', 'Жамол'];
    const t = wb.addWorksheet('Товар');
    t.getRow(3).values = [
      'Тўлов тури', 'Поставшик', 'Агент', 'Клиент', 'Дата ', '№ авто', 'Размер',
      'Блок\n Куб', 'Цена \nПриход', 'Сумма \nПриход', 'Поддон\nШт', 'Цена\nПоддон',
      'Сумма Поддон', 'Блок+\nПоддон', 'Цена\n Продажа', 'Сумма \nПродажа',
      'Расход \nАвто', 'Общая прибль', 'Авто услу ', 'Мижозга',
    ];
    await mustReject('«Оплата» varag‘i yo‘q', await toBuffer(wb));
  }

  console.log(`\n${fails === 0 ? 'SHABLON QO‘RIQCHISI O‘TDI ✓' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
