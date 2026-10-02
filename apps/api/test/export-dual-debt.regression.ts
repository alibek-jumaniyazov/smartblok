import assert from 'node:assert/strict';
import ExcelJS, { type Worksheet } from 'exceljs';
import { D } from '../src/common/money';
import { cyr } from '../src/common/translit';
import { EMPTY_PALLET_STATS } from '../src/pallets/pallet-stats';
import { Book } from '../src/export/xlsx/book';
import { writeClients, writeFactories } from '../src/export/sheets/parties';

let checks = 0;
function equal(actual: unknown, expected: unknown, message: string) {
  assert.equal(actual, expected, message);
  checks++;
}

async function build(price: string) {
  const client = (id: string) => ({ id, name: id, agent: null, region: null, phone: null,
    legalEntity: null, creditLimit: null, paymentTermDays: null, active: true, createdAt: new Date('2026-01-01Z') });
  const emptyGroup = { groupBy: async () => [] };
  const ctx: any = {
    book: new Book('Dual debt regression'),
    prisma: {
      client: { findMany: async () => [client('c1'), client('c2')] },
      factory: { findMany: async () => [{ id: 'f1', name: 'f1', note: null, active: true }, { id: 'f2', name: 'f2', note: null, active: true }] },
      appSetting: { findUnique: async () => ({ value: price }) },
      order: emptyGroup, payment: emptyGroup, product: emptyGroup, bonusTransaction: emptyGroup,
      bonusProgram: { findMany: async () => [] },
      $queryRaw: async () => [{ factoryId: 'f1', amount: D('3200.50') }],
    },
    ledger: {
      clientBalances: async () => new Map([['c1', D('100.25')], ['c2', D('-0.75')]]),
      factoryBucketsMap: async () => new Map([
        ['f1', { net: D('1000000.25'), payable: D('-250000'), advanceCash: D('1250000.25'), advanceBank: D(0), advanceTotal: D('1250000.25') }],
        ['f2', { net: D('-250000'), payable: D('-250000'), advanceCash: D(0), advanceBank: D(0), advanceTotal: D(0) }],
      ]),
    },
    pallets: {
      clientPalletStats: async () => new Map([['c1', { ...EMPTY_PALLET_STATS, balance: -2 }], ['c2', { ...EMPTY_PALLET_STATS, balance: 1 }]]),
      factoryPalletStats: async () => new Map([['f1', { ...EMPTY_PALLET_STATS, balance: 10 }], ['f2', { ...EMPTY_PALLET_STATS, balance: -3 }]]),
    },
    periodLabel: 'Butun davr', window: null,
  };
  await writeClients(ctx);
  await writeFactories(ctx);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await ctx.book.toBuffer());
  return { clients: wb.getWorksheet(cyr('Mijozlar'))!, factories: wb.getWorksheet(cyr('Zavodlar'))! };
}

function cell(sheet: Worksheet, row: number, header: string) {
  let column = 0;
  sheet.getRow(4).eachCell((value, index) => { if (value.text === cyr(header)) column = index; });
  assert.ok(column > 0, `Missing diagnostic column: ${header}`);
  return sheet.getCell(row, column);
}

async function main() {
  const { clients, factories } = await build('130000.50');
  equal(cell(clients, 5, 'Paddonsiz balans').value, 100.25, 'client goods balance is the ledger value');
  equal(cell(clients, 5, 'Paddon narxi (joriy)').value, 130000.5, 'configured price includes cents');
  equal(cell(clients, 5, 'Paddon qiymati (qoldiq)').value, -260001, 'negative pallet quantity is not floored');
  equal(cell(clients, 5, 'Paddon bilan balans').value, -259900.75, 'signed client balance includes current pallet valuation');
  equal(cell(clients, 6, 'Paddon bilan balans').value, 129999.75, 'client advance offsets remaining pallet value');
  equal(cell(clients, 7, 'Paddon bilan balans').result, -129901, 'cached client total equals both signed rows');
  equal(cell(clients, 7, 'Paddon narxi (joriy)').formula, undefined, 'unit prices are not summed');
  equal(cell(factories, 5, 'Paddonsiz balans').value, -1003200.75, 'factory net advance and return expense credit reduce debt');
  equal(cell(factories, 5, 'Qaytarish xarajati (hisobdan chegirma)').value, 3200.5, 'factory expense credit is transparent');
  equal(cell(factories, 5, 'Paddon bilan balans').value, 296804.25, 'factory pallets can turn an advance into debt');
  equal(cell(factories, 6, 'Paddonsiz balans').value, 250000, 'positive value means we owe the factory');
  equal(cell(factories, 6, 'Paddon bilan balans').value, -140001.5, 'negative factory pallet correction remains signed');
  equal(cell(factories, 7, 'Paddon bilan balans').result, 156802.75, 'cached factory total includes credit once');
  equal(cell(factories, 7, 'Paddon narxi (joriy)').formula, undefined, 'factory unit price has no misleading total');

  const changed = await build('200000.25');
  equal(cell(changed.clients, 5, 'Paddonsiz balans').value, 100.25, 'price change does not change client goods balance');
  equal(cell(changed.clients, 5, 'Paddon bilan balans').value, -399900.25, 'price change revalues client remaining pallets');
  equal(cell(changed.factories, 5, 'Paddonsiz balans').value, -1003200.75, 'price change preserves factory base and historical expense credit');
  equal(cell(changed.factories, 5, 'Paddon bilan balans').value, 996801.75, 'price change revalues factory remaining pallets');
  console.log(`Export dual debt diagnostics: ${checks} checks passed`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
