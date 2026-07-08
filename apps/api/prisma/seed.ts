import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function totals(cubes: number, cost: number, palletQty: number, palletPrice: number, sale: number, transport: number) {
  const costTotal = cubes * cost;
  const palletTotal = palletQty * palletPrice;
  const saleTotal = cubes * sale;
  const profit = saleTotal - costTotal - palletTotal - transport;
  return { costTotal, palletTotal, saleTotal, profit };
}

async function main() {
  console.log('Seeding SmartBlok...');

  // ---- wipe (idempotent) ----
  await prisma.palletMovement.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.factoryPayment.deleteMany();
  await prisma.logisticsRoute.deleteMany();
  await prisma.factoryPrice.deleteMany();
  await prisma.user.deleteMany();
  await prisma.client.deleteMany();
  await prisma.blockSize.deleteMany();
  await prisma.factory.deleteMany();
  await prisma.region.deleteMany();
  await prisma.agent.deleteMany();

  // ---- Agents ----
  const agentDefs = [
    { name: 'Jamol 22-22', groupNo: 1, phone: '+998 90 000 22 22' },
    { name: 'Arslon oga', groupNo: 2 },
    { name: 'Zafar oga', groupNo: 3 },
    { name: 'Shohrux oga', groupNo: 4 },
    { name: 'Temur', groupNo: 5 },
    { name: 'Sardor oga', groupNo: 5 },
    { name: "O'tkir mini", groupNo: 6 },
  ];
  const agents: Record<string, number> = {};
  for (const a of agentDefs) {
    const created = await prisma.agent.create({ data: a });
    agents[a.name] = created.id;
  }

  // ---- Regions ----
  const regionDefs = ['Xorazm Beruniy', 'Urganch', 'Xazorasp', 'Shovot', 'Xonka'];
  const regions: Record<string, number> = {};
  for (const r of regionDefs) {
    const created = await prisma.region.create({ data: { name: r } });
    regions[r] = created.id;
  }

  // ---- Block sizes ----
  const sizeDefs = ['600x300x200', '600x300x100', '600x300x250', '600x240x200'];
  const sizes: Record<string, number> = {};
  for (const s of sizeDefs) {
    const created = await prisma.blockSize.create({ data: { name: s } });
    sizes[s] = created.id;
  }

  // ---- Factories ----
  const factoryDefs = ['Navoiy', 'Arton', 'Samarkand', 'KKG', 'CAOLS KS'];
  const factories: Record<string, number> = {};
  for (const f of factoryDefs) {
    const created = await prisma.factory.create({ data: { name: f } });
    factories[f] = created.id;
  }

  // ---- Factory prices (KKG has cash & transfer + 5% dealer bonus) ----
  await prisma.factoryPrice.createMany({
    data: [
      { factoryId: factories['Navoiy'], paymentMethod: 'TRANSFER', pricePerM3: 650000, dealerBonusPct: 0 },
      { factoryId: factories['Arton'], paymentMethod: 'TRANSFER', pricePerM3: 750000, dealerBonusPct: 0 },
      { factoryId: factories['Samarkand'], paymentMethod: 'TRANSFER', pricePerM3: 583750, dealerBonusPct: 0 },
      { factoryId: factories['KKG'], paymentMethod: 'TRANSFER', pricePerM3: 625000, dealerBonusPct: 0.05 },
      { factoryId: factories['KKG'], paymentMethod: 'CASH', pricePerM3: 545000, dealerBonusPct: 0.05 },
      { factoryId: factories['CAOLS KS'], paymentMethod: 'TRANSFER', pricePerM3: 500000, dealerBonusPct: 0 },
    ],
  });

  // ---- Logistics routes to Xorazm Beruniy (reproduces the comparison sheet exactly) ----
  const beruniy = regions['Xorazm Beruniy'];
  await prisma.logisticsRoute.createMany({
    data: [
      { factoryId: factories['Navoiy'], regionId: beruniy, costPerTruck: 4000000, truckCapacityM3: 34 },
      { factoryId: factories['Arton'], regionId: beruniy, costPerTruck: 1000000, truckCapacityM3: 34 },
      { factoryId: factories['Samarkand'], regionId: beruniy, costPerTruck: 5000000, truckCapacityM3: 32 },
      { factoryId: factories['KKG'], regionId: beruniy, costPerTruck: 2500000, truckCapacityM3: 33 },
    ],
  });

  // ---- Clients ----
  const clientDefs: { name: string; agent: string; region?: string }[] = [
    { name: 'Urganch Tamirlash', agent: 'Jamol 22-22', region: 'Urganch' },
    { name: 'Invest Holding', agent: 'Jamol 22-22', region: 'Urganch' },
    { name: 'Normat Umidbek', agent: 'Jamol 22-22', region: 'Urganch' },
    { name: 'Fidato Grup', agent: 'Jamol 22-22' },
    { name: 'Irrigatsiya temir beton', agent: 'Jamol 22-22' },
    { name: 'Xonka', agent: 'Jamol 22-22', region: 'Xonka' },
    { name: 'Gofur Xazorasp', agent: 'Arslon oga', region: 'Xazorasp' },
    { name: 'Shiddat monolit', agent: 'Arslon oga' },
    { name: 'Sulaymon Oga Xazarasp', agent: 'Zafar oga', region: 'Xazorasp' },
    { name: 'Murod oga Urganch', agent: 'Zafar oga', region: 'Urganch' },
    { name: 'Sarvar oga Shovot', agent: 'Zafar oga', region: 'Shovot' },
    { name: 'Gayrat SHTB', agent: 'Shohrux oga', region: 'Shovot' },
    { name: 'Rustam Shpik', agent: 'Shohrux oga' },
    { name: 'Jasur Versal', agent: 'Temur' },
    { name: 'Mustafo mashal', agent: 'Temur' },
    { name: "O'tkir mini", agent: "O'tkir mini" },
    { name: 'Otabek damirchi', agent: 'Sardor oga' },
  ];
  const clients: Record<string, number> = {};
  for (const c of clientDefs) {
    const created = await prisma.client.create({
      data: {
        name: c.name,
        agentId: agents[c.agent],
        regionId: c.region ? regions[c.region] : beruniy,
        creditLimit: 100000000,
      },
    });
    clients[c.name] = created.id;
  }

  // ---- Users ----
  const pass = await bcrypt.hash('admin123', 10);
  const passAcc = await bcrypt.hash('hisob123', 10);
  const passAgent = await bcrypt.hash('agent123', 10);
  await prisma.user.createMany({
    data: [
      { email: 'admin@smartblok.uz', password: pass, name: 'Administrator', role: 'ADMIN' },
      { email: 'hisob@smartblok.uz', password: passAcc, name: 'Bosh buxgalter', role: 'ACCOUNTANT' },
    ],
  });
  await prisma.user.create({
    data: { email: 'jamol@smartblok.uz', password: passAgent, name: 'Jamol (agent)', role: 'AGENT', agentId: agents['Jamol 22-22'] },
  });

  // ---- Sales (Tovar) — representative rows from the real ledger ----
  const S = (
    date: string, agent: string, client: string, plate: string, size: string,
    cubes: number, cost: number, palletQty: number, sale: number, transport: number,
    factory = 'CAOLS KS',
  ) => {
    const t = totals(cubes, cost, palletQty, 130000, sale, transport);
    return {
      date: new Date(date),
      agentId: agents[agent], clientId: clients[client], factoryId: factories[factory], regionId: beruniy,
      plate, blockSizeId: sizes[size], cubes, costPricePerM3: cost, palletQty, palletPrice: 130000,
      salePricePerM3: sale, transportCost: transport, transportPaid: true,
      ...t,
    };
  };
  const saleRows = [
    S('2026-06-24', 'Jamol 22-22', 'Urganch Tamirlash', '95 G 851 NA', '600x300x200', 31.104, 500000, 18, 732542, 2000000),
    S('2026-06-24', 'Jamol 22-22', 'Urganch Tamirlash', '40 Y 173 KB', '600x300x200', 31.104, 500000, 18, 732542, 2000000),
    S('2026-06-24', 'Jamol 22-22', 'Invest Holding', '90 X 700 CA', '600x300x200', 31.104, 500000, 18, 700000, 2000000),
    S('2026-06-24', 'Zafar oga', 'Sulaymon Oga Xazarasp', '90 G 991 FA', '600x300x200', 31.104, 500000, 18, 750000, 2000000),
    S('2026-06-24', 'Jamol 22-22', 'Invest Holding', '90 G 429 CA', '600x300x200', 32.832, 500000, 19, 700000, 2000000),
    S('2026-06-25', 'Jamol 22-22', 'Normat Umidbek', '50 R 575 CB', '600x300x200', 32.832, 500000, 19, 735000, 2000000),
    S('2026-06-25', 'Arslon oga', 'Gofur Xazorasp', '01 U 917 XC', '600x300x200', 32.832, 500000, 19, 750000, 2500000),
    S('2026-06-27', 'Zafar oga', 'Sulaymon Oga Xazarasp', '40 W 910 SB', '600x300x100', 32.832, 500000, 19, 750000, 2500000),
    S('2026-06-27', 'Shohrux oga', 'Gayrat SHTB', '90 919 LBA', '600x300x200', 32.832, 500000, 19, 760000, 2000000),
    S('2026-06-27', 'Shohrux oga', 'Rustam Shpik', '90 X 700 CA', '600x300x200', 32.832, 500000, 19, 729928, 2000000),
    S('2026-06-30', 'Zafar oga', 'Murod oga Urganch', '40 148 ECA', '600x300x200', 32.832, 500000, 19, 730000, 2000000),
    S('2026-06-30', 'Jamol 22-22', 'Irrigatsiya temir beton', '25 Q 068 OA', '600x300x200', 32.832, 500000, 19, 735000, 2000000),
    S('2026-07-01', 'Jamol 22-22', 'Fidato Grup', '90 682 FBA', '600x300x200', 32.832, 500000, 19, 730000, 2000000),
    S('2026-07-01', 'Jamol 22-22', 'Xonka', '80 M 667 YA', '600x300x200', 32.832, 500000, 19, 730000, 2500000),
    S('2026-07-06', 'Temur', 'Jasur Versal', '90 200 AB', '600x300x200', 32.832, 625000, 19, 730000, 2000000, 'KKG'),
    S('2026-07-06', 'Temur', 'Mustafo mashal', '90 300 CB', '600x300x200', 32.832, 545000, 19, 700000, 2000000, 'KKG'),
    S('2026-07-06', 'Arslon oga', 'Shiddat monolit', '90 400 DB', '600x300x200', 32.832, 500000, 19, 700000, 2000000),
    S('2026-07-07', "O'tkir mini", "O'tkir mini", '90 500 EB', '600x300x200', 32.832, 500000, 19, 700000, 2000000),
  ];
  for (const row of saleRows) {
    const sale = await prisma.sale.create({ data: row });
    if (row.palletQty > 0) {
      await prisma.palletMovement.create({
        data: { clientId: row.clientId, saleId: sale.id, issuedQty: row.palletQty, date: row.date, note: 'Sotuv bilan berildi' },
      });
    }
  }

  // ---- Payments (Oplata) ----
  const P = (date: string, agent: string, client: string, amount: number, method: string, payer?: string) => ({
    date: new Date(date), agentId: agents[agent], clientId: clients[client], amount, method, payerName: payer ?? null,
  });
  await prisma.payment.createMany({
    data: [
      P('2026-06-25', 'Jamol 22-22', 'Urganch Tamirlash', 45570000, 'TRANSFER', 'URGANCH TAMIRLASH'),
      P('2026-06-25', 'Zafar oga', 'Sulaymon Oga Xazarasp', 23328000, 'TRANSFER', 'HAZORASP MUHAMMAD'),
      P('2026-06-29', 'Zafar oga', 'Sulaymon Oga Xazarasp', 24624000, 'TRANSFER', 'A-SIA HOUSE MCHJ'),
      P('2026-06-29', 'Shohrux oga', 'Rustam Shpik', 23965000, 'TRANSFER', 'Iftixor xususiy'),
      P('2026-06-29', 'Arslon oga', 'Gofur Xazorasp', 47952000, 'TRANSFER', 'EZVIZ CITY MCHJ'),
      P('2026-07-02', 'Jamol 22-22', 'Invest Holding', 67737600, 'TRANSFER', 'Xorazm Invest Holding'),
      P('2026-07-02', 'Jamol 22-22', 'Normat Umidbek', 72394560, 'TRANSFER', 'NORMAT UMIDBEK MCHJ'),
      P('2026-07-03', 'Zafar oga', 'Murod oga Urganch', 47934720, 'TRANSFER', 'Ulgircha savdo'),
      P('2026-07-03', 'Shohrux oga', 'Gayrat SHTB', 49904640, 'TRANSFER', 'Shovot temir beton'),
      P('2026-07-03', 'Jamol 22-22', 'Urganch Tamirlash', 85000000, 'TRANSFER', 'URGANCH TAMIRLASH'),
      P('2026-07-06', 'Temur', 'Jasur Versal', 62947200, 'TRANSFER', 'Jamshidbek Jasmina'),
      P('2026-07-06', 'Temur', 'Mustafo mashal', 21000000, 'CASH'),
      P('2026-07-07', "O'tkir mini", "O'tkir mini", 40000000, 'CASH'),
      P('2026-07-06', 'Arslon oga', 'Shiddat monolit', 23082400, 'TRANSFER', 'SHIDDAT MONOLIT MCHJ'),
    ],
  });

  // ---- Pallet returns ----
  await prisma.palletMovement.create({ data: { clientId: clients['Sulaymon Oga Xazarasp'], returnedQty: 11, date: new Date('2026-07-05'), note: 'Poddon qaytimi' } });
  await prisma.palletMovement.create({ data: { clientId: clients['Jasur Versal'], returnedQty: 8, date: new Date('2026-07-07'), note: 'Poddon qaytimi' } });

  // ---- Factory payments (Oplata Zavod) ----
  await prisma.factoryPayment.createMany({
    data: [
      { date: new Date('2026-06-25'), factoryId: factories['CAOLS KS'], amount: 45570000, payer: 'Septem Aloka', recipient: 'CAOLS KS MCHJ' },
      { date: new Date('2026-06-29'), factoryId: factories['CAOLS KS'], amount: 47952000, payer: 'Septem Aloka', recipient: 'CAOLS KS MCHJ' },
      { date: new Date('2026-07-02'), factoryId: factories['CAOLS KS'], amount: 214004160, payer: 'Septem Aloka', recipient: 'CAOLS KS MCHJ' },
      { date: new Date('2026-07-03'), factoryId: factories['KKG'], amount: 506000000, payer: 'Septem Aloka', recipient: 'KKG MCHJ' },
      { date: new Date('2026-07-07'), factoryId: factories['KKG'], amount: 50000000, payer: 'Naqt plastika', recipient: 'KKG MCHJ' },
    ],
  });

  console.log('Seed complete.');
  console.log('  agents=' + Object.keys(agents).length + ' clients=' + Object.keys(clients).length + ' factories=' + Object.keys(factories).length + ' sales=' + saleRows.length);
  console.log('  Login: admin@smartblok.uz / admin123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
