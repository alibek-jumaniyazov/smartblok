import type { ImportEntityMap, ImportIssue, ImportRow } from '@prisma/client';
import type { ClientDictEntry } from './parse/types';
import { optionalCol, SHEET, WorkbookReader } from './parse/workbook.reader';
import { Dictionary } from './resolve/dictionary';
import { norm } from './resolve/normalize';

export type SourceLayout = Record<string, { sheetName: string; columns: Record<string, string> }>;
export interface ReviewSnapshot {
  sourceLayout?: SourceLayout;
  master?: {
    clientEntries?: ClientDictEntry[];
    agents?: string[];
    factories?: string[];
    settings?: { palletBasePrice?: string | null; taxPerM3?: string | null; agentKpiShare?: string | null };
  };
}

// Use the detected headers, since owners may move columns in their workbook.
const FIELD_HEADERS: Record<string, { sheet: string; fields: Record<string, string[]> }> = {
  SHIPMENT: { sheet: SHEET.goods, fields: {
    factoryPayChannel: ['тўлов тури'], factoryRaw: ['поставшик'], agentRaw: ['агент'], clientRaw: ['клиент'],
    date: ['дата'], truck: ['№ авто'], size: ['размер'], cube: ['блок куб', 'блок'],
    costPrice: ['цена приход'], salePrice: ['цена продажа'], palletQty: ['поддон шт'], palletPrice: ['цена поддон'],
    transportPayerRaw: ['расход авто'], transportCost: ['авто услу'],
  } },
  CLIENT_PAYMENT: { sheet: SHEET.payments, fields: {
    date: ['дата'], agentRaw: ['агент'], clientRaw: ['клиент'], bank: ['пр-сумма'], cash: ['накд'],
    click: ['клик'], terminal: ['терминал'], palletQty: ['поддон'], palletPrice: ['поддон нархи'],
  } },
  FACTORY_PAYMENT: { sheet: SHEET.factoryPayments, fields: {
    date: ['дата'], channel: ['в-о'], amount: ['сумма'], factoryRaw: ['получател'],
  } },
  PALLET_RETURN: { sheet: SHEET.palletReturns, fields: {
    date: ['дата'], clientRaw: ['клиент'], qty: ['поддон дона'],
  } },
  FACTORY_PALLET_RETURN: { sheet: SHEET.factoryPalletReturns, fields: {
    date: ['дата'], qty: ['поддон сони'], factoryRaw: ['қабул қилувчи'],
    unitCost: ['1 дона қайтариш ўртача нархи', '1 дона'], channel: ['тўлов тури'],
  } },
};

export function sourceLayout(reader: WorkbookReader): SourceLayout {
  return Object.fromEntries(Object.entries(FIELD_HEADERS).map(([kind, spec]) => {
    const table = reader.table(spec.sheet);
    const columns: Record<string, string> = {};
    for (const [field, names] of Object.entries(spec.fields)) {
      const column = optionalCol(table, ...names);
      if (column !== null) columns[field] = table.sheet.getRow(table.headerRow).getCell(column).address.replace(/\d+$/, '');
    }
    return [kind, { sheetName: table.sheetName, columns }];
  }));
}

const text = (value: unknown): string | null => value == null || String(value).trim() === '' ? null : String(value);
type Row = Pick<ImportRow, 'kind' | 'sheetName' | 'excelRow' | 'parsedJson' | 'resolvedJson'>;
type Entity = Pick<ImportEntityMap, 'kind' | 'sourceName' | 'newName' | 'suggestion'>;

/** Read-only context follows the same client dictionary and agent priority as commit. */
export function issueReviewContext(issue: Pick<ImportIssue, 'field'>, row: Row | null, snapshot: ReviewSnapshot, entities: Entity[]) {
  if (!row) return { context: null, guidance: null, sourceValue: null, effectiveValue: null };
  const current = row.resolvedJson as Record<string, unknown>;
  const original = row.parsedJson as Record<string, unknown>;
  const master = snapshot.master;
  const dict = Dictionary.from({
    settings: { palletBasePrice: null, taxPerM3: null, agentKpiShare: null },
    clients: master?.clientEntries ?? [], agents: master?.agents ?? [], factories: master?.factories ?? [], payTypes: [],
  });
  const chosen = text(current.resolvedClientName) ?? text(current.clientRaw);
  const client = chosen ? dict.resolveClient(chosen) : null;
  const clientName = client?.canonical ?? chosen;
  const clientMap = entities.find((e) => e.kind === 'CLIENT' &&
    (dict.resolveClient(e.newName ?? e.sourceName).canonical ?? e.newName ?? e.sourceName) === clientName);
  const mappedAgent = (clientMap?.suggestion as { agentName?: string } | null)?.agentName;
  const sourceAgentName = text(original.agentRaw);
  const preferredAgent = client?.agentName || mappedAgent || text(current.agentRaw);
  const renamed = (kind: 'AGENT' | 'FACTORY', raw: string | null) => {
    if (!raw) return null;
    return entities.find((e) => e.kind === kind && norm(e.sourceName).key === norm(raw).key)?.newName ?? raw;
  };
  const agentName = renamed('AGENT', preferredAgent);
  const factoryName = renamed('FACTORY', text(current.factoryRaw));
  const context = {
    sheetName: row.sheetName, excelRow: row.excelRow, kind: row.kind,
    date: text(current.date)?.slice(0, 10) ?? null,
    clientName, sourceClientName: text(original.clientRaw), agentName, sourceAgentName, factoryName,
    truck: text(current.truck), productSize: text(current.size), cube: text(current.cube),
    costPrice: text(current.costPrice), salePrice: text(current.salePrice), transportCost: text(current.transportCost),
    transportPayerRaw: text(current.transportPayerRaw), palletPrice: text(current.palletPrice), palletQty: text(current.palletQty),
  };
  const field = issue.field;
  const column = field ? snapshot.sourceLayout?.[row.kind]?.columns[field] : undefined;
  const sourceCell = column ? `${row.sheetName}!${column}${row.excelRow}` : null;
  const enteredBy = 'Importdagi qiymatni administrator kiritadi. Buxgalter tekshiradi; kelishilgan narxni mas’ul tomondan oladi.';
  const agent = agentName ? `«${agentName}» agenti` : 'Mijozga mas’ul agent';
  const factory = factoryName ? `«${factoryName}» zavodi` : 'Tegishli zavod';
  const guidanceByField: Record<string, { fieldLabel: string; unit: string | null; belongsTo: string; providedBy: string; impact: string }> = {
    salePrice: {
      fieldLabel: 'Mijozga sotuv narxi', unit: 'so‘m/m³', belongsTo: clientName ?? 'Mijoz',
      providedBy: `${agent} mijoz bilan kelishilgan sotuv narxini aniqlashtiradi.`,
      impact: 'Hajm × sotuv narxi = sotuv summasi. Mijoz qarzi va agent KPI shu narxga bog‘liq. Zavod tannarxini sotuv narxi o‘rniga qo‘yib bo‘lmaydi. Ombor kirimi bo‘lsa, avval operatsiya turini aniqlashtiring.',
    },
    costPrice: {
      fieldLabel: 'Zavoddan olish narxi', unit: 'so‘m/m³', belongsTo: factoryName ?? 'Zavod',
      providedBy: `${factory} hisob hujjatidagi shu yuk narxini buxgalter tekshiradi.`,
      impact: 'Hajm × zavod narxi = tovar tannarxi. Zavodga qarz va foyda hisobiga ta’sir qiladi; mijozga sotuv narxidan alohida.',
    },
    transportPayerRaw: {
      fieldLabel: 'Transportni kim to‘lagan', unit: null, belongsTo: `${clientName ?? 'Mijoz'} / sotuvchi`,
      providedBy: `${agent} va logistika mas’uli haydovchiga amalda kim to‘laganini aniqlashtiradi.`,
      impact: 'Клиент: mijozdan olinadigan tovar puli = sotuv − transport. Сотувчи: mijozdan to‘liq sotuv summasi olinadi. Transportni ikki marta chegirmang.',
    },
    transportCost: {
      fieldLabel: 'Shu yuk transport xarajati', unit: 'so‘m/reys', belongsTo: 'Haydovchi / tashuvchi',
      providedBy: `${agent} yoki logistika mas’uli reysning kelishilgan haqini beradi; buxgalter tekshiradi.`,
      impact: 'Butun reys summasi, 1 m³ narxi emas. Foydadan bir marta chegiriladi; mijoz qarziga ta’siri transport to‘lovchisiga bog‘liq.',
    },
    palletPrice: {
      fieldLabel: row.kind === 'CLIENT_PAYMENT' ? 'To‘langan poddonning tarixiy narxi' : 'Shu yuk poddon narxi',
      unit: 'so‘m/dona', belongsTo: clientName ?? factoryName ?? 'Poddon hisobi',
      providedBy: 'Buxgalter shu operatsiya hujjatidagi narxni tekshiradi. Qolgan poddonning joriy bahosini administrator Sozlamalarda boshqaradi.',
      impact: 'To‘langan poddon puli = dona × tarixiy narx. Tovar to‘lovi = jami pul − poddon puli. Joriy bahoni o‘zgartirish eski to‘lovni o‘zgartirmaydi.',
    },
    unitCost: {
      fieldLabel: 'Bir dona poddonni zavodga qaytarish xarajati', unit: 'so‘m/dona', belongsTo: factoryName ?? 'Zavodga qaytarish',
      providedBy: 'Logistika mas’uli qaytarish haqini beradi, buxgalter zavod bilan hisobini tekshiradi.',
      impact: 'Bu poddonning o‘z narxi emas. Qaytarish xarajati = qaytgan dona × bir dona xarajat; zavod hisobida bir marta kredit sifatida chegiriladi.',
    },
  };
  const guidance = field && guidanceByField[field] ? { ...guidanceByField[field], sourceCell, enteredBy } : null;
  return {
    context, guidance,
    sourceValue: field ? original[field] ?? null : null,
    effectiveValue: field ? current[field] ?? null : null,
  };
}
