# 2. Tizim arxitekturasi va texnologiyalar

Loyiha: SmartBlok CRM/ERP | Hujjat: Texnik topshiriq (TZ) | Versiya: 1.0 | Sana: 2026-07-09 | Branch: main (v2 order-lifecycle)

---

## 2.1. Umumiy arxitektura sharhi

SmartBlok CRM/ERP — gazoblok (yacheykali beton) ulgurji distribyutsiyasi uchun moljallangan toliq stekli (full-stack) veb-ilova. Tizim **monorepo** modelida qurilgan boldib, ikki mustaqil ilovadan iborat:

- **`apps/api`** — NestJS asosidagi backend (REST API), biznes-mantiq va malumotlar bazasi bilan ishlash uchun yagona javobgar qatlam.
- **`apps/web`** — React + Vite asosidagi bir sahifali ilova (SPA), foydalanuvchi interfeysi.

Arxitektura klassik uch qatlamli (three-tier) modelga amal qiladi: **taqdimot qatlami** (browser/React), **amaliyot mantigi qatlami** (NestJS xizmatlari), **malumotlar qatlami** (Prisma ORM + SQLite/PostgreSQL). Barcha biznes-hisoblar (qarzlar, foyda, tannarx matritsasi, kassa balansi) faqat **backendda** amalga oshiriladi; frontend faqat tayyor qiymatlarni koradi va koda faqat mahalliy koʻrsatuv-hisoblarni (masalan, USD × kurs oldindan koʻrsatish) bajaradi.

### 2.1.1. Komponentlar diagrammasi

```mermaid
flowchart LR
    subgraph Client["Foydalanuvchi qurilmasi"]
        B["Browser<br/>(React SPA)"]
    end

    subgraph Web["apps/web — Vite dev server (:5173)"]
        R["React 18 + TS<br/>TanStack Query<br/>React Router"]
    end

    subgraph API["apps/api — NestJS (:4000)"]
        M["main.ts<br/>global prefiks /api<br/>CORS + ValidationPipe"]
        F["Feature modullar<br/>(Auth, Orders, Payments...)"]
        P["PrismaService<br/>(@Global)"]
    end

    subgraph DB["Malumotlar bazasi"]
        S["SQLite (dev)<br/>file:./dev.db"]
        PG["PostgreSQL (prod)<br/>docker-compose"]
    end

    B -->|HTTP /api| R
    R -->|"axios, Bearer JWT<br/>proxy /api → :4000"| M
    M --> F
    F --> P
    P -->|Prisma Client| S
    P -.->|migratsiya orqali| PG
```

Diqqat: `apps/web` dev rejimida `/api` yoʻlini `http://localhost:4000` ga **proxy** qiladi (`vite.config.ts`). Ishlab chiqarishda esa `VITE_API_URL` muhit oʻzgaruvchisi orqali toʻgʻridan-toʻgʻri backend URL koʻrsatiladi.

---

## 2.2. Monorepo tuzilishi

Loyiha ildizi **npm workspaces** yordamida boshqariladi (ildiz `package.json`, `name: "smartblok"`, `v1.0.0`). Workspaces roʻyxati:

```
smartblok/
├── package.json          # ildiz: workspaces, umumiy skriptlar
├── docker-compose.yml    # ixtiyoriy PostgreSQL (prod)
├── .env.example          # muhit oʻzgaruvchilari namunasi
├── apps/
│   ├── api/              # @smartblok/api — NestJS backend
│   │   ├── prisma/       # schema.prisma, seed.ts
│   │   ├── src/          # feature modullar
│   │   ├── nest-cli.json
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── web/              # @smartblok/web — React SPA
│       ├── src/
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
└── docs/                 # texnik hujjatlar (ushbu TZ)
```

### 2.2.1. Ildiz darajasidagi skriptlar

| Skript | Buyruq | Vazifasi |
|---|---|---|
| `dev` | `concurrently -n api,web -c blue,magenta` | Backend va frontend'ni **parallel** ishga tushiradi |
| `build` | avval `api`, keyin `web` | Ikkala ilovani ketma-ket build qiladi |
| `db:setup` | `api` workspace'ga delegatsiya | Prisma sxemasini generatsiya + push + seed |
| `seed` | `api` workspace'ga delegatsiya | Faqat demo malumotni yuklaydi |

**Muhit talablari:** `engines.node >= 20`. Ildiz devDependency: `concurrently ^9.1.0`.

---

## 2.3. Backend: NestJS arxitekturasi

Backend **NestJS 10** freymvorkida qurilgan. Har bir domen alohida **feature modul** sifatida ajratilgan (`Controller` + `Service` + `Module` uchligi). Barcha modullar `PrismaService` orqali malumotlar bazasiga kiradi.

### 2.3.1. Ildiz modul (`app.module.ts`)

Ildiz modul quyidagilarni birlashtiradi:

- `ConfigModule.forRoot({ isGlobal: true })` — muhit oʻzgaruvchilarini global taʼminlaydi.
- `PrismaModule` — `@Global()` deb belgilangan, shuning uchun boshqa modullar uni alohida import qilmasdan `PrismaService` dan foydalanadi.
- 20 ta feature modul.

### 2.3.2. Feature modullar roʻyxati va vazifalari

| Modul | Yoʻl (`/api/...`) | Asosiy vazifasi |
|---|---|---|
| **Auth** | `/auth` | Login, JWT imzolash, profil (me) oʻqish/yangilash |
| **Users** | `/users` | Foydalanuvchilar CRUD (faqat `ADMIN`) |
| **Agents** | `/agents` | Agentlar CRUD, savdo/foyda/yigʻilgan toʻlov agregatsiyasi, avtomatik login-user yaratish |
| **Clients** | `/clients` | Mijozlar CRUD, qoldiq (balance) hisobi, statement, AGENT skoping |
| **Regions** | `/regions` | Hududlar CRUD (oddiy maʼlumotnoma) |
| **Factories** | `/factories` | Zavodlar CRUD, "biz zavodga qancha qarzdormiz" hisobi |
| **Products** | `/products` | Mahsulotlar CRUD, zavod boʻyicha filtr |
| **Vehicles** | `/vehicles` | Moshinalar CRUD, transport qarzi hisobi |
| **Procurement** | `/procurement` | Tannarx matritsasi (landed cost), narx va marshrut CRUD |
| **Orders** | `/orders` | Buyurtma hayot-sikli, totals hisobi, status boshqaruvi |
| **Payments** | `/payments` | Toʻlovlar (CLIENT/FACTORY/VEHICLE), kassaga avtomatik posting |
| **Kassa** | `/kassa` | Kassalar, balans, qoʻlda kirim/chiqim, tranzaksiyalar |
| **Expenses** | `/expenses` | Xarajatlar va kategoriyalar CRUD, kassaga chiqim posting |
| **Debts** | `/debts` | Koʻp tomonlama qarzlar xulosasi (read-only agregatsiya) |
| **Dashboard** | `/dashboard` | KPI, sotuv trendi, agent reytingi, funnel (read-only) |
| **Reports** | `/reports` | Svod hisoboti (agentlar yakuni + zavod jamlari) |
| **Import** | `/import` | Excel (xlsx) faylni oʻqib buyurtma/toʻlov yaratish |

> Modullararo bogʻliqlik minimal: har modul faqat oʻzining `Service`+`Controller`+`Module` uchligini eʼlon qiladi, tashqi import qoʻymaydi (PrismaModule global boʻlgani uchun). Bu past bogʻlanishli (loosely coupled) modul arxitekturasini taʼminlaydi.

### 2.3.3. Bootstrap konfiguratsiyasi (`main.ts`)

Backend ishga tushishida quyidagi global sozlamalar qoʻllanadi:

- **Global prefiks:** `app.setGlobalPrefix('api')` — barcha endpointlar `/api/...` bilan boshlanadi.
- **CORS:** `origin = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')`, `credentials: true`. Vergul bilan ajratilgan bir nechta origin qoʻllab-quvvatlanadi.
- **Global ValidationPipe:**
  - `whitelist: true` — DTO'da eʼlon qilinmagan maydonlar tashlab yuboriladi.
  - `transform: true`, `transformOptions: { enableImplicitConversion: true }` — kirish avtomatik moslashtiriladi.
  - Eslatma: `forbidNonWhitelisted` oʻrnatilmagan (notanish maydon xato bermaydi, faqat tashlab yuboriladi).
- **Port:** `Number(process.env.API_PORT) || 4000`.
- Fayl boshida `import 'reflect-metadata'` (dekoratorlar metama'lumoti uchun).

> Muhim meʼmoriy tanlov: **global guard yoʻq**. Autentifikatsiya va rol tekshiruvi har bir controllerda alohida `@UseGuards(JwtAuthGuard, RolesGuard)` va `@Roles(...)` dekoratorlari orqali qoʻyiladi. Batafsil RBAC modeli uchun **3-bob. Autentifikatsiya va ruxsatlar**ga qarang.

### 2.3.4. Backend build va TypeScript sozlamalari

- **`nest-cli.json`:** `sourceRoot: src`, `compilerOptions.deleteOutDir: true`.
- **`tsconfig.json`:** `module: commonjs`, `target: ES2021`, `emitDecoratorMetadata: true`, `experimentalDecorators: true`, `strictNullChecks: true`, `noImplicitAny: false`, `esModuleInterop: true`, `outDir: ./dist`.
- `exclude` roʻyxatida `prisma/seed.ts` bor — seed `nest build` bilan kompilatsiya qilinmaydi, u alohida `tsx` orqali ishlaydi.

---

## 2.4. Frontend: React + Vite + TypeScript

Frontend `@smartblok/web` (`v1.0.0`, `private: true`, `type: "module"`) — Vite asosidagi React SPA.

### 2.4.1. Texnologiya steki

| Paket | Versiya | Vazifasi |
|---|---|---|
| `react` / `react-dom` | `^18.3.1` | UI kutubxonasi |
| `react-router-dom` | `^6.28.1` | Marshrutlash (client-side routing) |
| `@tanstack/react-query` | `^5.62.11` | Server holati / kesh / data fetching |
| `axios` | `^1.7.9` | HTTP klient (JWT interceptor bilan) |
| `recharts` | `^2.15.0` | Grafiklar (Dashboard/Reports) |
| `framer-motion` | `^11.15.0` | Animatsiyalar va sahifa oʻtishlari |
| `lucide-react` | `^0.469.0` | Ikonkalar |
| `clsx` | `^2.1.1` | Shartli CSS klasslar |

**DevDependencies:** `vite ^6.0.7`, `@vitejs/plugin-react ^4.3.4`, `typescript ^5.7.3`, `tailwindcss ^4.0.0` + `@tailwindcss/vite ^4.0.0`.

> Muhim: **Tailwind CSS v4** (yangi engine, `@import "tailwindcss"` + `@theme` sintaksisi). Global holat boshqaruvi uchun Redux/Zustand ishlatilmagan — faqat React Context (Auth, Toaster) + TanStack Query.

### 2.4.2. Frontend skriptlari

| Skript | Buyruq | Izoh |
|---|---|---|
| `dev` | `vite` | Dev server (:5173) |
| `build` | `tsc --noEmit && vite build` | Build oldidan type-check **majburiy** |
| `preview` | `vite preview --port 5173` | Build natijasini koʻrish |

### 2.4.3. Vite konfiguratsiyasi va data qatlami

- **Dev port:** 5173. **Proxy:** `/api` → `http://localhost:4000` (`changeOrigin: true`).
- **API klient (`lib/api.ts`):** `baseURL = import.meta.env.VITE_API_URL || '/api'`.
  - Request interceptor: `localStorage.sb_token` bor boʻlsa `Authorization: Bearer <token>` qoʻshadi.
  - Response interceptor: **401** javob (va yoʻl `/login` boʻlmasa) → `sb_token`/`sb_user` tozalanadi va `/login` ga majburiy yoʻnaltiriladi.
- **TanStack Query global sozlamalari:** `refetchOnWindowFocus: false`, `retry: 1`, `staleTime: 30_000` (30 soniya).
- **localStorage kalitlari:** `sb_token` (JWT), `sb_user` (JSON user), `sb_theme` (mavzu).

> Frontend marshrut darajasida **rol tekshiruvi yoʻq** — `Protected` guard faqat token/user borligini tekshiradi. Rolga asoslangan koʻrinish faqat navigatsiya menyusida (`nav.ts`) filtrlanadi. Haqiqiy himoya backend `@Roles` orqali taʼminlanadi. UI qatlamining toʻliq tavsifi uchun **5-bob. Foydalanuvchi interfeysi**ga qarang.

---

## 2.5. Malumotlar bazasi va Prisma ORM

### 2.5.1. Ikki muhitli strategiya

Tizim ikki xil DBMS ni qoʻllab-quvvatlaydi, ammo bitta Prisma sxemasi orqali:

| Muhit | DBMS | `DATABASE_URL` | Migratsiya usuli |
|---|---|---|---|
| **Development** | SQLite | `file:./dev.db` | `prisma db push` (migratsiyasiz) |
| **Production** | PostgreSQL 16 | `postgresql://smartblok:smartblok@localhost:5432/smartblok?schema=public` | sxemada `provider` ni oʻzgartirib push |

**Prisma:** `@prisma/client ^5.22`, generator `prisma-client-js`. Barcha `id` maydonlari **opak UUID** (`@default(uuid())`) — ketma-ket raqamlash yoʻq (sxema izohi: "no sequential enumeration"). Bu obyekt IDʻlarini taxmin qilib boʻlmasligini taʼminlaydi.

> **Muhim eslatma:** SQLite'da haqiqiy Prisma `enum` qoʻllab-quvvatlanmaydi. Shu sababli barcha "turlar" (role, status, payment type/method, direction, source, currency) `String` maydonlar sifatida saqlanadi; ruxsat etilgan qiymatlar faqat sxema izohlarida va servis kodidagi qoʻlbola tekshiruvlarda mavjud. Toʻliq malumotlar modeli va model diagrammasi uchun **4-bob. Malumotlar modeli**ga qarang.

### 2.5.2. Prisma xizmati (`PrismaService`)

- `PrismaService` `PrismaClient` dan meros oladi, `@Injectable()`, `OnModuleInit`.
- `onModuleInit()` da `this.$connect()` chaqiriladi.
- `PrismaModule` `@Global()` deb belgilangan — barcha modullarga avtomatik taʼminlanadi.
- Eslatma: graceful shutdown (`onModuleDestroy` / `enableShutdownHooks`) amalga oshirilmagan.

### 2.5.3. Migratsiya va urugʻlantirish (seed)

Loyihada **rasmiy migration skriptlari yoʻq** — SQLite uchun `prisma db push` (sxemani migratsiyasiz push qilish) ishlatiladi. Backend paketi skriptlari:

| Skript | Buyruq | Vazifasi |
|---|---|---|
| `prisma:generate` | `prisma generate` | Prisma Client generatsiyasi |
| `db:push` | `prisma db push --skip-generate` | Sxemani DB ga push |
| `db:setup` | `prisma generate && prisma db push --skip-generate && tsx prisma/seed.ts` | Toʻliq sozlash (generate + push + seed) |
| `seed` | `tsx prisma/seed.ts` | Demo malumotni yuklash |

**Seed (`prisma/seed.ts`):** demo malumotlarni yaratadi (5 hudud, 5 zavod, 4 mahsulot, 7 agent, 4 foydalanuvchi, 13 mijoz, 3 moshina, 4 kassa, 10 buyurtma, 10 toʻlov, 3 xarajat). Avval barcha jadvallar FK tartibida `deleteMany()` bilan tozalanadi. Parollar `bcrypt.hash(p, 10)` bilan xeshlanadi. Ishga tushirish: `tsx prisma/seed.ts`. Demo hisoblar va boshlangʻich malumotlar toʻgʻrisida **4-bob**da batafsil.

---

## 2.6. Muhit oʻzgaruvchilari (`.env`)

Loyihada `.env.example` namuna fayli mavjud. Backend va frontend uchun barcha sozlamalar quyidagi jadvalда:

| Oʻzgaruvchi | Ilova | Namuna qiymati | Vazifasi |
|---|---|---|---|
| `DATABASE_URL` | API | `file:./dev.db` | DB ulanish satri (prod: `postgresql://...`) |
| `JWT_SECRET` | API | `change-me-in-production-please-...` | JWT imzolash kaliti |
| `JWT_EXPIRES_IN` | API | `7d` | Token amal qilish muddati |
| `API_PORT` | API | `4000` | Backend porti |
| `CORS_ORIGIN` | API | `http://localhost:5173` | Ruxsat etilgan origin(lar) |
| `VITE_API_URL` | WEB | `http://localhost:4000/api` | Frontend uchun API bazaviy URL |

> Xavfsizlik eslatmasi: `JWT_SECRET` va demo parollar (`admin123` va h.k.) ishlab chiqarishda majburiy almashtirilishi kerak. Kod ichida `JWT_SECRET` uchun hardcoded fallback (`'dev-secret-change-me'`) mavjud — bu faqat dev qulayligi uchun.

---

## 2.7. Deployment (ishga tushirish)

### 2.7.1. Lokal ishlab chiqish oqimi

```mermaid
flowchart TD
    A["npm install<br/>(ildizda, workspaces)"] --> B["npm run db:setup<br/>(generate + push + seed)"]
    B --> C["npm run dev"]
    C --> D["concurrently"]
    D --> E["API :4000<br/>nest start --watch"]
    D --> F["WEB :5173<br/>vite"]
    F -->|"proxy /api"| E
```

Development uchun hech qanday tashqi DBMS talab qilinmaydi — SQLite fayl (`dev.db`) avtomatik yaratiladi.

### 2.7.2. Production PostgreSQL (`docker-compose.yml`)

Ishlab chiqarish uchun ixtiyoriy PostgreSQL konteyneri taqdim etilgan:

- **Servis:** `db`, image `postgres:16-alpine`, container nomi `smartblok-db`.
- **Restart siyosati:** `unless-stopped`.
- **Kirish maʼlumotlari:** `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` = `smartblok`.
- **Port:** `5432:5432`.
- **Volume:** `smartblok_pgdata:/var/lib/postgresql/data` (maʼlumotlar barqarorligi).

PostgreSQL ga oʻtish uchun: (1) `schema.prisma` da `datasource.provider` ni `"postgresql"` ga oʻzgartirish, (2) `DATABASE_URL` ni PostgreSQL satriga sozlash, (3) `prisma db push` bajarish.

### 2.7.3. Frontend build va joylashtirish

Frontend `npm run build` (`tsc --noEmit && vite build`) orqali statik fayllarga (`dist/`) kompilatsiya qilinadi. Ishlab chiqarishda `VITE_API_URL` orqali backend URL koʻrsatiladi (dev proxy oʻrniga).

---

## 2.8. Meʼmoriy prinsiplar va cheklovlar (xulosa)

Ushbu bobda tavsiflangan arxitekturaning asosiy xususiyatlari:

1. **Modul-asoslangan backend:** har domen mustaqil NestJS moduli; PrismaModule global.
2. **Opak UUID identifikatorlar:** barcha `id` — UUID, ketma-ket raqamlash yoʻq.
3. **Bitta sxema, ikki DBMS:** SQLite (dev, migratsiyasiz push) → PostgreSQL (prod).
4. **String-asoslangan "enum"lar:** SQLite cheklovi tufayli barcha turlar `String`; validatsiya servis darajasida.
5. **Backend-markazlashgan hisoblar:** barcha moliyaviy hisoblar (qarz, foyda, tannarx, kassa) faqat backendda; frontend faqat koʻrsatadi.
6. **JWT + bcrypt autentifikatsiya:** stateless token (7 kun), parollar bcrypt (10 rounds). Batafsil — **3-bob**.
7. **Dekorator-asoslangan RBAC:** global guard oʻrniga har controllerda `@UseGuards` + `@Roles`; frontend faqat menyu filtri.
8. **Yagona `/api` prefiksi + CORS:** barcha endpointlar `/api/...`, ko'p origin qoʻllab-quvvatlanadi.

Malumotlar modelining toʻliq ERD diagrammasi va model tavsiflari **4-bob. Malumotlar modeli**da; xavfsizlik va rollar **3-bob**da; UI dizayn tizimi **5-bob**da keltirilgan.
