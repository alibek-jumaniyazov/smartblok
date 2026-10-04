import { Collapse, Descriptions, Typography } from 'antd';
import { useT } from './LangContext';

export interface ImportSourceSettings {
  palletPriceDefault: string | null;
  taxPerM3: string | null;
  agentShare: string | null;
}

export interface ImportIssueContext {
  sheetName: string;
  excelRow: number;
  kind: string;
  date: string | null;
  clientName: string | null;
  sourceClientName: string | null;
  agentName: string | null;
  sourceAgentName: string | null;
  factoryName: string | null;
  truck: string | null;
  productSize: string | null;
  cube: string | number | null;
  costPrice: string | null;
  salePrice: string | null;
  transportCost: string | null;
  transportPayerRaw: string | null;
  palletPrice: string | null;
  palletQty: string | number | null;
}

export interface ImportIssueGuidance {
  fieldLabel: string;
  sourceCell: string | null;
  unit: string | null;
  belongsTo: string;
  providedBy: string;
  enteredBy: string;
  impact: string;
}

/** Keep the source's fractional price visible; this screen must not round it to whole so'm. */
export function importValue(value: unknown, missing = 'Kiritilmagan'): string {
  if (value == null || value === '') return missing;
  const text = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  const [whole, fraction] = text.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction ? `.${fraction}` : ''}`;
}

export function ImportPriceGuide({ settings }: { settings?: ImportSourceSettings }) {
  const t = useT();
  const amount = (value: string | null | undefined, unit: string) =>
    value == null ? t('Manbada ko‘rsatilmagan') : `${importValue(value)} ${t(unit)}`;
  return (
    <Collapse items={[{
      key: 'prices',
      label: t('Qaysi narx kimga tegishli va kim kiritadi?'),
      children: <div style={{ display: 'grid', gap: 14 }}>
        <Typography.Paragraph style={{ margin: 0 }}>
          {t('Narxni kelishgan xodim haqiqiy qiymatni beradi. Importdagi tuzatishni Administrator kiritadi; buxgalter ko‘rib chiqadi. Agent nomi uning dasturdagi ruxsatini anglatmaydi. Bo‘sh narxga 0 yoki taxminiy narx qo‘yilmaydi.')}
          {' '}{t('Quyidagi kataklar standart shablon misollaridir. Faylda ustunlar ko‘chirilgan bo‘lsa, har bir muammo yonidagi aniqlangan «Manba» katagiga qarang.')}
        </Typography.Paragraph>
        <Descriptions column={1} size="small" bordered items={[
          {
            key: 'cost', label: t('Zavod narxi — Товар!I'),
            children: t('1 m³ uchun zavodga tegishli xarid narxi. Zavod bilan hisob yurituvchi mas’ul hisob-faktura va naqd/o‘tkazma shartiga qarab tasdiqlaydi. Hajm × narx zavod oldidagi tovar majburiyati va tannarxni belgilaydi. Oddiy buyurtmalar uchun narx «Mahsulotlar» bo‘limida yuritiladi.'),
          },
          {
            key: 'sale', label: t('Mijozga sotuv narxi — Товар!O'),
            children: t('1 m³ uchun mijoz bilan kelishilgan narx. Shu mijozning mas’ul agenti yoki savdo mas’uli beradi. Zavod narxini bu maydonga avtomatik ko‘chirish mumkin emas. Narx mijoz qarzi, foyda va agent KPI ga ta’sir qiladi.'),
          },
          {
            key: 'transport', label: t('Transport — Товар!S va Q'),
            children: t('S — bir yuk uchun haydovchi xizmati summasi; uni logistika mas’uli yoki haydovchi hujjati bilan tasdiqlang. Q = Клиент: mijoz haydovchiga o‘zi to‘laydi, bizga qarzi = hajm × sotuv narxi − transport. Q = Сотувчи: transportni biz to‘laymiz, mijoz bizga to‘liq sotuv summasini to‘laydi.'),
          },
          {
            key: 'pallet', label: t('Qolgan paddonning joriy narxi'),
            children: <>
              <b>{amount(settings?.palletPriceDefault, 'so‘m / dona')}</b>
              <div>{t('Manba: Кўрсаткичлар!B4. Importdan keyin Administrator «Sozlamalar → Paddon narxi» orqali boshqaradi. Qolgan dona shu joriy narxda baholanadi. Oldin puli to‘langan paddon narxi va pul operatsiyalari o‘zgarmaydi; Оплата!N tarixiy to‘lov narxidir.')}</div>
            </>,
          },
          {
            key: 'kpi', label: t('KPI uchun manba parametrlari'),
            children: <>
              <div>{t('1 m³ uchun soliq')}: <b>{amount(settings?.taxPerM3, 'so‘m / m³')}</b></div>
              <div>{t('Agent ulushi (koeffitsiyent)')}: <b>{settings?.agentShare == null ? t('Manbada ko‘rsatilmagan') : importValue(settings.agentShare)}</b></div>
              <div>{t('KPI: (sotuv − tannarx − transport − hajm × soliq) × agent ulushi. Mijozning lug‘atda belgilangan agenti ustuvor. Parametrlar korxona rahbari tasdiqlagan qoidaga mos bo‘lishi kerak.')}</div>
            </>,
          },
        ]} />
      </div>,
    }]} />
  );
}

export function ImportIssueDetails({ context, guidance }: {
  context?: ImportIssueContext | null;
  guidance?: ImportIssueGuidance | null;
}) {
  const t = useT();
  const missing = t('Kiritilmagan');
  const rows: Array<{ key: string; label: string; children: string }> = [];
  const add = (key: string, label: string, value: unknown, unit?: string) => {
    rows.push({ key, label: t(label), children: `${importValue(value, missing)}${value != null && value !== '' && unit ? ` ${t(unit)}` : ''}` });
  };
  if (context) {
    add('origin', 'Manba', `${context.sheetName}!${context.excelRow}${guidance?.sourceCell ? ` · ${guidance.sourceCell}` : ''}`);
    if (context.clientName || context.sourceClientName) add('client', 'Mijoz', context.clientName ?? context.sourceClientName);
    if (context.sourceClientName && context.sourceClientName !== context.clientName) add('sourceClient', 'Manbadagi mijoz nomi', context.sourceClientName);
    if (context.agentName || context.sourceAgentName) {
      add('agent', 'Hisobga olinadigan mas’ul agent', context.agentName);
      if (context.sourceAgentName !== context.agentName) add('sourceAgent', 'Yuk qatoridagi agent', context.sourceAgentName);
    }
    if (context.factoryName) add('factory', 'Zavod', context.factoryName);
    if (context.date) add('date', 'Sana', context.date.slice(0, 10).split('-').reverse().join('.'));
    if (context.truck) add('truck', 'Avtomobil', context.truck);
    if (context.productSize) add('product', 'Blok o‘lchami', context.productSize);
    if (context.kind === 'SHIPMENT') {
      add('cube', 'Hajm', context.cube, 'm³');
      add('cost', 'Zavodning 1 m³ narxi', context.costPrice, 'so‘m / m³');
      add('sale', 'Mijozga 1 m³ sotuv narxi', context.salePrice, 'so‘m / m³');
      add('transport', 'Yuk uchun transport', context.transportCost, 'so‘m');
      add('payer', 'Transportni to‘laydigan tomon', context.transportPayerRaw);
    }
  }
  return <div style={{ display: 'grid', gap: 12, minWidth: 0, overflowWrap: 'anywhere' }}>
    {rows.length > 0 && <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 2 }} items={rows} />}
    {context?.agentName && context.sourceAgentName && context.agentName !== context.sourceAgentName &&
      <Typography.Text type="secondary">{t('Mijozlar lug‘atidagi mas’ul agent ustuvor; yuk qatoridagi eski agent alohida ko‘rsatildi.')}</Typography.Text>}
    {guidance && <div style={{ display: 'grid', gap: 5, padding: 12, borderRadius: 8, background: 'var(--ant-color-fill-quaternary)' }}>
      <div><b>{t('Kimga tegishli')}:</b> {guidance.belongsTo}</div>
      <div><b>{t('Qiymatni kim tasdiqlaydi')}:</b> {guidance.providedBy}</div>
      <div><b>{t('Importga kim kiritadi')}:</b> {guidance.enteredBy}</div>
      <div><b>{t('Hisobga ta’siri')}:</b> {guidance.impact}</div>
    </div>}
  </div>;
}
