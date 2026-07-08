# SmartBlok — Gazoblok CRM/ERP

Xorazm viloyatidagi **gazoblok (aerated concrete) ulgurji savdo va yetkazib berish**
biznesi uchun to'liq CRM/ERP tizimi. Biznesning qo'lda yuritilgan Excel hisob-kitobi
(`Газоблок Счет.xlsx`) to'liq raqamli tizimga ko'chirilgan: sotuv, to'lov, kassa, mijoz
qoldig'i, zavod bilan hisob-kitob, poddon boshqaruvi va ko'p-zavodli xarid optimizatsiyasi.

## Texnologiyalar

| Qism | Stack |
|---|---|
| Frontend | React + Vite + TypeScript + **Tailwind CSS v4** + **Framer Motion** |
| UI | TanStack Query, React Router, Recharts, lucide-react, ⌘K command palette |
| Backend | **NestJS** (TypeScript) + Prisma ORM |
| Ma'lumotlar bazasi | SQLite (dev, sozlamasiz) → PostgreSQL (production) |
| Auth | JWT + rol asosidagi ruxsat (RBAC): Admin / Buxgalter / Agent / Kassir |

Dizayn: **Teal + Amber + Slate** palitrasi, to'liq light/dark rejim, semantik token qatlami.

## Tez ishga tushirish

```bash
npm install          # bog'liqliklar (root, npm workspaces)
npm run db:setup     # baza + demo ma'lumot
npm run dev          # backend (4000) + frontend (5173)
```

- Frontend: http://localhost:5173 · API: http://localhost:4000/api

### Demo kirish (rollar)

| Rol | Email | Parol | Ko'radi |
|---|---|---|---|
| Administrator | admin@smartblok.uz | admin123 | Hamma narsa |
| Buxgalter | hisob@smartblok.uz | hisob123 | Moliya + hisobot |
| Agent | jamol@smartblok.uz | agent123 | Faqat o'z mijozlari/sotuvlari |
| Kassir | kassa@smartblok.uz | kassa123 | Kassa + to'lovlar |

## Modullar

1. **Boshqaruv paneli** — rolga moslashgan KPI kartalar, sotuv/foyda grafiklari, agent reytingi. Kassir uchun alohida kassa paneli.
2. **Sotuvlar (Товар)** — mashina-yuk; marja va foyda avtomatik; eng arzon tannarx taklifi.
3. **To'lovlar (Оплата)** — naqd / Click / terminal / dollar / o'tkazma → **kassaga avtomatik tushadi**.
4. **Mijozlar** — qoldiq, avtomatik hisob-varaqa (statement) drawer, poddon qoldig'i, jonli qidiruv + eksport.
5. **Agentlar** — profil va ko'rsatkichlar (guruh 1–6).
6. **Zavod narxlari — tannarx matritsasi** — ko'p zavod × hudud bo'yicha Klientgacha (landed cost) va eng arzon manba.
7. **Poddonlar** — berilgan/qaytarilgan/qoldiq (zalog tizimi).
8. **Kassalar** — Naqt kassa (so'm), **Naqt kassa (dollar)**, Click kassa, Bank kassa; kirim/chiqim, balans.
9. **Hisobot (Свод Завод)** — agentlar yakuni + zavod bilan solishtiruv.
10. **Foydalanuvchilar** — rol boshqaruvi (Admin), CRUD.
11. **Excel import** — `Газоблок Счет.xlsx` ni yuklab, bazani to'ldirish (Товар→sotuv, Оплата→to'lov, Оплата Завод→zavod to'lovi).

## Excel import

`Tizim → Excel import` sahifasida faylni yuklang. "Almashtirish (0 dan)" yoqilgan bo'lsa,
eski tranzaksiyalar o'chirilib, fayldagi bilan qayta yoziladi. Agent/mijoz/zavod/o'lchamlar
avtomatik yaratiladi. Test: real fayl importi 56 sotuv, 25 to'lov, jami 1 249 547 319 so'm —
Excel yakuni bilan **aynan** mos.

## Asosiy biznes formulalar

| Ko'rsatkich | Formula |
|---|---|
| Sotuv summasi | `Hajm(m³) × Sotuv narxi` |
| Foyda | `Sotuv − Kirim − Poddon − Transport` |
| Mijoz qoldig'i | `Σ to'lovlar − Σ yetkazishlar` (manfiy = qarzdor) |
| Zavod qoldig'i | `Σ tovar tannarxi − Σ zavodga to'lovlar` |
| Poddon qoldig'i | `berilgan − qaytarilgan` |
| **Klientgacha (landed cost)** | `zavod narxi + logistika ÷ mashina m³` |
| Kassa balansi | `Σ kirim − Σ chiqim` |

## Loyiha tuzilishi

```
smartblok/
├── apps/
│   ├── api/   (NestJS) — auth, agents, clients, regions, block-sizes, factories,
│   │          procurement, sales, payments, pallets, factory-payments, dashboard,
│   │          reports, users, kassa, import
│   └── web/   (React+Vite) — components/ui (EntityTable, KpiCard, Modal, Drawer,
│              MoneyInput, Toaster…), components (Layout, Sidebar, CommandPalette),
│              pages, lib (api, nav, format)
└── package.json  (npm workspaces)
```

## Skriptlar

| Buyruq | Vazifa |
|---|---|
| `npm run dev` | API + web birga (dev) |
| `npm run build` | ikkalasini build qilish |
| `npm run db:setup` | Prisma generate + schema push + seed |
| `npm run seed` | demo ma'lumotni qayta yuklash |

## Production (PostgreSQL)

`apps/api/prisma/schema.prisma` da `provider = "postgresql"`, `DATABASE_URL` ni o'zgartiring,
`docker compose up -d db`, so'ng `npm run db:setup`.

---

> Barcha qoldiq/foyda/kassa qiymatlari tranzaksiyalardan real vaqtda hisoblanadi — qo'lda
> kiritilmaydi. Rollar backendda (NestJS guards) va frontendda ham cheklangan.
