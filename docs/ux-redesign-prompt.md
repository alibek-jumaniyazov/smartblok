# SmartBlok — UX Redizayn Prompti (Professional)

> **Vazifa turi:** butun `apps/web` frontendini yagona dizayn tizimiga keltirish, jadvallarni standartlashtirish, har bir ro'yxat sahifasiga jadval ustidagi filtrlarni qo'shish, barcha "kunlik/7 kun/30 kun/90 kun" tez-preset tugmalarini olib tashlab **faqat sana‑dan‑sana (date‑to‑date)** oralig'i bilan ishlatish, sidebar dizaynini yangilash va loyihani optimizatsiya qilish.
>
> **Stack:** React + TypeScript, Ant Design **v6**, react-router v6, react-query, `apps/web/src/design.css` (`--sb-*` tokenlar), custom `useThemeMode()` ThemeContext.
>
> **Muqaddas qoida:** biznes-mantiq (buyurtma, to'lov, qarz, kassa, bonus, paddon hisob-kitoblari) **o'zgarmaydi** — bu faqat UI/UX va standartlashtirish ishi. Har bir o'zgarishdan keyin `tsc`/build va E2E buzilmasligi shart.

---

## 0. Umumiy tamoyillar (barcha bloklar uchun)

1. **Yagona manba (single source of truth).** Har bir tashqi ko'rinish elementi bitta umumiy komponentdan kelib chiqsin. Yangi ad-hoc `<Table>`, ad-hoc `<Drawer>`, ad-hoc filtr yaratish taqiqlanadi — mavjud umumiylardan foydalaniladi:
   - Sahifa sarlavhasi → `PageHeader`
   - Ro'yxat konteyneri → `TableCard`
   - Jadvalning o'zi → `DataTable` (raw AntD `<Table>` emas)
   - Filtr qatori → `FilterBar` (TableCard `toolbar` slotida)
   - Yaratish/tahrirlash → `FormDrawer` (raw `<Drawer>` emas)
   - Sana oralig'i → `DateRangeControl` (faqat RangePicker rejimida — pastga qarang)
2. **URL — holatning manbasi.** Barcha filtr/sahifalash/saralash holati `useUrlFilters` orqali URL'da bo'lsin (lokal `useState` emas), shunda havola ulashiladigan va navigatsiyada saqlanadigan bo'ladi.
3. **Tokenlashtirilgan uslub.** Inline `style={{…}}` o'rniga `--sb-*` tokenlari va CSS klasslari. Sehrli raqamlar (magic numbers) yo'q — bo'shliqlar uchun spacing shkalasi tokeni ishlatiladi (4/8-blokga qarang).
4. **antd'ni yengish emas, boshqarish.** Iloji boricha `!important` bilan antd ichki elementlarini bosib o'tish o'rniga `ConfigProvider` `theme.token`/`components` orqali sozlash.
5. **Har blokdan keyin tekshirish:** `pnpm --filter web build` (yoki mos buyruq) toza o'tsin; vizual regressiya bo'lmasin; light **va** dark rejim, hamda collapsed sidebar tekshiriladi.

---

## 1-BLOK — Har bir sahifani standartlashtirish

**Muammo (audit):** ayni paytda ikkita raqobatlashuvchi jadval komponenti bor. `DataTable` ("yagona jadval" — klaviatura kursori, URL-sinxron sahifalash, halol skelet-yuklanish, `EmptyState`/`ErrorState`, ustun presetlari, zichlik, server-sort) faqat **Payments, ClientDetail, Kassa, Debts**'da ishlatilgan. Qolgan **~17 faylda 27 ta xom `<Table>`** bor — ya'ni klaviatura navigatsiyasi, halol skeletlar, filtrlangan bo'sh holat, ustun presetlari va server-sort ko'p sahifalarda umuman yo'q.

**Talab:** quyidagi ro'yxat sahifalarining hammasini `PageHeader + TableCard + DataTable + FilterBar` shabloniga ko'chirish:

| Sahifa | Hozir | Ko'chirish kerak |
|---|---|---|
| `Orders.tsx` | xom `<Table>` + PageHeader'dagi filtrlar | DataTable; filtrlar → TableCard toolbar'dagi FilterBar; Board ko'rinishini saqlab, Jadval ko'rinishini DataTable qilish |
| `Clients.tsx` | xom `<Table>`, lokal search, xom `<Drawer>` | DataTable + FilterBar; ikkala raw Drawer → `FormDrawer` |
| `Factories.tsx` | xom `<Table>`, lokal search | DataTable + FilterBar |
| `Vehicles.tsx` | xom `<Table>`, lokal search | DataTable + FilterBar |
| `Agents.tsx` | xom `<Table>`, **filtr yo'q**, `<Alert>` xato | DataTable + FilterBar (search); xato → `ErrorState` |
| `Products.tsx` | xom `<Table>`, o'z filtr div'i | DataTable; filtr div → toolbar FilterBar |
| `Users.tsx` | xom `<Table>`, filtr yo'q | DataTable + FilterBar (search/role) |
| `Bonus.tsx` | xom `<Table>`, toolbar Select | DataTable + FilterBar |
| `Pallets.tsx` | xom `<Table>` (2 balans + harakatlar) | DataTable; harakatlar jadvaliga FilterBar |
| `Debts.tsx` | qisman DataTable, `BoardSkeleton` xom `<Table>` | to'liq DataTable skeletiga o'tkazish |
| `Dashboard.tsx` | `.sb-panel`/`.dash-card`'dagi xom `<Table>`lar (RankingCard, TodayFeed, trend) | jadval bo'lgan joylarda DataTable/TableCard; KPI'lar StatCard'da qoladi |
| `FactoryDetail.tsx` | ko'p bir martalik `<Table>`lar | tab jadvallarini DataTable/TableCard'ga |
| `AgentDetail.tsx` | xom `<Table>` (mijozlar) | DataTable/TableCard |

**Standartlash detallari:**
- Sahifalash: hamma joyda **URL-sinxron** (`useUrlFilters`), lokal `useState(page)` yoki nazoratsiz `pagination` emas.
- Zichlik: barcha jadvallar `DataTable` default zichligida (`size="small"`) + `DensityToggle`; `middle`/default aralashmasin.
- Yaratish/tahrirlash: hamma joyda `FormDrawer` (Ctrl/Cmd+Enter submit, sticky footer). `Clients.tsx`'dagi ikkita raw Drawer ko'chiriladi.
- Xato/yuklanish/bo'sh: `ErrorState` + `EmptyState` (filtrlangan varianti bilan) + `DataTable` halol skeleti. Bir vaqtda AntD spinner **va** hairline ikki marta ko'rsatilmasin.
- Kartochka primitivi: barcha ro'yxat yuzalari `TableCard` (`.sb-table-card`). Dashboard/detail'dagi `.sb-panel`/`.dash-card` ro'yxatlari ham unifikatsiya qilinadi (kamida bir xil header/padding/border tili).
- Ustun tiplari: `ColumnsType<T>` o'rniga `SbColumn<T>` (server-sort, preset, sortable opsiyalari uchun).

---

## 2-BLOK — Jadval dizaynini yaxshilash

Global jadval uslubi `design.css`'da (`.sb-table-card` + `.ant-table-*` polish) — uni saqlab, professional darajaga ko'tarish:

- **Sarlavha (thead):** uppercase, tracked, `11.5px/600` overline uslubi (mavjud) — saqlanadi, lekin barcha jadvalda bir xil bo'lishi ta'minlanadi.
- **Sticky header** ro'yxat sahifalarida yoqiladi (uzun ro'yxatlarda sarlavha yopishib turadi).
- **Qatorlar:** `middle` vertikal tekislash, `120ms` hover o'tishi, tabular raqamlar (mavjud), zebra emas — toza chiziqli ajratish. Row-cursor chap-urg'u (`inset 2px 0 0 --sb-brand`), `pulse-row` realtime highlight, `ghost-row` bekor qilingan yozuvlar — barcha DataTable sahifalarida ishlashi ta'minlanadi.
- **Bo'sh/xato/yuklanish** holatlari 1-blokdagidek yagona.
- **Pul ustunlari** o'ngga tekislangan, `MoneyCell` variant-ranglar bilan (income yashil, qarz qizil va h.k.), tabular-nums.
- **Gorizontal overflow:** yagona yondashuv — `DataTable`'ning ichki `scroll-x` mexanizmi; sahifalarda `scroll={{x:'max-content'}}` qo'lda takrorlanmasin.
- **Yig'indi qatori (summary):** kerakli jadvallarda `totalsRow()` bilan pinned totals (`--sb-border-strong` yuqori chegara — mavjud uslub).
- **Ustun presetlari + zichlik** (`DataTable` imkoniyati) barcha ro'yxatlarda mavjud bo'ladi.

---

## 3-BLOK — Har bir sahifada jadval ustida filtrlar

**Talab:** har bir ro'yxat sahifasida jadval **ustida** `FilterBar` bo'lsin (`TableCard` `toolbar` slotida yoki kartochka ustida standart joyda — bitta pattern tanlanadi va hamma joyda bir xil qo'llanadi). Barcha filtr holati URL-sinxron (`useUrlFilters`).

Hozir 4 xil tarqoq pattern bor (FilterBar kartochka ustida `marginBottom` div'da — Payments; toolbar'da xom `Input.Search` — Clients/Factories/Vehicles/Bonus/Pallets; PageHeader'da — Orders; umuman yo'q — Agents/Users/Products/AgentDetail). **Bularning hammasi bitta standart FilterBar patternga birlashtiriladi.**

**Sahifa bo'yicha minimal filtr to'plami:**
- **Orders:** qidiruv + mijoz Select + zavod Select + status + **sana oralig'i (from/to)** + Doska/Jadval toggle
- **Clients:** qidiruv + agent Select + balans holati (qarzdor/avans) + faol
- **Agents:** qidiruv + faol
- **Factories:** qidiruv + faol
- **Products:** zavod Select + qidiruv + faol
- **Vehicles:** qidiruv + faol
- **Payments:** (mavjud FilterBar) tur/usul/mijoz/zavod/reconciled + Bekorlar + **sana oralig'i** — saqlanadi
- **Debts:** har board toolbar'i qidiruv + turdagi filtr (sana-preset chiplar 4-blokda olib tashlanadi)
- **Pallets:** harakatlar jadvaliga mijoz/zavod Select + **sana oralig'i**
- **Bonus:** zavod Select + **sana oralig'i**
- **Kassa:** (mavjud) yo'nalish + manba Select + sahifani boshqaruvchi **sana oralig'i** — saqlanadi
- **Users:** qidiruv + role + faol

> Eslatma: filtr to'plamlari kamida shu darajada, lekin sahifa mantig'iga qarab kengaytirilishi mumkin. Har bir yangi filtr — `FilterBar` typed token sifatida, URL kalitlari bilan.

---

## 4-BLOK — "Kunlik / 7 kun / 30 kun" tugmalarini olib tashlash → faqat sana‑dan‑sana

**Maqsad:** barcha tez-preset (quick-preset) tugmalarini olib tashlab, sana filtri **faqat `RangePicker` (from → to)** orqali ishlasin.

**Aniq joylar (fayl + qator):**

1. **`components/DateRangeControl.tsx` (33–93-qatorlar) — ENG MUHIM.**
   `buildPresets()` va preset chip `<Button>` massivini (Bugun · Kecha · 7 kun · Shu oy · O'tgan oy · Shu yil · "Oraliq…") **o'chirish**; faqat `RangePicker` (from/to) qoladi. `activeKey` derive mantig'i ham olib tashlanadi. Bu bitta o'zgarish **Kassa, FactoryDetail (Hisob-kitob), ClientDetail (PartyBalanceHeader), Payments (FilterBar `daterange`)** — hamma consumer'ni avtomatik tozalaydi. `from`/`to` allaqachon to'liq controlled, shuning uchun API'ga ta'sir yo'q.

2. **`pages/Dashboard.tsx` (409–423, 490–499-qatorlar) — PeriodBar.**
   `PERIOD_PRESETS` (Shu oy/O'tgan oy/7 kun/30 kun/90 kun/Shu yil) tugma qatorini **o'chirish**. Ikkita `DatePicker` + "Qo'llash" tugmasi date-to-date almashtiruvchi sifatida qoladi (yoki `DateRangeControl`ning yangi faqat-RangePicker rejimiga ko'chiriladi — afzalroq).

3. **`pages/Dashboard.tsx` (860-qator) — TrendsChart `<Segmented>` (7/30/90/365 kun).**
   Olib tashlanadi; `from/to` oralig'iga o'tkaziladi. ⚠️ **Server shartnomasi:** hozir `GET /dashboard/trends?days`. `from/to` qabul qilishi uchun endpoint yangilanadi (yoki `from/to`'dan `days` client-side hisoblanadi). Pastdagi "Ochiq qarorlar"ga qarang.

4. **`pages/Debts.tsx` (521-qator) — Mijozlar board `<Segmented>` (7/14/30 kun).**
   Bu "kutilayotgan tushum (N kun)" prognozi — kelajakka qaragan oyna. Olib tashlanadi va sana-dan-sana ("N kun ichida muddati keladiganlar" → aniq `from/to` muddat oynasi) bilan almashtiriladi. ⚠️ `GET /debts/clients?days` shartnomasi yangilanishi kerak. "Ochiq qarorlar"ga qarang.

5. **`pages/FactoryDetail.tsx` (614–621, 638-qatorlar) — OpenOrdersStrip `<Segmented>` (30/90 kun/joriy yil).**
   Lokal `win` state olib tashlanadi; `from/to` `RangePicker` bilan almashtiriladi (`dateTo` chegarasi ham qo'shiladi). URL-sinxron qilinadi.

6. **`pages/Payments.tsx` (377-qator) — "Bugungi kirimlar" saved view** (`from=today&to=today`).
   Bu preset tugma emas, saqlangan ko'rinish, lekin today→today oralig'ini qattiq kodlaydi. **Egaga qaror:** qoldirilsinmi yoki olib tashlansinmi? (Standartga ko'ra saqlangan ko'rinishlar qolishi mumkin, lekin so'ralganidek "kunlik" tugmalar ruhiga zid.)

7. **`pages/Dashboard.tsx` (908-qator) — RankingCard oy navigatori** (prev/next + `picker="month"`).
   Bu oy-granularli tanlagich, kun/hafta tez-preseti emas — **doiradan tashqari**, saqlanadi (agar egasi boshqacha aytmasa).

**Umumiy natija:** ilovada hech qanday "kunlik/7/30/90 kun" segmented yoki chip tugma qolmaydi; sana bo'yicha har qanday filtr yagona `RangePicker` (from → to) orqali. `DateRangeControl` footer eslatmasi ("Toshkent kuni bo'yicha") saqlanadi.

---

## 5-BLOK — Sidebar (SideNav) dizaynini yangilash

**Auditda topilgan kamchiliklar → talab qilinadigan yaxshilanishlar:**

1. **Tema-invariant spine.** Hozir sidebar ikkala temada bir xil to'yingan royal-blue gradient (`--sb-sider-bg`), light rejimda deyarli oq `#f4f7fb` kanvas yonida qo'pol yuqori kontrastli slab bo'lib ko'rinadi. **Talab:** sidebarni temaga moslashtirish — light rejimda yumshoqroq/surface-ga yaqin variant, dark'da chuqur variant; yoki ataylab tanlangan yagona brand spine bo'lsa, uni light kanvas bilan uyg'unlashtirish (kontrastni yumshatish). Kod izohidagi "graphite, surface-colored per theme" da'vosi bilan haqiqat mos kelsin.
2. **Faol holat kontrasti.** Hozir tanlangan element past kontrastli yarim-shaffof oq pill (`rgba(255,255,255,.16)`) + ingichka `#7cb2ff` chap chiziq; hover (oq 8%) va selected (oq 16%) bir-biriga yaqin. **Talab:** tanlangan element aniq ajralib tursin (kuchliroq fon/urg'u/brand rangi), hover bilan farqi ravshan bo'lsin.
3. **`selectedKeys` mantig'i.** Hozir faqat birinchi segment (`'/' + pathname.split('/')[1]`) — chuqur/detail route'lar noto'g'ri yoritiladi. **Talab:** detail route'lar (`/clients/:id`, `/orders/:id` …) o'z ota bo'limini to'g'ri yoritadigan moslashtirish.
4. **Collapsed rail konteksti.** Hozir icon-only, **tooltip yo'q**, guruh ajratkichlari yo'q; AGENT/CASHIER flat ro'yxatlarida bo'lim yorliqlari yo'q. **Talab:** collapsed holatda har bir ikonaga Tooltip, guruhlar orasida vizual ajratkich.
5. **Worklist badge'lari.** `badge?: number` slot bor, lekin `TODO(worklists)` — hech qachon to'ldirilmagan. **Talab:** kutilayotgan ishlar sonini (masalan tasdiqlanmagan to'lovlar, muddati o'tgan qarzlar) badge sifatida ko'rsatish (ma'lumot mavjud bo'lsa) yoki slotni toza olib tashlash.
6. **Foydalanuvchi/hisob futeri.** Sidebar pastida account/foydalanuvchi zonasi yo'q, uzun nav (TA'MINOT 5 element) butun rail'ni skroll qiladi. **Talab:** pastda pinned foydalanuvchi bloki (ism/rol/chiqish) + skroll qismidan vizual ajralish.
7. **Soxta qidiruv "input".** Hozir input ko'rinishidagi tugma (yozib bo'lmaydi, faqat palette ochadi). **Talab:** yo halol tugma ko'rinishi (input emasligi ravshan), yo haqiqiy qidiruv.
8. **Uslub tokenizatsiyasi.** AppShell'dagi tarqoq inline stillar (`searchBtnStyle`, header, avatar, glyph, overline) CSS klass/token'larga ko'chiriladi.
9. **Brand glyph + wordmark** saqlanadi, lekin umumiy dizayn tili (radius, spacing, ranglar) yangi token shkalasiga bo'ysunadi.

---

## 6-BLOK — Dizayn tizimi va optimizatsiya

1. **Yagona manba: tokenlar.** Hozir ikki parallel qatlam — antd `token.*` (ConfigProvider) va `--sb-*` CSS o'zgaruvchilari — bo'sh sinxron (brand blue `colorPrimary` va `--sb-brand` ikki marta; `token.borderRadius` va `--sb-radius`). **Talab:** bitta manba — `--sb-*` tokenlarini `ConfigProvider` `theme.token`/`components`'ga bog'lash (yoki aksincha), takrorlanishni yo'qotish.
2. **Spacing shkalasi.** Rasmiy spacing tokeni yo'q (6/8/10/12/13/14/16/18/20/24 tarqoq). **Talab:** `--sb-space-1..N` shkalasini kiritish va utility klasslar/inline stillarni shunga ko'chirish.
3. **Radius shkalasi.** Aralash (10px sidebar, 12 `--sb-radius`, 16 `--sb-radius-lg`, 24 login, 4 chip). **Talab:** yagona radius shkalasi tokenlari.
4. **`!important` kamaytirish.** antd ichki elementlarini (`.ant-menu-*`, `.ant-table-*`, `.ant-drawer-*`) `!important` bilan bosib o'tish o'rniga imkoni boricha ConfigProvider `components` token'lari orqali. Qolgan majburiy override'lar izohlanadi.
5. **Dark rejim elevatsiyasi.** Dark'da `--sb-shadow-e1: none` — kartochkalar tekis/chegarasiz ko'rinadi. **Talab:** dark'da ham ko'zga ko'rinadigan yumshoq elevatsiya/ajratish.
6. **Perf/optimizatsiya:** mavjud lazy-loading va vendor-chunk saqlanadi; 27 ta takroriy `<Table>` bloklari `DataTable`'ga birlashib bundle va kod takrorini kamaytiradi; keraksiz re-render'lar (filtrlar URL-sinxron bo'lgach) kamayadi. `pnpm build` toza, tип-xatolar yo'q.
7. **Login/Landing uyg'unligi.** Login ekrani maksimalist (orblar, conic glow, glassmorphism), app shell esa vazmin. **Talab (ixtiyoriy/past ustuvorlik):** kamida brand rangi/tipografiyasini umumiy tilga yaqinlashtirish.

---

## Qabul mezonlari (Definition of Done)

- [ ] Har bir ro'yxat sahifasi: `PageHeader + TableCard + DataTable + FilterBar` (xom `<Table>`/lokal-state search qolmagan).
- [ ] Har bir ro'yxat sahifasida jadval **ustida** filtr bor va URL-sinxron.
- [ ] Ilovada birorta ham "kunlik/7/30/90 kun" preset tugma/segmented yo'q; sana filtri faqat `RangePicker` (from → to).
- [ ] Yaratish/tahrirlash hamma joyda `FormDrawer` (Ctrl+Enter, sticky footer).
- [ ] Sidebar: tema-moslashuvchan, aniq faol holat, collapsed tooltip'lar, to'g'ri selectedKeys, account futeri.
- [ ] Yagona token manbasi (antd token ↔ `--sb-*`), spacing/radius shkalasi, `!important` minimallashtirilgan.
- [ ] Light **va** dark rejim, collapsed **va** expanded sidebar — hammasi toza.
- [ ] `pnpm --filter web build` va E2E toza o'tadi; biznes-mantiq o'zgarmagan.

---

## Tavsiya etilgan ish tartibi (bosqichma-bosqich)

1. **Poydevor:** token shkalasi (spacing/radius), token manbasini birlashtirish, `DateRangeControl`'dan presetlarni olib tashlash (4-blok #1 — bir zarba bilan ko'p sahifa tozalanadi).
2. **Jadval standarti:** `DataTable + TableCard + FilterBar`'ni bitta namuna sahifada (masalan `Clients`) mukammal qilib, keyin qolgan sahifalarga tarqatish (1 + 2 + 3 bloklar birga, sahifama-sahifa).
3. **Dashboard/Debts/FactoryDetail date-preset'lari** (4-blok #2–5) — server shartnomasi qarorlaridan keyin.
4. **Sidebar redizayni** (5-blok).
5. **Sayqal + optimizatsiya** (6-blok), yakuniy build + E2E.

Har bosqich alohida commit; har commitdan oldin build + vizual tekshiruv (light/dark/collapsed).

---

## ⚠️ Ochiq qarorlar (egadan tasdiq kerak)

Quyidagilar server shartnomasiga tegadi — boshlashdan oldin qaror kerak:

1. **Dashboard TrendsChart** (`?days` → `?from&to`): endpoint o'zgartirilsinmi yoki `from/to`'dan client-side `days` hisoblansinmi? Trend grafigi tabiatan "oxirgi N kun" oynasi — sana-dan-sana bilan almashtirish mantiqan mos keladimi?
2. **Debts "kutilayotgan tushum" (`?days` prognoz):** bu kelajakka qaragan "N kun ichida muddati keladi" oynasi. Uni "muddat sanasi from→to" oynasiga aylantirish server tomonini yangilashni talab qiladi — tasdiqlanadimi?
3. **Payments "Bugungi kirimlar" saqlangan ko'rinishi:** saqlansinmi (saqlangan ko'rinish sifatida) yoki "kunlik tugma" sifatida olib tashlansinmi?
4. **RankingCard oy tanlagichi:** doiradan tashqari (oy-granular) — saqlansin deb faraz qilinmoqda; boshqacha bo'lsa ayting.
