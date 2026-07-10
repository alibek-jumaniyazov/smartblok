import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const CASHBOX_BY_METHOD: Record<string, string> = {
  CASH: 'Naqt kassa (UZS)', USD: 'Naqt kassa (USD)', CLICK: 'Click kassa', TERMINAL: 'Click kassa', BANK: 'Bank kassa',
};

async function main() {
  console.log('Seeding SmartBlok v2...');
  // wipe (respect FK order)
  await prisma.cashTransaction.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.expenseCategory.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.logisticsRoute.deleteMany();
  await prisma.factoryPrice.deleteMany();
  await prisma.cashbox.deleteMany();
  await prisma.user.deleteMany();
  await prisma.client.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.factory.deleteMany();
  await prisma.region.deleteMany();
  await prisma.agent.deleteMany();

  // Regions
  const regions: Record<string, string> = {};
  for (const r of ['Xorazm Beruniy', 'Urganch', 'Xazorasp', 'Shovot', 'Xonka']) {
    regions[r] = (await prisma.region.create({ data: { name: r } })).id;
  }
  const beruniy = regions['Xorazm Beruniy'];

  // Factories
  const factories: Record<string, string> = {};
  for (const f of ['CAOLS KS', 'Navoiy', 'Arton', 'Samarkand', 'KKG']) {
    factories[f] = (await prisma.factory.create({ data: { name: f } })).id;
  }

  // Factory prices (procurement matrix) — includes CAOLS KS + KKG (the factories real orders use)
  await prisma.factoryPrice.createMany({ data: [
    { factoryId: factories['CAOLS KS'], paymentMethod: 'TRANSFER', pricePerM3: 500000, dealerBonusPct: 0 },
    { factoryId: factories['CAOLS KS'], paymentMethod: 'CASH', pricePerM3: 480000, dealerBonusPct: 0.03 },
    { factoryId: factories['Navoiy'], paymentMethod: 'TRANSFER', pricePerM3: 650000, dealerBonusPct: 0 },
    { factoryId: factories['Arton'], paymentMethod: 'TRANSFER', pricePerM3: 750000, dealerBonusPct: 0 },
    { factoryId: factories['Samarkand'], paymentMethod: 'TRANSFER', pricePerM3: 583750, dealerBonusPct: 0 },
    { factoryId: factories['KKG'], paymentMethod: 'TRANSFER', pricePerM3: 625000, dealerBonusPct: 0.05 },
    { factoryId: factories['KKG'], paymentMethod: 'CASH', pricePerM3: 545000, dealerBonusPct: 0.05 },
  ] });
  await prisma.logisticsRoute.createMany({ data: [
    { factoryId: factories['CAOLS KS'], regionId: beruniy, costPerTruck: 1200000, truckCapacityM3: 33 },
    { factoryId: factories['Navoiy'], regionId: beruniy, costPerTruck: 4000000, truckCapacityM3: 34 },
    { factoryId: factories['Arton'], regionId: beruniy, costPerTruck: 1000000, truckCapacityM3: 34 },
    { factoryId: factories['Samarkand'], regionId: beruniy, costPerTruck: 5000000, truckCapacityM3: 32 },
    { factoryId: factories['KKG'], regionId: beruniy, costPerTruck: 2500000, truckCapacityM3: 33 },
  ] });

  // Products (per factory)
  const products: Record<string, string> = {};
  const mk = async (fac: string, size: string, cost: number, sale: number) => {
    const p = await prisma.product.create({ data: { factoryId: factories[fac], name: 'Gazoblok ' + size, size, unit: 'm3', costPrice: cost, salePrice: sale } });
    products[fac + '|' + size] = p.id; return p.id;
  };
  await mk('CAOLS KS', '600x300x200', 500000, 730000);
  await mk('CAOLS KS', '600x300x100', 500000, 730000);
  await mk('KKG', '600x300x200', 625000, 760000);
  await mk('Navoiy', '600x300x200', 650000, 780000);

  // Agents
  const agentDefs = [
    { name: 'Jamol 22-22', groupNo: 1, phone: '+998 90 000 22 22' },
    { name: 'Arslon oga', groupNo: 2 }, { name: 'Zafar oga', groupNo: 3 },
    { name: 'Shohrux oga', groupNo: 4 }, { name: 'Temur', groupNo: 5 },
    { name: 'Sardor oga', groupNo: 5 }, { name: "O'tkir mini", groupNo: 6 },
  ];
  const agents: Record<string, string> = {};
  for (const a of agentDefs) agents[a.name] = (await prisma.agent.create({ data: a })).id;

  // Users (admin/hisob/kassa + jamol agent user)
  const pass = (p: string) => bcrypt.hash(p, 10);
  await prisma.user.create({ data: { username: 'admin', email: 'admin@smartblok.uz', name: 'Administrator', role: 'ADMIN', password: await pass('admin123') } });
  await prisma.user.create({ data: { username: 'hisob', email: 'hisob@smartblok.uz', name: 'Bosh buxgalter', role: 'ACCOUNTANT', password: await pass('hisob123') } });
  await prisma.user.create({ data: { username: 'kassa', name: 'Kassir', role: 'CASHIER', password: await pass('kassa123') } });
  await prisma.user.create({ data: { username: 'jamol', name: 'Jamol (agent)', role: 'AGENT', password: await pass('agent123'), agentId: agents['Jamol 22-22'] } });

  // Clients
  const clientDefs: { name: string; agent: string; region?: string; phone?: string }[] = [
    { name: 'Urganch Tamirlash', agent: 'Jamol 22-22', region: 'Urganch', phone: '+998 91 111 11 11' },
    { name: 'Invest Holding', agent: 'Jamol 22-22', region: 'Urganch' },
    { name: 'Normat Umidbek', agent: 'Jamol 22-22' },
    { name: 'Fidato Grup', agent: 'Jamol 22-22' },
    { name: 'Gofur Xazorasp', agent: 'Arslon oga', region: 'Xazorasp' },
    { name: 'Shiddat monolit', agent: 'Arslon oga' },
    { name: 'Sulaymon Oga Xazarasp', agent: 'Zafar oga', region: 'Xazorasp' },
    { name: 'Murod oga Urganch', agent: 'Zafar oga', region: 'Urganch' },
    { name: 'Gayrat SHTB', agent: 'Shohrux oga', region: 'Shovot' },
    { name: 'Rustam Shpik', agent: 'Shohrux oga' },
    { name: 'Jasur Versal', agent: 'Temur' },
    { name: 'Mustafo mashal', agent: 'Temur' },
    { name: "O'tkir mini", agent: "O'tkir mini" },
  ];
  const clients: Record<string, string> = {};
  for (const c of clientDefs) {
    clients[c.name] = (await prisma.client.create({ data: { name: c.name, agentId: agents[c.agent], regionId: c.region ? regions[c.region] : beruniy, phone: c.phone ?? null, creditLimit: 100000000 } })).id;
  }

  // Vehicles
  const vehicleDefs = [
    { name: 'Isuzu — Baxtiyor', plate: '90 A 123 BC', driver: 'Baxtiyor', phone: '+998 93 100 00 01' },
    { name: 'MAN — Sanjar', plate: '95 B 456 CD', driver: 'Sanjar', phone: '+998 93 100 00 02' },
    { name: 'Kamaz — Otabek', plate: '40 C 789 EF', driver: 'Otabek' },
  ];
  const vehicles: string[] = [];
  for (const v of vehicleDefs) vehicles.push((await prisma.vehicle.create({ data: v })).id);

  // Cashboxes
  const boxes: Record<string, string> = {};
  for (const b of [
    { name: 'Naqt kassa (UZS)', type: 'CASH', currency: 'UZS' },
    { name: 'Naqt kassa (USD)', type: 'CASH', currency: 'USD' },
    { name: 'Click kassa', type: 'CLICK', currency: 'UZS' },
    { name: 'Bank kassa', type: 'BANK', currency: 'UZS' },
  ]) boxes[b.name] = (await prisma.cashbox.create({ data: b })).id;

  // Orders — mix of statuses; all non-cancelled ones drive debts
  let no = 0;
  const O = async (
    date: string, agent: string, client: string, fac: string, size: string,
    qty: number, cost: number, sale: number, transport: number, vehIdx: number, status: string,
  ) => {
    no++;
    const costTotal = qty * cost, saleTotal = qty * sale;
    return prisma.order.create({ data: {
      orderNo: 'B-' + String(no).padStart(4, '0'), date: new Date(date),
      agentId: agents[agent], clientId: clients[client], factoryId: factories[fac], productId: products[fac + '|' + size],
      vehicleId: vehicles[vehIdx] ?? null, quantity: qty, costPricePerUnit: cost, salePricePerUnit: sale, transportFee: transport,
      costTotal, saleTotal, profit: saleTotal - costTotal - transport, status,
    } });
  };
  await O('2026-06-24', 'Jamol 22-22', 'Urganch Tamirlash', 'CAOLS KS', '600x300x200', 32.8, 500000, 730000, 2000000, 0, 'COMPLETED');
  await O('2026-06-25', 'Jamol 22-22', 'Invest Holding', 'CAOLS KS', '600x300x200', 32.8, 500000, 700000, 2000000, 1, 'COMPLETED');
  await O('2026-06-25', 'Jamol 22-22', 'Normat Umidbek', 'CAOLS KS', '600x300x200', 32.8, 500000, 735000, 2000000, 0, 'COMPLETED');
  await O('2026-06-27', 'Zafar oga', 'Sulaymon Oga Xazarasp', 'CAOLS KS', '600x300x200', 32.8, 500000, 750000, 2500000, 2, 'COMPLETED');
  await O('2026-06-27', 'Shohrux oga', 'Gayrat SHTB', 'KKG', '600x300x200', 32.8, 625000, 760000, 2000000, 1, 'COMPLETED');
  await O('2026-06-30', 'Arslon oga', 'Gofur Xazorasp', 'CAOLS KS', '600x300x200', 32.8, 500000, 750000, 2500000, 0, 'DELIVERED');
  await O('2026-07-01', 'Temur', 'Jasur Versal', 'Navoiy', '600x300x200', 32.8, 650000, 780000, 2000000, 2, 'DELIVERED');
  await O('2026-07-06', 'Jamol 22-22', 'Fidato Grup', 'CAOLS KS', '600x300x100', 32.8, 500000, 730000, 2000000, 0, 'DELIVERING');
  await O('2026-07-07', 'Zafar oga', 'Murod oga Urganch', 'CAOLS KS', '600x300x200', 32.8, 500000, 730000, 2000000, 1, 'LOADING');
  await O('2026-07-08', 'Temur', 'Mustafo mashal', 'KKG', '600x300x200', 32.8, 625000, 760000, 2000000, -1, 'NEW');

  // Payments (+ mirror to kassa)
  const pay = async (type: string, party: 'client' | 'factory' | 'vehicle', partyId: string, amount: number, method: string, date: string, agent?: string, payer?: string) => {
    const boxName = CASHBOX_BY_METHOD[method];
    const box = boxName ? boxes[boxName] : undefined;
    const payment = await prisma.payment.create({ data: {
      date: new Date(date), type, method, amount,
      agentId: agent ? agents[agent] : null, payerName: payer ?? null, cashboxId: box ?? null,
      clientId: party === 'client' ? partyId : null,
      factoryId: party === 'factory' ? partyId : null,
      vehicleId: party === 'vehicle' ? partyId : null,
    } });
    if (box) {
      await prisma.cashTransaction.create({ data: { cashboxId: box, direction: type === 'CLIENT' ? 'IN' : 'OUT', amount, source: 'PAYMENT', date: new Date(date), note: 'Tolov', paymentId: payment.id } });
    }
  };
  // client payments (some full, some partial → debts)
  await pay('CLIENT', 'client', clients['Urganch Tamirlash'], 20000000, 'BANK', '2026-06-26', 'Jamol 22-22', 'URGANCH TAMIRLASH');
  await pay('CLIENT', 'client', clients['Invest Holding'], 22982400, 'BANK', '2026-06-28', 'Jamol 22-22', 'Xorazm Invest');
  await pay('CLIENT', 'client', clients['Normat Umidbek'], 24000000, 'CASH', '2026-06-29', 'Jamol 22-22');
  await pay('CLIENT', 'client', clients['Sulaymon Oga Xazarasp'], 24600000, 'BANK', '2026-06-30', 'Zafar oga', 'HAZORASP MUHAMMAD');
  await pay('CLIENT', 'client', clients['Gayrat SHTB'], 15000000, 'CLICK', '2026-07-02', 'Shohrux oga');
  await pay('CLIENT', 'client', clients['Jasur Versal'], 30000000, 'BANK', '2026-07-05', 'Temur', 'Jasmina');
  // factory payments (partial → we owe factory)
  await pay('FACTORY', 'factory', factories['CAOLS KS'], 40000000, 'BANK', '2026-06-27', undefined, 'CAOLS KS MCHJ');
  await pay('FACTORY', 'factory', factories['KKG'], 15000000, 'BANK', '2026-06-29', undefined, 'KKG MCHJ');
  // vehicle payments (partial → we owe vehicle)
  await pay('VEHICLE', 'vehicle', vehicles[0], 4000000, 'CASH', '2026-06-28');
  await pay('VEHICLE', 'vehicle', vehicles[1], 2000000, 'CASH', '2026-07-01');

  // Expense categories + expenses
  const cats: Record<string, string> = {};
  for (const c of ['Yoqilgi', 'Ish haqi', 'Ofis', 'Soliq', 'Boshqa']) cats[c] = (await prisma.expenseCategory.create({ data: { name: c } })).id;
  const expense = async (cat: string, amount: number, date: string, note: string) => {
    const exp = await prisma.expense.create({ data: { date: new Date(date), categoryId: cats[cat], amount, cashboxId: boxes['Naqt kassa (UZS)'], note } });
    await prisma.cashTransaction.create({ data: { cashboxId: boxes['Naqt kassa (UZS)'], direction: 'OUT', amount, source: 'EXPENSE', date: new Date(date), note, expenseId: exp.id } });
  };
  await expense('Yoqilgi', 3000000, '2026-06-28', 'Benzin');
  await expense('Ish haqi', 8000000, '2026-07-01', 'Xodimlar oyligi');
  await expense('Ofis', 1500000, '2026-07-03', 'Ofis xarajati');

  console.log('Seed v2 complete.');
  console.log('  agents=' + Object.keys(agents).length + ' clients=' + Object.keys(clients).length + ' factories=' + Object.keys(factories).length + ' vehicles=' + vehicles.length + ' orders=' + no);
  console.log('  Login: admin / admin123');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
