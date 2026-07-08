# SmartBlok — Gazoblok CRM/ERP

Xorazm viloyatidagi **gazoblok (aerated concrete) ulgurji savdo va yetkazib berish**
biznesi uchun to'liq CRM/ERP tizimi. Biznesning qo'lda yuritilgan Excel hisob-kitobi
(`Газоблок Счет.xlsx`) to'liq raqamli tizimga ko'chirilgan: sotuv, to'lov, mijoz
qoldig'i, zavod bilan hisob-kitob, poddon boshqaruvi va ko'p-zavodli xarid optimizatsiyasi.

## Texnologiyalar

| Qism | Stack |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS v4 + Framer Motion |
| UI | TanStack Query, React Router, Recharts, lucide-react |
| Backend | NestJS (TypeScript) + Prisma ORM |
| Ma'lumotlar bazasi | SQLite (dev, sozlamasiz) → PostgreSQL (production) |
| Auth | JWT + rol asosidagi ruxsat (RBAC): Admin / Buxgalter / Agent |

Monorepo (npm workspaces): `apps/api` (backend), `apps/web` (frontend).

## Tez ishga tushirish

```bash
# 1. Bog'liqliklarni o'rnatish (root)
npm install

# 2. Ma'lumotlar bazasini yaratish + demo ma'lumot bilan to'ldirish
npm run db:setup

# 3. Backend + frontend ni birga ishga tushirish
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:4000/api

### Demo kirish

| Rol | Email | Parol |
|---|---|---|
| Administrator | admin@smartblok.uz | admin123 |
| Buxgalter | hisob@smartblok.uz | hisob123 |
| Agent (Jamol) | jamol@smartblok.uz | agent123 |

## Modullar

1. **Boshqaruv paneli** — KPI kartalari (jami sotuv, foyda, mijoz qarzi, zavod qoldig'i,
   poddon qoldig'i), sotuv/foyda dinamikasi, agentlar reytingi.
2. **Sotuvlar (Товар)** — har yozuv = bitta mashina yuki; marja va foyda **avtomatik** hisoblanadi.
3. **To'lovlar (Оплата)** — naqd / Click / terminal / dollar (kurs bilan) / o'tkazma.
4. **Mijozlar** — qoldiq (qarz), avtomatik **hisob-varaqa** (statement) drawer, poddon qoldig'i.
5. **Agentlar** — profil va ko'rsatkichlar (guruh 1–6).
6. **Zavod narxlari — tannarx matritsasi** — ko'p zavod (Navoiy, Arton, Samarkand, KKG…)
   × hudud bo'yicha **Klientgacha (landed cost)** hisobi va eng arzon manba tavsiyasi.
7. **Poddonlar** — berilgan/qaytarilgan/qoldiq (zalog/qaytim tizimi).
8. **Hisobot (Свод Завод)** — agentlar yakuni + zavod bilan solishtiruv.

## Asosiy biznes formulalar

| Ko'rsatkich | Formula |
|---|---|
| Sotuv summasi | `Hajm(m³) × Sotuv narxi` |
| Foyda | `Sotuv − Kirim − Poddon − Transport` |
| Mijoz qoldig'i | `Σ to'lovlar − Σ yetkazishlar` (manfiy = qarzdor) |
| Zavod qoldig'i | `Σ tovar tannarxi − Σ zavodga to'lovlar` |
| Poddon qoldig'i | `berilgan − qaytarilgan` |
| **Klientgacha (landed cost)** | `zavod narxi + logistika ÷ mashina m³` |
| Bonusdan keyingi tannarx | `landed × (1 − diller bonusi)` |

**Klientgacha tekshiruvi (Xorazm Beruniy)** — tizim quyidagilarni aynan qaytaradi:
Navoiy → 767 647 · Arton → 779 412 · Samarkand → 740 000 · KKG o'tkazma → 700 758 ·
KKG naqd → 620 758 (eng arzon).

## Loyiha tuzilishi

```
smartblok/
├── apps/
│   ├── api/                 # NestJS backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── seed.ts
│   │   └── src/
│   │       ├── auth/        # JWT + RBAC
│   │       ├── agents/ clients/ regions/ block-sizes/ factories/
│   │       ├── procurement/ # landed-cost matrix
│   │       ├── sales/ payments/ pallets/ factory-payments/
│   │       ├── dashboard/ reports/
│   │       └── prisma/      # PrismaService
│   └── web/                 # React + Vite frontend
│       └── src/
│           ├── components/  # Layout, Sidebar, ui/ (Card, KpiCard, Modal…)
│           ├── pages/       # Dashboard, Sales, Payments, Clients…
│           ├── auth/  lib/
│           └── index.css    # Tailwind v4 design tokens
└── package.json             # npm workspaces
```

## API (asosiy endpointlar)

Barcha endpointlar `/api` prefiksi bilan; auth talab qilinadi (Bearer JWT).

```
POST /auth/login            # kirish
GET  /dashboard/summary     # KPI
GET  /procurement/matrix?regionId=1   # tannarx matritsasi
GET  /reports/svod          # Свод Завод
GET  /reports/client/:id/statement    # mijoz hisob-varaqasi
CRUD /agents /clients /sales /payments /factories ...
```

Rol cheklovlari backendda (NestJS guards) — agent faqat o'z mijozlari/sotuvlarini ko'radi.

## Production (PostgreSQL)

Dev SQLite dan Postgresga o'tish:

1. `apps/api/prisma/schema.prisma` da `datasource db { provider = "postgresql" }`
2. `DATABASE_URL` ni Postgres connection string ga o'zgartiring
3. `docker compose up -d db` (yoki o'z Postgres serveringiz)
4. `npm run db:setup`

`docker-compose.yml` faylida Postgres xizmati keltirilgan.

## Skriptlar

| Buyruq | Vazifa |
|---|---|
| `npm run dev` | API + web birga (dev) |
| `npm run build` | ikkalasini build qilish |
| `npm run db:setup` | Prisma generate + schema push + seed |
| `npm run seed` | faqat demo ma'lumotni qayta yuklash |

---

> Ushbu tizim `Газоблок Счет.xlsx` faylidagi barcha jarayonlarni qamrab oladi va uning
> ustiga ko'p-zavodli xarid optimizatsiyasini qo'shadi. Barcha qoldiq/foyda qiymatlari
> tranzaksiyalardan real vaqtda hisoblanadi — qo'lda kiritilmaydi.
