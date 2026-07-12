// SmartBlok v3 seed — platform prerequisites + real catalog from the workbook.
// Clients/orders/payments arrive via the Excel import (Phase 5); this seeds only
// what the import and the app assume to exist.
import { PrismaClient, Role, PriceKind, CashboxType, Currency, LegalEntityKind } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Demo/login users carry static, well-known passwords so the market/demo instance
// is usable out of the box. They are NOT seeded on a real production instance unless
// SEED_DEMO_USERS=1 is set explicitly — a hardened prod provisions its own ADMIN.
const SEED_DEMO_USERS = process.env.SEED_DEMO_USERS === '1' || process.env.NODE_ENV !== 'production';

async function main() {
  // ── users (demo credentials; gated out of hardened production) ──
  if (SEED_DEMO_USERS) {
    const users: Array<{ username: string; name: string; role: Role; password: string }> = [
      { username: 'admin', name: 'Administrator', role: Role.ADMIN, password: 'admin123' },
      { username: 'hisob', name: 'Buxgalter', role: Role.ACCOUNTANT, password: 'hisob123' },
      { username: 'kassa', name: 'Kassir', role: Role.CASHIER, password: 'kassa123' },
    ];
    for (const u of users) {
      await prisma.user.upsert({
        where: { username: u.username },
        create: { ...u, password: await bcrypt.hash(u.password, 12) },
        update: {},
      });
    }
  }

  // ── settings ──
  const settings: Array<[string, unknown]> = [
    ['agentDebtLimitDefault', null], // unlimited until the owner sets one
    ['truckCapacityPallets', 19],
    ['saleMarginMinPct', 0],
  ];
  for (const [key, value] of settings) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: value as object },
      update: {},
    });
  }

  // ── legal entities (from the workbook) ──
  const entities: Array<{ name: string; kind: LegalEntityKind }> = [
    { name: 'Септем Алока', kind: LegalEntityKind.DEALER },
    { name: 'Септем семент', kind: LegalEntityKind.DEALER },
    { name: '"CAOLS KS" MCHJ', kind: LegalEntityKind.FACTORY },
  ];
  const entityByName = new Map<string, string>();
  for (const e of entities) {
    const row = await prisma.legalEntity.upsert({ where: { name: e.name }, create: e, update: {} });
    entityByName.set(e.name, row.id);
  }

  // ── cashboxes ──
  const cashboxes: Array<{ name: string; type: CashboxType; currency: Currency; entity?: string }> = [
    { name: 'Naqd kassa', type: CashboxType.CASH, currency: Currency.UZS },
    { name: 'Bank (Септем Алока)', type: CashboxType.BANK, currency: Currency.UZS, entity: 'Септем Алока' },
    { name: 'Bank (Септем семент)', type: CashboxType.BANK, currency: Currency.UZS, entity: 'Септем семент' },
    { name: 'Click', type: CashboxType.CLICK, currency: Currency.UZS },
    { name: 'Terminal', type: CashboxType.TERMINAL, currency: Currency.UZS },
    { name: 'Karta', type: CashboxType.CARD, currency: Currency.UZS },
    { name: 'Valyuta (USD)', type: CashboxType.CASH, currency: Currency.USD },
  ];
  for (const c of cashboxes) {
    await prisma.cashbox.upsert({
      where: { name: c.name },
      create: {
        name: c.name,
        type: c.type,
        currency: c.currency,
        entityId: c.entity ? entityByName.get(c.entity) : undefined,
      },
      update: {},
    });
  }

  // ── region / factory / products (real workbook catalog) ──
  const region = await prisma.region.upsert({
    where: { name: 'Xorazm' },
    create: { name: 'Xorazm' },
    update: {},
  });

  const factory = await prisma.factory.upsert({
    where: { name: '"CAOLS KS" MCHJ' },
    create: { name: '"CAOLS KS" MCHJ', note: 'Газоблок zavodi' },
    update: {},
  });

  // sizes seen in the workbook; m³/pallet decoded in docs/audit/excel-spec.md §7
  const products: Array<{ name: string; size: string; m3PerPallet: string; blocksPerPallet?: number }> = [
    { name: 'Газоблок 600x300x200', size: '600x300x200', m3PerPallet: '1.728', blocksPerPallet: 48 },
    { name: 'Газоблок 600x300x100', size: '600x300x100', m3PerPallet: '1.728', blocksPerPallet: 96 },
    { name: 'Газоблок 600x300x250', size: '600x300x250', m3PerPallet: '1.8', blocksPerPallet: 40 },
    { name: 'Газоблок 600x240x200', size: '600x240x200', m3PerPallet: '1.728', blocksPerPallet: 60 },
  ];
  // price book: workbook shows purchase 500k→625k/m³ and sale 700–760k/m³.
  // CASH is cheaper than BANK so the cost-finalization engine posts a real
  // COST_ADJUSTMENT delta when a factory payment settles (else the flagship
  // provisional→final mechanism produces zero visible movement).
  const prices: Array<[PriceKind, string]> = [
    [PriceKind.FACTORY_CASH, '600000'],
    [PriceKind.FACTORY_BANK, '625000'],
    [PriceKind.DEALER_SALE, '750000'],
  ];
  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { factoryId_name: { factoryId: factory.id, name: p.name } },
      create: { factoryId: factory.id, ...p },
      update: {},
    });
    const existing = await prisma.productPrice.count({ where: { productId: product.id } });
    if (existing === 0) {
      for (const [kind, pricePerM3] of prices) {
        await prisma.productPrice.create({
          // backdated so orders dated "today" (midnight) already resolve a price
          data: { productId: product.id, kind, pricePerM3, effectiveFrom: new Date('2026-06-01') },
        });
      }
    }
  }

  // ── agents (real, from the workbook; sortNo = workbook block order) ──
  const agents = ['Жамол', 'Арслон ога', 'Зафар ога', 'Шохрух ога', 'Темур', 'Сардор ога'];
  for (let i = 0; i < agents.length; i++) {
    const agent = await prisma.agent.upsert({
      where: { name: agents[i] },
      create: { name: agents[i], sortNo: i + 1 },
      update: {},
    });
    if (i === 0 && SEED_DEMO_USERS) {
      // demo login bound to the first agent (gated out of hardened production)
      await prisma.user.upsert({
        where: { username: 'jamol' },
        create: {
          username: 'jamol',
          name: 'Жамол (agent)',
          role: Role.AGENT,
          password: await bcrypt.hash('agent123', 12),
          agentId: agent.id,
        },
        update: { agentId: agent.id },
      });
    }
  }

  // ── expense categories ──
  for (const name of ['Transport', 'Ish haqi', 'Ofis', 'Boshqa']) {
    await prisma.expenseCategory.upsert({ where: { name }, create: { name }, update: {} });
  }

  console.log('Seed v3 complete:', {
    users: await prisma.user.count(),
    entities: await prisma.legalEntity.count(),
    cashboxes: await prisma.cashbox.count(),
    products: await prisma.product.count(),
    prices: await prisma.productPrice.count(),
    agents: await prisma.agent.count(),
    region: region.name,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
