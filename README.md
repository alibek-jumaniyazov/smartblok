# SmartBlok — Gazoblok CRM/ERP

Xorazm viloyatidagi **gazoblok (aerated concrete) ulgurji savdo va yetkazib berish**
biznesi uchun to'liq CRM/ERP tizimi: sotuv → zavod → yetkazish → to'lov bitta zanjirda,
mijoz/agent/zavod qoldiqlari, kassa va bank, poddon (zalog) boshqaruvi, bonus hamyon va
transport foydasi. Har bir pul harakati **ikki tomonlama (double-entry) ledger**ga
yoziladi — qoldiq/foyda qiymatlari doim tranzaksiyalardan real vaqtda hisoblanadi.

## Texnologiyalar

| Qism | Stack |
|---|---|
| Frontend | React 18 + Vite + TypeScript + **Ant Design v6** |
| UI | TanStack Query, React Router, **@ant-design/plots** (grafiklar), @ant-design/icons, ⌘K command palette, socket.io-client (jonli yangilanish) |
| Backend | **NestJS 10** (TypeScript) + Prisma ORM + WebSocket (socket.io) |
| Ma'lumotlar bazasi | **PostgreSQL** (Decimal pul, ledger asosli) |
| Auth | JWT + username login + RBAC: Admin / Buxgalter / Kassir / Agent |

## Tez ishga tushirish (dev)

```bash
npm install          # bog'liqliklar (root, npm workspaces)
npm run dev          # predev: lokal Postgres (.pgdata, :5433) + migratsiya + seed
                     # so'ng API (:4000) + web (:5173) birga ishga tushadi
```

`predev` bosqichi (`scripts/ensure-env-db.mjs`) lokal PostgreSQL klasterni `.pgdata`
ichida `5433` portda avtomatik ko'taradi, `apps/api/.env` faylini yozadi, migratsiyalarni
qo'llaydi va seed qiladi. Qo'lda hech narsa sozlash shart emas.

- Frontend: http://localhost:5173 · API: http://localhost:4000/api · Health: http://localhost:4000/api/health

### Demo kirish (rollar)

| Rol | Login | Parol | Ko'radi |
|---|---|---|---|
| Administrator | admin | admin123 | Hamma narsa |
| Buxgalter | hisob | hisob123 | Moliya + hisobot |
| Kassir | kassa | kassa123 | Kassa + to'lovlar |
| Agent | jamol | agent123 | Faqat o'z mijozlari/sotuvlari |

> Demo hisoblar faqat dev/demo build'da ko'rinadi va faqat `NODE_ENV≠production`
> (yoki `SEED_DEMO_USERS=1`) bo'lganda seed qilinadi.

## Modullar

1. **Boshqaruv paneli** — rolga moslashgan KPI kartalar, davr bo'yicha sof foyda (tovar + transport), sotuv/foyda grafiklari, agent reytingi; kassir uchun alohida kassa paneli.
2. **Buyurtmalar** — mashina-yuk, provizion tannarx, zavod to'lovi allokatsiyasida tannarx **qotiriladi** (cash/bank narx farqi), soft-cancel (reversal).
3. **To'lovlar** — CLIENT_IN / FACTORY_OUT / VEHICLE_OUT / TRANSPORT_DIRECT, USD (kurs bilan), idempotentlik, void (kompensatsiya), kassaga avtomatik yozuv.
4. **Mijozlar** — qoldiq, statement (hisob-varaqa), poddon qoldig'i, kredit limiti, jonli qidiruv + eksport.
5. **Agentlar** — profil, ko'rsatkichlar, qarz limiti gate'i.
6. **Zavodlar / narxlar** — versiyalangan narx kitobi (FACTORY_CASH/BANK/DEALER_SALE), bonus dastur.
7. **Poddonlar** — berilgan/qaytarilgan/yo'qolgan (in-kind zalog tizimi).
8. **Bonus** — versiyalangan zavod bonusi, accrual → withdraw / debt-offset / reversal.
9. **Kassa / Bank** — kassa turlari (naqd, bank, click, terminal, karta, USD), kirim/chiqim, hech qachon manfiy bo'lmaslik kafolati.
10. **Qarzlar** — mijoz/zavod/mashina qoldiqlari, yig'ma summary.
11. **Foydalanuvchilar / Sozlamalar** — rol boshqaruvi (Admin), tizim sozlamalari.

## Asosiy biznes formulalar

| Ko'rsatkich | Formula |
|---|---|
| Sotuv summasi | `Hajm(m³) × Sotuv narxi` (yoki lump-sum) |
| Mijoz qoldig'i | `Σ CLIENT ledger postings` (>0 = qarzdor) |
| Zavod qoldig'i | `Σ FACTORY ledger postings` |
| Poddon qoldig'i | `berilgan − qaytarilgan − yo'qolgan` |
| Kassa balansi | `Σ kirim − Σ chiqim` |
| Bonus hamyon | `Σ BonusTransaction (signed)` |

## Skriptlar

| Buyruq | Vazifa |
|---|---|
| `npm run dev` | API + web birga (dev), lokal Postgres bootstrap bilan |
| `npm run build` | ikkalasini build qilish (api → dist, web → dist) |
| `npm start` | **prod**: migratsiyani qo'llaydi va API'ni ishga tushiradi (SPA'ni same-origin xizmat qiladi) |
| `npm run db:setup` | Prisma generate + migrate deploy + seed |
| `npm run db:reset` | bazani to'liq tozalab qayta migratsiya + seed (`migrate reset --force`) |
| `npm run seed` | platforma prerekvizitlarini qayta yuklash |

## Production

1. `.env` ni sozlang (`.env.example` ga qarang): `DATABASE_URL` (PostgreSQL), uzun `JWT_SECRET`, `NODE_ENV=production`, `CORS_ORIGIN` (majburiy), kerak bo'lsa `TRUST_PROXY_HOPS`.
2. `npm run build` — API va SPA build qilinadi.
3. `npm start` — migratsiyalar qo'llanadi (`prisma migrate deploy`) va API ishga tushadi. API `apps/web/dist` ni **same-origin** xizmat qiladi (`/api` bundan mustasno), shu sababli frontend qo'shimcha reverse-proxy'siz ishlaydi.
4. Health probe: `GET /api/health` (autentifikatsiyasiz, DB holatini tekshiradi).

> ⚠️ **`prisma db push` ISHLATMANG** — `order_no_seq` sequence va PaymentAllocation
> active-pair partial unique index faqat raw SQL migratsiyalarda. Har doim
> `prisma migrate deploy` (yoki `migrate reset`) ishlating.

## Loyiha tuzilishi

```
smartblok/
├── apps/
│   ├── api/   NestJS — auth, agents, clients, factories, products, vehicles,
│   │          orders, payments, pallets, bonus, kassa, debts, dashboard, users,
│   │          settings; common/ (ledger, pricing, transport, money, realtime)
│   └── web/   React + Vite + AntD — pages/, components/, lib/ (api, format, types)
├── scripts/ensure-env-db.mjs   dev Postgres bootstrap
└── package.json                npm workspaces
```

---

> Barcha qoldiq / foyda / kassa qiymatlari immutable ledger postinglardan real vaqtda
> hisoblanadi — qo'lda kiritilmaydi. Rollar backendda (NestJS default-deny guards) va
> frontendda ham cheklangan.
