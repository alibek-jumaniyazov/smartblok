// Toʼliq Excel eksporti (GET /export/xlsx) — regression suite.
//
// Nima tekshiriladi va NEGA aynan shular:
//
//  · ROL. Fayl butun kompaniyaning maʼlumoti. AGENT tokeni bilan chaqirilsa, oʼqish
//    yoʼllari uni oʼz mijozlari bilan cheklaydi (common/scoping.ts) va natijada
//    «toʼliq baza» deb atalgan, aslida yarim fayl chiqadi — sukut saqlagan yolgʼon.
//    Shuning uchun AGENT va KASSIR 403 olishi SHART.
//  · DTO QATʼIYLIGI. main.ts dagi ValidationPipe `forbidNonWhitelisted` bilan ishlaydi:
//    eʼlon qilinmagan parametr 400 qaytaradi, jimgina tashlab yuborilmaydi. Aynan shu
//    tuzoq bir marta Mijozlar sahifasidagi agent filtrini oʼldirgan edi.
//  · SARLAVHALAR. helmet() `nosniff` qoʼyadi — MIME aniq boʼlmasa brauzer faylni
//    jadval deb qabul qilmaydi. Fayl nomi kirill, shuning uchun RFC 5987 (`filename*`)
//    shakli ham boʼlishi kerak, aks holda nom «export.xlsx» ga aylanadi.
//  · MAZMUN. Kitob ochiladi, varaqlar sanaladi va «Умумий кўрсаткичлар» varagʼidagi
//    SOF FOYDA /dashboard/summary bilan solishtiriladi: bu ikkalasi bir manbadan
//    kelishi kerak, formulaning nusxasi emas.
//
// Run (izolyatsiya qilingan baza, hech qachon dev maʼlumoti ustida emas):
//   cd apps/api
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test API_PORT=4100 node dist/main.js &
//   node test/export-xlsx.e2e.mjs
import ExcelJS from 'exceljs';

const BASE = process.env.API_URL || 'http://localhost:4100/api';

let failures = 0;
let checks = 0;
const ok = (cond, label, extra = '') => {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  } else {
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`);
  }
};

async function login(username, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) return null;
  return (await res.json()).accessToken;
}

const get = (path, token) =>
  fetch(BASE + path, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);

console.log('\n=== EXPORT XLSX ===');

const admin = await login('admin', 'admin123');
ok(!!admin, 'ADMIN login');

// ── 1. rol darvozasi ──────────────────────────────────────────────────────
console.log('\n-- rol darvozasi --');
ok((await get('/export/xlsx', null)).status === 401, 'tokensiz → 401');

const agent = await login('jamol', 'agent123');
if (agent) ok((await get('/export/xlsx', agent)).status === 403, 'AGENT → 403');
else console.log('  · AGENT foydalanuvchi seedda yoʼq — oʼtkazib yuborildi');

const cashier = await login('kassa', 'kassa123');
if (cashier) ok((await get('/export/xlsx', cashier)).status === 403, 'KASSIR → 403');
else console.log('  · KASSIR foydalanuvchi seedda yoʼq — oʼtkazib yuborildi');

const accountant = await login('hisob', 'hisob123');
if (accountant) ok((await get('/export/xlsx', accountant)).status === 200, 'BUXGALTER → 200');
else console.log('  · BUXGALTER foydalanuvchi seedda yoʼq — oʼtkazib yuborildi');

// ── 2. DTO qat'iyligi ─────────────────────────────────────────────────────
console.log('\n-- soʼrov parametrlari --');
ok((await get('/export/xlsx?bogus=1', admin)).status === 400, "eʼlon qilinmagan parametr → 400");
ok((await get('/export/xlsx?from=2026-13-01', admin)).status === 400, 'notoʼgʼri oy → 400');
ok((await get('/export/xlsx?to=26.07.2026', admin)).status === 400, 'notoʼgʼri sana formati → 400');
ok((await get('/export/xlsx?from=2026-06-01&to=2026-06-30', admin)).status === 200, 'sana oraligʼi → 200');

// ── 3. javob sarlavhalari va fayl ─────────────────────────────────────────
console.log('\n-- javob va fayl --');
const res = await get('/export/xlsx', admin);
ok(res.status === 200, 'ADMIN → 200', `status=${res.status}`);

const ct = res.headers.get('content-type') || '';
ok(ct.includes('spreadsheetml.sheet'), 'MIME — aniq xlsx', ct.slice(0, 60));

const cd = res.headers.get('content-disposition') || '';
ok(cd.startsWith('attachment;'), 'Content-Disposition — attachment');
ok(cd.includes("filename*=UTF-8''"), 'kirill fayl nomi RFC 5987 shaklida');

const buf = Buffer.from(await res.arrayBuffer());
ok(buf[0] === 0x50 && buf[1] === 0x4b, 'ZIP (xlsx) imzosi');
ok(buf.length > 20_000, 'fayl boʼsh emas', `${(buf.length / 1024).toFixed(0)} KB`);

// ── 4. kitob mazmuni ──────────────────────────────────────────────────────
console.log('\n-- kitob mazmuni --');
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buf);

ok(wb.worksheets.length >= 25, 'kamida 25 ta varaq', `${wb.worksheets.length} ta`);
ok(wb.worksheets[0].name === 'Муқова', 'birinchi varaq — Муқова', wb.worksheets[0].name);
ok(wb.worksheets[1].name === 'Мундарижа', 'ikkinchi varaq — Мундарижа', wb.worksheets[1].name);

// har bir varaqda rangli yorliq va sarlavha lentasi bor
const noTab = wb.worksheets.filter((ws) => !ws.properties?.tabColor?.argb).map((ws) => ws.name);
ok(noTab.length === 0, 'har bir varaqda rangli yorliq', noTab.join(', '));

// xom enum hech qayerda koʼrinmasligi kerak — foydalanuvchi «CLIENT_IN» oʼqimaydi
const RAW_ENUM = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;
const leaks = [];
for (const ws of wb.worksheets) {
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value === 'string' && RAW_ENUM.test(cell.value)) leaks.push(`${ws.name}:${cell.address}=${cell.value}`);
    });
  });
}
ok(leaks.length === 0, 'xom enum qiymatlari yoʼq', leaks.slice(0, 4).join(', '));

// Pul kataklari MATN emas, SON boʼlishi kerak — aks holda Excel ustunni qoʼsha olmaydi
// va katakda «raqam matn sifatida saqlangan» uchburchagi chiqadi.
//
// Kassa varagʼi tekshiriladi, chunki seed HAR DOIM kassa hisoblarini yaratadi: boʼsh
// bazada buyurtma yoʼq va u varaqda «Maʼlumot yoʼq» matni turadi, yaʼni buyurtmaga
// bogʼlangan tekshiruv jimgina «matn» deb yiqilardi — mahsulot xatosi emas, test xatosi.
const numericCell = (ws, headerText, row = 5) => {
  const col = ws.getRow(4).values.findIndex((v) => v === headerText);
  return col > 0 ? ws.getRow(row).getCell(col).value : undefined;
};

const boxes = wb.getWorksheet('Касса қолдиқлари');
ok(!!boxes, 'Касса қолдиқлари varagʼi bor');
if (boxes) {
  const balance = numericCell(boxes, 'ҚОЛДИҚ');
  ok(typeof balance === 'number', 'kassa qoldigʼi — SON (matn emas)', `type=${typeof balance}`);
}

const orders = wb.getWorksheet('Буюртмалар');
ok(!!orders, 'Буюртмалар varagʼi bor');
const firstOrderNo = orders?.getRow(5).getCell(1).value;
if (typeof firstOrderNo === 'string' && firstOrderNo.startsWith('ORD-')) {
  const sale = numericCell(orders, 'Савдо суммаси');
  ok(typeof sale === 'number', 'savdo summasi — SON (matn emas)', `type=${typeof sale}`);
} else {
  console.log('  · bazada buyurtma yoʼq — savdo summasi turi tekshirilmadi');
}

// ── 5. dashboard bilan bir xil raqam ──────────────────────────────────────
console.log('\n-- dashboard bilan solishtirish --');
const summary = await (await get('/dashboard/summary', admin)).json();
const kpi = wb.getWorksheet('Умумий кўрсаткичлар');
ok(!!kpi, 'Умумий кўрсаткичлар varagʼi bor');
if (kpi) {
  let netProfitCell = null;
  kpi.eachRow((row) => {
    if (String(row.getCell(1).value ?? '').trim() === 'СОФ ФОЙДА') netProfitCell = row.getCell(2).value;
  });
  const expected = Number(summary.allTime.netProfit);
  ok(
    netProfitCell !== null && Math.abs(Number(netProfitCell) - expected) < 0.01,
    'SOF FOYDA = /dashboard/summary.allTime.netProfit',
    `fayl=${netProfitCell} dashboard=${expected}`,
  );
}

// ── 6. bekor qilingan buyurtma kitobda UMUMAN yoʼq ────────────────────────
//
// Egasi qoidasi (2026-07-28): bekor qilingan buyurtma hech qayerda hisoblanmaydi,
// shu jumladan eksportda ham. Ilgari u qatorda turar va varaqda IKKITA JAMI boʼlardi:
// yuqoridagisi bekor qilinganlarni ham qoʼshib yuborar, pastdagisi esa «JAMI — bekor
// qilinganlarsiz» deb toʼgʼrilab qoʼyardi. Ikkala narsa ham olib tashlandi.
//
// Bu yerda JAMI qatorining QIYMATI tekshirilmaydi — ExcelJS formulani keshlangan
// natijasiz yozadi, yaʼni fayldan son oʼqib boʼlmaydi. Tekshiriladigan narsa
// buning oʼrniga aniqroq: bekor qilingan buyurtma raqami varaqda YOʼQ.
console.log('\n-- bekor qilingan buyurtma eksportda --');
const post = (path, body, token) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const productsRes = await (await get('/products?pageSize=50', admin)).json();
const product = (productsRes.items ?? productsRes).find((p) => p.name.includes('600x300x200'));
if (!product) {
  console.log('  · seed mahsuloti topilmadi — oʼtkazib yuborildi');
} else {
  const stamp = Date.now().toString(36).slice(-6);
  const client = await (await post('/clients', { name: `Eksport bekor ${stamp}` }, admin)).json();
  const live = await (
    await post('/orders', {
      clientId: client.id,
      date: '2026-07-26',
      factoryPayIntent: 'BANK',
      transportMode: 'CLIENT_OWN',
      items: [{ productId: product.id, quantityM3: 5, palletCount: 0, salePricePerM3: 1_000_000 }],
    }, admin)
  ).json();
  const dead = await (
    await post('/orders', {
      clientId: client.id,
      date: '2026-07-26',
      factoryPayIntent: 'BANK',
      transportMode: 'CLIENT_OWN',
      items: [{ productId: product.id, quantityM3: 7, palletCount: 0, salePricePerM3: 1_000_000 }],
    }, admin)
  ).json();
  ok(!!live?.orderNo && !!dead?.orderNo, 'ikkita test buyurtmasi yaratildi');

  const cancelRes = await fetch(`${BASE}/orders/${dead.id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
    body: JSON.stringify({ reason: 'eksport testi', mode: 'VOID_ALL' }),
  });
  ok(cancelRes.status === 200, 'buyurtma bekor qilindi', `status=${cancelRes.status}`);

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(Buffer.from(await (await get('/export/xlsx', admin)).arrayBuffer()));

  // varaqning 1-ustunidagi buyurtma raqamlari
  const orderNosOn = (sheetName) => {
    const ws = wb2.getWorksheet(sheetName);
    const seen = new Set();
    ws?.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === 'string') seen.add(v);
    });
    return seen;
  };
  for (const sheet of ['Буюртмалар', 'Буюртма қаторлари']) {
    const nos = orderNosOn(sheet);
    ok(nos.has(live.orderNo), `«${sheet}» — tirik buyurtma bor`, live.orderNo);
    ok(!nos.has(dead.orderNo), `«${sheet}» — bekor qilingani YOʼQ`, dead.orderNo);
  }

  // ikkinchi «JAMI — bekor qilinganlarsiz» qatori butun kitobdan olib tashlangan
  let extraTotalCells = 0;
  for (const ws of wb2.worksheets) {
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'string' && cell.value.toLowerCase().includes('бекор қилинганларсиз')) {
          extraTotalCells++;
        }
      });
    });
  }
  ok(extraTotalCells === 0, 'ikkinchi «bekor qilinganlarsiz» JAMI qatori yoʼq', `${extraTotalCells} ta topildi`);
}

console.log(`\n${failures === 0 ? '✓ ALL GREEN' : `✗ ${failures} FAILED`} (${checks} checks)\n`);
process.exit(failures === 0 ? 0 : 1);
