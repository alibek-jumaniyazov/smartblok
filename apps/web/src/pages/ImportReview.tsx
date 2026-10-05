import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, AutoComplete, Button, DatePicker, Empty, Input, InputNumber, Modal, Segmented, Select, Space, Table, Typography } from 'antd';
import { CheckOutlined, CloudUploadOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, apiError } from '../lib/api';
import { fmtMoney } from '../lib/format';
import { modalWidth, useIsPhone } from '../lib/responsive';
import { KpiBand, PageHeader, StatusChip, TableCard } from '../components';
import { useT } from '../components/LangContext';
import { translate } from '../lib/i18n';
import type { StatusMeta } from '../lib/status-maps';
import type { DualDebtFields } from '../lib/types';
import { DebtValue, DualDebtPanel } from '../components/DualDebt';
import { sumMoney } from '../lib/sum-money';
import { useAuth } from '../auth/AuthContext';
import { ImportIssueDetails, ImportPriceGuide, importValue } from '../components/ImportPriceGuide';
import type { ImportIssueContext, ImportIssueGuidance, ImportSourceSettings } from '../components/ImportPriceGuide';

// ── shape of the backend responses (import.service summary/issues/entities) ──
interface BatchSummary {
  batch: { id: string; filename: string; status: string; previewHash: string | null; preview: Preview | null; error: string | null; createdAt: string };
  rowsByKind: Record<string, number>;
  entitiesByDecision: Record<string, number>;
  commitReady: boolean;
  previewFresh: boolean;
  openBlockers: number;
  pendingEntities: number;
  priorCommittedImports: number;
  identicalCommittedImports?: number;
  sourceSettings?: ImportSourceSettings;
  incompleteRows?: Array<{ origin: { sheetName: string; excelRow: number }; summary: string; missing: string[] }>;
}
interface Preview {
  kpiSettings?: { taxPerM3: string; agentShare: string };
  palletPriceDefault?: string;
  orders: number; factoryBalance: string; clientDebtTotal: string; vehicleBalance: string;
  clientDebtWithPallets?: string;
  clientPalletDebtAmount?: string;
  saleTotal: string; costTotal: string; clientPaidTotal: string;
  // «Товар» varag'ining pul ustunlari
  clientDirectTransport: string; clientChargeable: string;
  clientPaidGoods: string; clientPaidPallets: string;
  transportSettled: string;
  // zavodlar ALOHIDA (yangi shablonda ikkitasi bor)
  factories?: Array<DualDebtFields & {
    name: string; goodsTaken: string; paid: string; balance: string;
    palletsOwed: number; palletsReceived: number; palletsReturned: number; palletsDefective: number;
  }>;
  factoryGoodsTaken: string; factoryTransferred: string;
  factorySettled: string; factoryOrdersSettled: number;
  factoryOrdersPartial?: number; factoryOrdersUnpaid?: number;
  factoryPayable: string; factoryAdvanceBank: string; factoryAdvanceCash: string;
  factoryByChannel?: Array<{ channel: string; orders: number; goods: string; paid: string; debt: string }>;
  /** paddon DONA bo'yicha — yangi shablonning o'z varaqlaridan */
  pallets?: {
    delivered: number; returnedByClients: number; paidByClients: number;
    clientDebt: number; returnedToFactory: number; defectiveFromFactory: number; dealerInHand: number;
    warehouseAdjustment?: number;
  };
  // mijoz puli buyurtmalarga FIFO bo'yicha yopishtirilgani
  allocatedToOrders: string; ordersFullyPaid: number; clientAdvanceLeft: string;
  // kassa: har bir hisob qayerga tushishi — commitdan OLDIN koʼrinadi
  cashIn: string; cashOut: string; cashCapital: string;
  cashboxes?: Array<{ name: string; type: string; in: string; out: string; capital: string; balance: string }>;
  /** import qilinmagan, lekin sanab berilgan qatorlar */
  skipped?: Array<{ sheet: string; row: number; why: string }>;
}

const clientPreviewDebt = (preview: Preview): DualDebtFields => ({
  debtWithoutPallets: preview.clientDebtTotal,
  debtWithPallets: preview.clientDebtWithPallets,
  palletDebtAmount: preview.clientPalletDebtAmount,
  palletDebtQuantity: preview.pallets?.clientDebt,
  palletUnitPrice: preview.palletPriceDefault,
});
interface Issue {
  id: string; rowId: string | null; ruleId: string; severity: 'BLOCK' | 'CONFIRM' | 'WARN' | 'INFO';
  field: string | null; message: string; currentValue: unknown; suggestedValue: unknown; status: string;
  sourceValue?: unknown;
  effectiveValue?: unknown;
  context?: ImportIssueContext | null;
  guidance?: ImportIssueGuidance | null;
}
interface Entity {
  id: string; sourceName: string; occurrences: number; decision: string;
  newName: string | null; suggestion: { targetName: string; confidence: number; reason: string } | null;
}

// Yorliqlar getter — joriy tilga tarjima qilinadi (status-maps `mk` bilan bir xil naqsh).
const SEV: Record<string, StatusMeta> = {
  BLOCK: { get label() { return translate('Toʼsiq'); }, light: '#B23A2E', dark: '#E07A6D' },
  CONFIRM: { get label() { return translate('Tasdiq'); }, light: '#A06A12', dark: '#D3A24A' },
  WARN: { get label() { return translate('Ogoh'); }, light: '#2C6A97', dark: '#6AA8D4' },
  INFO: { get label() { return translate('Maʼlumot'); }, light: '#5B6A66', dark: '#9AA8A4' },
};
const BATCH_META: Record<string, StatusMeta> = {
  DRAFT: { get label() { return translate('Qoralama'); }, light: '#5B6A66', dark: '#9AA8A4' },
  READY: { get label() { return translate('Tayyor'); }, light: '#2B7F52', dark: '#5FC088' },
  COMMITTED: { get label() { return translate('Yuborilgan'); }, light: '#0C6B62', dark: '#45BCAF' },
  COMMITTING: { get label() { return translate('Yuborilyapti'); }, light: '#A06A12', dark: '#D3A24A' },
  FAILED: { get label() { return translate('Xato'); }, light: '#B23A2E', dark: '#E07A6D' },
  ROLLED_BACK: { get label() { return translate('Orqaga qaytarilgan'); }, light: '#C2413B', dark: '#E8827C' },
};

// which staged field a rule edits → picks the right inline input
const NUMERIC = new Set([
  'transport', 'diff', 'salePrice', 'costPrice', 'total', 'saleSum', 'palletPrice', 'amount', 'palletReturn', 'factoryPaid',
  'cube', 'palletQty', 'qty', 'transportCost', 'bank', 'cash', 'click', 'terminal', 'unitCost', 'totalCostDeclared',
]);
const COUNT_FIELDS = new Set(['palletReturn', 'palletQty', 'qty']); // dona, soʼm emas
const POSITIVE_FIELDS = new Set(['cube', 'salePrice', 'costPrice', 'palletPrice']);
const NONNEGATIVE_FIELDS = new Set(['transport', 'transportCost', 'unitCost']);
const CLIENT_FIELDS = new Set(['clientRaw']);
const wrap = { whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.5 } as const;

const moneyFmt = (v?: string | number) => (v == null || v === '' ? '' : `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
const moneyParse = (v?: string) => (v ?? '').replace(/\s/g, '');
const fmtVal = (v: unknown, unit = translate('soʼm')): string => {
  // «Жами»ga qoʼshish/qoʼshmaslik boolean — «true» deb chiqarish egasi uchun ma'nosiz
  if (typeof v === 'boolean') return v ? translate('hisobga olinadi') : translate('hisobga olinmaydi');
  if (v == null || v === '') return '—';
  const sv = String(v);
  return typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(sv) ? `${importValue(sv)}${unit ? ` ${unit}` : ''}` : sv;
};

export default function ImportReview() {
  const { batchId = '' } = useParams();
  const { message, modal } = App.useApp();
  const t = useT();
  const { hasRole } = useAuth();
  const isPhone = useIsPhone();
  const qc = useQueryClient();
  const [tab, setTab] = useState('summary');
  const [preparing, setPreparing] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackWord, setRollbackWord] = useState('');
  // how the commit joins existing data: APPEND (add on top) | REPLACE (swap out prior imports)
  const [mode, setMode] = useState<'APPEND' | 'REPLACE'>('APPEND');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['import', batchId] });
    qc.invalidateQueries({ queryKey: ['import', batchId, 'issues'] });
    qc.invalidateQueries({ queryKey: ['import', batchId, 'entities'] });
  };
  const batchQ = useQuery<BatchSummary>({ queryKey: ['import', batchId], queryFn: () => api.get(`/import/${batchId}`).then((r) => r.data) });
  const issuesQ = useQuery<Issue[]>({ queryKey: ['import', batchId, 'issues'], queryFn: () => api.get(`/import/${batchId}/issues`).then((r) => r.data) });
  const entitiesQ = useQuery<Entity[]>({ queryKey: ['import', batchId, 'entities'], queryFn: () => api.get(`/import/${batchId}/entities`).then((r) => r.data) });

  const preview = useMutation({
    // dry-run under the currently selected mode so REPLACE shows the real (wiped) numbers
    mutationFn: () => api.post(`/import/${batchId}/preview`, { mode }).then((r) => r.data),
    onSuccess: () => { message.success(t('Preview hisoblandi')); invalidate(); },
    onError: (e) => message.error(apiError(e)),
  });
  const resolveIssue = useMutation({
    mutationFn: (v: { issueId: string; status: string; value?: unknown }) =>
      api.post(`/import/${batchId}/issues/${v.issueId}/resolve`, { status: v.status, value: v.value }),
    onSuccess: () => { message.success(t('Toʼgʼrilandi ✓')); invalidate(); },
    onError: (e) => message.error(apiError(e)),
  });
  const resolveEntity = useMutation({
    mutationFn: (v: { mapId: string; name: string }) => api.post(`/import/${batchId}/entities/${v.mapId}/resolve`, { name: v.name }),
    onSuccess: () => { message.success(t('Mijoz nomi saqlandi ✓')); invalidate(); },
    onError: (e) => message.error(apiError(e)),
  });
  const commit = useMutation({
    mutationFn: (v: { token: string; mode: 'APPEND' | 'REPLACE' }) =>
      api.post(`/import/${batchId}/commit`, { confirmToken: v.token, mode: v.mode }).then((r) => r.data),
    onSuccess: () => {
      message.success(mode === 'REPLACE' ? t('Bazaga yozildi ✓ — butun baza shu fayl bilan almashtirildi') : t('Bazaga yuborildi ✓'));
      // REPLACE wiped every table + rebuilt — refresh broadly
      qc.invalidateQueries();
    },
    onError: (e) => message.error(apiError(e)),
  });
  const rollback = useMutation({
    mutationFn: () =>
      api.post(`/import/${batchId}/rollback`).then((r) => r.data as {
        reversedLedger: number; reversedPallets: number; reversedCash: number; reversedBonus: number;
        voidedPayments: number; voidedAllocations: number; cancelledOrders: number;
      }),
    onSuccess: (d) => {
      setRollbackOpen(false);
      // kassa qatorlari ham teskari yoziladi — buni aytmaslik «pulim kassada qoldimi?»
      // degan savolni tug'dirardi (import yuzlab kassa qatori yozadi). Bonus ham shunday:
      // bekor qilingan buyurtmaning bonusi hamyonda qolib ketmasligi kerak.
      message.success(t('{n} ta yozuv qaytarildi — {p} poddon harakati, {k} kassa qatori storno, {b} bonus storno, {v} toʼlov storno, {o} buyurtma bekor qilindi.', {
        n: d.reversedLedger, p: d.reversedPallets, k: d.reversedCash, b: d.reversedBonus, v: d.voidedPayments, o: d.cancelledOrders,
      }));
      qc.invalidateQueries();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const s = batchQ.data;
  const isAdmin = hasRole('ADMIN');
  const canEdit = isAdmin && !!s && !['COMMITTED', 'ROLLED_BACK', 'COMMITTING'].includes(s.batch.status);
  const pv = s?.batch.preview;
  // Parser omissions must be visible before preview too. Preserve every source
  // coordinate and paginate the list instead of truncating it after 20 rows.
  const omittedRows = [
    ...(s?.incompleteRows ?? []).map((r) => ({
      sheet: r.origin.sheetName,
      row: r.origin.excelRow,
      why: `${r.summary}${r.summary ? ' · ' : ''}${t('Yetishmaydi: {fields}', { fields: r.missing.join(', ') })}`,
    })),
    ...(pv?.skipped ?? []),
  ];
  const openIssues = (issuesQ.data ?? []).filter((i) => i.status === 'OPEN');
  const pendingEntities = (entitiesQ.data ?? []).filter((e) => e.decision === 'PENDING');
  const blockers = openIssues.filter((i) => i.severity === 'BLOCK');
  const problemCount = openIssues.length + pendingEntities.length;
  const resolving = resolveIssue.isPending || resolveEntity.isPending;

  // known client names in this import — feed the name autocomplete so spelling
  // variants collapse onto one client instead of spawning new ones.
  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    (entitiesQ.data ?? []).forEach((e) => { if (e.newName) set.add(e.newName); if (e.suggestion?.targetName) set.add(e.suggestion.targetName); });
    return [...set].sort().map((v) => ({ value: v }));
  }, [entitiesQ.data]);

  const kpi = useMemo(() => {
    if (!pv) return null;
    const margin = sumMoney([pv.saleTotal, pv.costTotal.startsWith('-') ? pv.costTotal.slice(1) : `-${pv.costTotal}`]);
    return {
      cards: [
        // «Поставшиклар ҳисоби» varag'ining ustunlari — egasi varaqdan belgilab chiqadi.
        { label: 'Zavoddan olingan mol', value: pv.factoryGoodsTaken, variant: 'neutral' as const, note: 'Faqat blok tannarxi; paddon qiymati alohida ko‘rsatiladi.' },
        { label: 'Zavodga toʼlangan', value: pv.factoryTransferred, variant: 'neutral' as const, note: '«Оплата поставшику» jami' },
        { label: 'Zavod mol hisobi (to‘langan − olingan)', value: pv.factoryBalance, variant: 'neutral' as const, note: 'Paddon va qaytarish xarajatisiz mol hisobi. Sof balanslar quyida.' },
        // «Мижозга» — «Мижозлар қолдиғи» varag'ining sotuv ustuni bilan AYNAN bir xil
        { label: 'Mijozga yoziladi', value: pv.clientChargeable, note: t('{n} buyurtma · «Мижозга» ustuni', { n: pv.orders }) },
        { label: 'Mijozlar — paddonsiz sof balans', value: pv.clientDebtTotal, variant: 'neutral' as const, note: 'Sof balans: musbat — qarz, manfiy — avans.' },
        {
          label: 'Mijozlarda poddon', value: pv.pallets?.clientDebt ?? 0, suffix: 'ta',
          note: 'berilgan − qaytargan − puli toʼlangan',
        },
      ],
      margin,
    };
  }, [pv]);

  const doCommit = async () => {
    setPreparing(true);
    try {
      // always recompute the dry-run (under the chosen mode) so the confirm dialog shows
      // the real numbers and the token is fresh (any fix invalidates the previous preview).
      const fresh = (await api.post(`/import/${batchId}/preview`, { mode })).data as Preview & { previewHash: string };
      invalidate();
      const priorCount = s?.priorCommittedImports ?? 0;
      const replacing = mode === 'REPLACE';
      modal.confirm({
        title: replacing ? t('Butun bazani almashtirish?') : t('Maʼlumotlar bazasiga qoʼshish?'),
        icon: <CloudUploadOutlined />,
        width: modalWidth(500),
        // telefonda markazda — aks holda uzun matn ostidagi tasdiq tugmalari ekrandan chiqadi
        centered: isPhone,
        content: (
          <div>
            <p>
              {t('Bu amal')} <b>{s?.rowsByKind.SHIPMENT ?? 0}</b> {t('yuklama,')}{' '}
              <b>{(s?.rowsByKind.CLIENT_PAYMENT ?? 0) + (s?.rowsByKind.FACTORY_PAYMENT ?? 0)}</b> {t('toʼlov va')}{' '}
              <b>{(s?.rowsByKind.PALLET_RETURN ?? 0) + (s?.rowsByKind.FACTORY_PALLET_RETURN ?? 0)}</b>{' '}
              {t('poddon harakatini bazaga yozadi.')}
            </p>
            {replacing ? (
              <p style={{ color: 'var(--ant-color-error)' }}>
                {t('DIQQAT: butun maʼlumotlar bazasi (buyurtma, mijoz, agent, zavod, toʼlov, kassa, ledger, poddon — hammasi) oʼchiriladi va faqat shu fayldan qayta quriladi. Login foydalanuvchilar va sozlamalar saqlanadi. Qaytarib boʼlmaydi.')}
                {priorCount > 0 ? ` (${t('{n} ta avvalgi import ham oʼchadi', { n: priorCount })})` : ''}
              </p>
            ) : (
              <div>
                <p style={{ color: 'var(--ant-color-text-secondary)' }}>{t('Maʼlumot mavjudlarning ustiga qoʼshiladi (avvalgilari saqlanadi).')}</p>
                {priorCount > 0 && <p style={{ color: 'var(--ant-color-warning)' }}>{t('Oldingi import mavjud. Bu faylda o‘sha tarixiy yuk va to‘lovlar takrorlangan bo‘lsa, ustiga qo‘shish ularni yana yozadi va qarzlarni o‘zgartiradi.')}</p>}
              </div>
            )}
            <div style={{ maxHeight: '45vh', overflowY: 'auto' }}>
              <Typography.Paragraph strong>{t('Mijozlar — kutilayotgan sof balans')}</Typography.Paragraph>
              <DualDebtPanel data={clientPreviewDebt(fresh)} party="client" />
              {fresh.factories?.map((factory) => <div key={factory.name} style={{ marginBottom: 12 }}>
                <b>{factory.name}</b>
                <div>{t('Paddonsiz balans')}: <DebtValue value={factory.debtWithoutPallets} party="factory" /></div>
                <div>{t('Paddon bilan balans')}: <DebtValue value={factory.debtWithPallets} party="factory" /></div>
              </div>)}
            </div>
          </div>
        ),
        okText: replacing ? t('Ha, butun bazani almashtirish') : t('Ha, qoʼshish'),
        okButtonProps: replacing ? { danger: true } : undefined,
        cancelText: t('Bekor'),
        onOk: async () => {
          try {
            await commit.mutateAsync({ token: fresh.previewHash, mode });
          } catch (e) {
            // 409 = the token went stale (someone edited in parallel) — close the modal
            // instead of letting OK resend the same expired hash forever
            if ((e as { response?: { status?: number } })?.response?.status === 409) {
              invalidate();
              return;
            }
            throw e;
          }
        },
      });
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setPreparing(false);
    }
  };

  return (
    // pastdagi qat'iy «commit» tasmasi kontentni yopmasin — telefonda tasma
    // ustma-ust joylashadi, shuning uchun zaxira ham kattaroq
    <div style={{ paddingBottom: isPhone ? 176 : 92 }}>
      <PageHeader
        accent
        title={t('Excel importi — koʼrib chiqish')}
        subtitle={s?.batch.filename}
        status={s ? <StatusChip meta={BATCH_META[s.batch.status] ?? BATCH_META.DRAFT} /> : undefined}
        loading={batchQ.isLoading}
        tabs={[
          { key: 'summary', label: t('Xulosa') },
          { key: 'issues', label: `${t('Muammolar')}${problemCount ? ` · ${problemCount}` : ''}` },
        ]}
        activeTab={tab}
        onTabChange={setTab}
        actions={[{ key: 'preview', label: 'Preview', icon: <ReloadOutlined />, onClick: () => preview.mutate() }]}
      />

      {!isAdmin && <Alert style={{ marginBottom: 16 }} type="info" showIcon
        message={t('Ko‘rib chiqish rejimi')}
        description={t('Siz tafsilotlar va Preview hisoblarini ko‘rishingiz mumkin. Importni tuzatish, bazaga yozish va orqaga qaytarish Administrator tomonidan bajariladi.')} />}

      {(s?.identicalCommittedImports ?? 0) > 0 && <Alert style={{ marginBottom: 16 }} type="warning" showIcon
        message={t('Shu fayl avval bazaga import qilingan')}
        description={t('Fayl mazmuni oldingi yakunlangan import bilan aynan bir xil. «Ustiga qo‘shish» buyurtma, to‘lov va qarzlarni takrorlaydi. Mavjud yozuvlarni tekshiring. «To‘liq almashtirish» esa qo‘lda kiritilgan ma’lumotlarni ham o‘chiradi.')} />}

      {tab === 'summary' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <ImportPriceGuide settings={s?.sourceSettings} />
          {blockers.length > 0 && <Alert type="error" showIcon
            message={t('{n} ta maydon aniqlashtirilishi kerak', { n: blockers.length })}
            description={<div>
              <p style={{ marginTop: 0 }}>{t('Narx yoki to‘lov tomoni noma’lum bo‘lsa, qarz va KPI ni ishonchli hisoblab bo‘lmaydi. «Muammolar» bo‘limida aniq mijoz, agent, zavod, katak va qiymatni kim tasdiqlashi ko‘rsatiladi.')}</p>
              <Button onClick={() => setTab('issues')}>{t('Muammolarni ko‘rish')}</Button>
            </div>} />}
          {(s?.priorCommittedImports ?? 0) > 0 && (s?.identicalCommittedImports ?? 0) === 0 &&
            <Alert type="warning" showIcon message={t('Bazaga oldin Excel import qilingan')}
              description={t('To‘liq tarix saqlangan yangi faylni «Ustiga qo‘shish» eski operatsiyalarni takrorlashi mumkin. Qator raqami doimiy identifikator emas. Import rejimini tanlashdan oldin davr va mavjud yozuvlarni solishtiring. «To‘liq almashtirish» barcha biznes ma’lumotlarini, jumladan qo‘lda kiritilganlarni ham o‘chiradi.')} />}
          {s?.batch.status === 'FAILED' && s.batch.error && (
            <Alert type="error" showIcon message={t('Yuborish xatosi')} description={s.batch.error} />
          )}
          {omittedRows.length > 0 && (
            <TableCard
              title={t('{n} ta qator import qilinmadi', { n: omittedRows.length })}
              toolbar={<Alert type="warning" showIcon message={t('Bu qatorlar hisob-kitobga kiritilmaydi. Varaq va qator boʼyicha manba faylni tekshiring.')} />}
            >
              <Table
                size="small"
                rowKey={(r) => `${r.sheet}:${r.row}`}
                dataSource={omittedRows}
                pagination={{ defaultPageSize: 10, showSizeChanger: true, hideOnSinglePage: true }}
                scroll={{ x: 560 }}
                columns={[
                  { title: t('Varaq'), dataIndex: 'sheet', width: 190 },
                  { title: t('Qator'), dataIndex: 'row', width: 70 },
                  { title: t('Sabab'), dataIndex: 'why', render: (why: string) => <span style={wrap}>{why}</span> },
                ]}
              />
            </TableCard>
          )}
          {kpi ? (
            <>
              <KpiBand label="KUTILAYOTGAN BAZA HOLATI (dry-run)" cards={kpi.cards} />
              {pv!.clientDebtWithPallets != null && <div>
                <Typography.Title level={5} style={{ margin: '0 0 8px' }}>{t('Mijozlar — kutilayotgan sof balans')}</Typography.Title>
                <DualDebtPanel data={clientPreviewDebt(pv!)} party="client" />
                <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>{t('Bu jamlanmada barcha mijozlarning qarz va avanslari o‘zaro yig‘ilgan.')}</Typography.Paragraph>
              </div>}
              <TableCard>
                <Typography.Paragraph style={{ margin: 0 }}>
                  {t('Yalpi foyda (transportdan oldin):')} <b>{fmtMoney(kpi.margin)}</b> {t('soʼm — sotuv minus blok tannarxi. Excel «Общая прибль» ustunida transport xarajati ham ayiriladi.')}{' '}
                  {t('Shofyor qoldigʼi')} <b>{fmtMoney(pv!.vehicleBalance)}</b> {t('soʼm — «Расход Авто» toʼlangan boʼlsa 0 boʼladi.')}
                </Typography.Paragraph>
                <Typography.Paragraph style={{ margin: '8px 0 0' }}>
                  {t('Mijoz puli buyurtmalarga avtomatik yopishtiriladi (eng eski buyurtmadan):')}{' '}
                  <b>{fmtMoney(pv!.allocatedToOrders)}</b> {t('soʼm taqsimlandi ·')}{' '}
                  <b>{pv!.ordersFullyPaid}</b> {t('buyurtma toʼliq toʼlangan ·')}{' '}
                  <b>{fmtMoney(pv!.clientAdvanceLeft)}</b> {t('soʼm mijozlarda avans boʼlib qoladi.')}
                </Typography.Paragraph>
                <Typography.Paragraph style={{ margin: '8px 0 0' }}>
                  {t('Zavodga oʼtkazilgan pul olingan molni eng eskisidan boshlab yopadi:')}{' '}
                  <b>{fmtMoney(pv!.factorySettled)}</b> {t('soʼm yopildi ·')}{' '}
                  <b>{pv!.factoryOrdersSettled}</b> {t('buyurtmaning tannarxi aniqlandi')}
                  {(pv!.factoryOrdersPartial ?? 0) > 0 && <> {' · '}<b>{pv!.factoryOrdersPartial}</b> {t('qisman toʼlangan')}</>}
                  {(pv!.factoryOrdersUnpaid ?? 0) > 0 && <> {' · '}<b>{pv!.factoryOrdersUnpaid}</b> {t('umuman toʼlanmagan')}</>}
                  {' · '}{t('yopilmagan mol qarzi')} <b>{fmtMoney(String(Math.abs(+pv!.factoryPayable)))}</b> {t('soʼm.')}
                </Typography.Paragraph>
                <Typography.Paragraph style={{ margin: '8px 0 0' }}>
                  {t('Mijoz toʼlovi ikkiga boʼlinadi:')}{' '}
                  <b>{fmtMoney(pv!.clientPaidGoods)}</b> {t('soʼm MOL uchun («Товарга») ·')}{' '}
                  <b>{fmtMoney(pv!.clientPaidPallets)}</b> {t('soʼm PODDON uchun («Поддон пули»).')}{' '}
                  {t('Faqat mol puli buyurtmalarni yopadi.')}
                </Typography.Paragraph>
                <Typography.Paragraph style={{ margin: '8px 0 0' }}>
                  {t('Transport («Авто услу»):')} <b>{fmtMoney(pv!.transportSettled)}</b> {t('soʼm ·')}{' '}
                  {t('shundan mijoz shofyorga oʼzi bergani («Расход Авто» = Клиент)')}{' '}
                  <b>{fmtMoney(pv!.clientDirectTransport)}</b>{' '}
                  {t('soʼm — bu summa mijoz qarzidan darhol ayiriladi va kassadan oʼtmaydi.')}
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                  {t('Bu raqamlar bazaga yozilmagan — «Yuborish» tugmasini bosguningizcha hech narsa saqlanmaydi.')}
                </Typography.Paragraph>
              </TableCard>
              {pv!.palletPriceDefault && <Alert type="info" showIcon
                message={t('Import bilan poddon narxi ham saqlanadi')}
                description={<><b>{fmtMoney(pv!.palletPriceDefault)}</b> {t('soʼm')}
                  <div>{t('Qaytarilmagan poddonlar shu narxda baholanadi. Oldingi to‘lovlar o‘zgarmaydi.')}</div>
                </>} />}
              {pv!.kpiSettings && <Alert type="info" showIcon
                message={t('Import bilan agent KPI stavkalari ham saqlanadi')}
                description={<>
                  {t('Bir kub uchun soliq')}: <b>{fmtMoney(pv!.kpiSettings.taxPerM3)}</b> {t('soʼm')}
                  {' · '}{t('Agent ulushi')}: <b>{(Number(pv!.kpiSettings.agentShare) * 100).toLocaleString(undefined, { maximumFractionDigits: 6 })}%</b>
                  <div>{t('Stavkalar barcha agentlar va davrlar uchun amal qiladi. Import tasdiqlanganda fayldagi KPI stavkalari qo‘llanadi.')}</div>
                </>} />}
              {/* «тўлов тури» kesimi — egasi Qarzlar sahifasida aynan shu ikki kartani koʼradi,
                  shuning uchun ular commitdan OLDIN, faylni yopmasdan tekshiriladi. */}
              {pv!.factoryByChannel && pv!.factoryByChannel.length > 0 && (
                <TableCard>
                  <Typography.Paragraph style={{ margin: '0 0 8px', fontWeight: 600 }}>
                    {t('Zavod hisobi — «тўлов тури» boʼyicha')}
                  </Typography.Paragraph>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {pv!.factoryByChannel.map((c) => (
                      <div key={c.channel} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '1px solid var(--ant-color-border-secondary)', paddingBottom: 6 }}>
                        <b>{c.channel === 'naqd' ? t('Naqd') : t('Oʼtkazma')}</b>
                        <span style={{ color: 'var(--ant-color-text-secondary)', fontSize: 13 }}>
                          {c.orders} {t('buyurtma')}{' · '}{t('mol')} <b>{fmtMoney(c.goods)}</b>
                          {' · '}{t('zavodga toʼlangan')} <b style={{ color: 'var(--ant-color-success)' }}>{fmtMoney(c.paid)}</b>
                        </span>
                        <span style={{ fontWeight: 700, color: +c.debt > 0 ? 'var(--ant-color-error)' : undefined }}>
                          {t('qarz')} {fmtMoney(c.debt)} {t('soʼm')}
                        </span>
                      </div>
                    ))}
                  </div>
                  <Typography.Paragraph type="secondary" style={{ margin: '10px 0 0', fontSize: 13 }}>
                    {t('Kanal kesimidagi ochiq buyurtma qarzi alohida hisoblanadi. Avans va qaytarish xarajati hisobga olingan paddonsiz hamda paddon bilan sof balanslar quyida ko‘rsatilgan.')}
                  </Typography.Paragraph>
                </TableCard>
              )}
              {/* ZAVODLAR ALOHIDA — yangi shablonda ikkitasi bor va egasi ularni «Поставшиклар
                  ҳисоби» varag'ida qatorma-qator o'qiydi. */}
              {pv!.factories && pv!.factories.length > 0 && (
                <TableCard>
                  <Typography.Paragraph style={{ margin: '0 0 8px', fontWeight: 600 }}>
                    {t('Zavodlar boʼyicha')}
                  </Typography.Paragraph>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {pv!.factories.map((f) => (
                      <div key={f.name}>
                        <Typography.Title level={5} style={{ margin: '0 0 6px' }}>{f.name}</Typography.Title>
                        <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 8 }}>
                          {t('olingan')} <b>{fmtMoney(f.goodsTaken)}</b>
                          {' · '}{t('toʼlangan')} <b style={{ color: 'var(--ant-color-success)' }}>{fmtMoney(f.paid)}</b>
                          {' · '}{t('poddon qarzi')} <b>{f.palletsOwed}</b> {t('ta')}
                          {' · '}{t('Yaroqsiz — qaytarilmaydi')} <b>{f.palletsDefective ?? 0}</b> {t('ta')}
                        </Typography.Paragraph>
                        <DualDebtPanel data={f} party="factory" />
                      </div>
                    ))}
                  </div>
                </TableCard>
              )}
              {/* PADDON — yangi shablonning ikki alohida varagʼi shu yerda yigʼiladi */}
              {pv!.pallets && (
                <TableCard>
                  <Typography.Paragraph style={{ margin: '0 0 8px', fontWeight: 600 }}>
                    {t('Poddon harakati (dona)')}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ margin: 0 }}>
                    {t('Mijozlarga berilgan')} <b>{pv!.pallets.delivered}</b>
                    {' · '}{t('qaytargan')} <b>{pv!.pallets.returnedByClients}</b>
                    {' · '}{t('puli toʼlangan')} <b>{pv!.pallets.paidByClients}</b>
                    {' ⇒ '}{t('mijozlarda qolgan')} <b>{pv!.pallets.clientDebt}</b>
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ margin: '6px 0 0' }}>
                    {t('Zavodga qaytarilgan')} <b>{pv!.pallets.returnedToFactory}</b>
                    {' · '}{t('Yaroqsiz — qaytarilmaydi')} <b>{pv!.pallets.defectiveFromFactory ?? 0}</b>
                    {' · '}{t('Ombor qoldig‘i tuzatmasi')} <b>{pv!.pallets.warehouseAdjustment ?? 0}</b>
                    {' · '}{t("Qo'limizdagi yaroqli poddonlar")} <b>{pv!.pallets.dealerInHand}</b>
                  </Typography.Paragraph>
                  <Typography.Paragraph type="secondary" style={{ margin: '6px 0 0', fontSize: 12 }}>
                    {t('Yaroqli ombor qoldig‘i = mijozlardan qaytgan − zavodga qaytarilgan − yaroqsiz + ombor tuzatmasi.')}
                  </Typography.Paragraph>
                </TableCard>
              )}
              {pv!.cashboxes && pv!.cashboxes.length > 0 && (
                <TableCard>
                  <Typography.Paragraph style={{ margin: '0 0 8px', fontWeight: 600 }}>
                    {t('Kassa — pul qaysi hisobga tushadi')}
                  </Typography.Paragraph>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {pv!.cashboxes.map((b) => (
                      <div key={b.name} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '1px solid var(--ant-color-border-secondary)', paddingBottom: 6 }}>
                        <b>{b.name}</b>
                        <span style={{ color: 'var(--ant-color-text-secondary)', fontSize: 13 }}>
                          {t('kirim')} <b style={{ color: 'var(--ant-color-success)' }}>{fmtMoney(b.in)}</b>
                          {' · '}{t('chiqim')} <b style={{ color: 'var(--ant-color-error)' }}>{fmtMoney(b.out)}</b>
                          {+b.capital > 0 && <> {' · '}{t('diller kapitali')} <b>{fmtMoney(b.capital)}</b></>}
                        </span>
                        <span style={{ fontWeight: 700 }}>{fmtMoney(b.balance)} {t('soʼm')}</span>
                      </div>
                    ))}
                  </div>
                  <Typography.Paragraph type="secondary" style={{ margin: '10px 0 0', fontSize: 13 }}>
                    {t('Mijoz shofyorga bergani')} <b>{fmtMoney(pv!.clientDirectTransport)}</b>{' '}
                    {t('soʼm kassaga TUSHMAYDI — u toʼgʼridan-toʼgʼri haydovchiga berilgan («Расход Авто» = Клиент). U mijoz qarzini kamaytiradi, lekin kassadan oʼtmaydi.')}
                    {+pv!.cashCapital > 0 && <> {' '}{t('Manfiy qolgan hisob «Diller kapitali» bilan 0 ga koʼtariladi (bu sizning oʼz pulingiz).')}</>}
                  </Typography.Paragraph>
                </TableCard>
              )}
            </>
          ) : (
            <TableCard>
              <Typography.Paragraph>
                {t('Balanslarni koʼrish uchun')} <b>{t('Preview')}</b> {t('ni bosing. Import bazaga yozmaydi — avval bu yerda hamma narsani tekshirasiz.')}
              </Typography.Paragraph>
              <Button type="primary" icon={<ReloadOutlined />} loading={preview.isPending} onClick={() => preview.mutate()}>
                {t('Preview hisoblash')}
              </Button>
            </TableCard>
          )}
          {problemCount > 0 && (
            <TableCard>
              <Typography.Paragraph style={{ margin: 0 }}>
                <b style={{ color: '#B23A2E' }}>{t('{n} ta muammo', { n: problemCount })}</b> {t('hal qilinishi kerak. «Muammolar» boʼlimiga oʼting — har birini oʼsha yerning oʼzida toʼgʼirlaysiz.')}
              </Typography.Paragraph>
            </TableCard>
          )}
        </div>
      )}

      {tab === 'issues' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <ImportPriceGuide settings={s?.sourceSettings} />
          {(issuesQ.isLoading || entitiesQ.isLoading) ? (
            <TableCard><Typography.Paragraph style={{ margin: 0 }}>{t('Yuklanmoqda…')}</Typography.Paragraph></TableCard>
          ) : problemCount === 0 ? (
            <TableCard>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={canEdit
                  ? <span>{t('Hamma muammolar hal qilindi ✓ — pastdagi')} <b>{t('«Maʼlumotlar bazasiga yuborish»')}</b> {t('tugmasini bosing.')}</span>
                  : t('Ochiq muammolar yo‘q.')} />
            </TableCard>
          ) : (
            <>
              {pendingEntities.map((e) => (
                <EntityCard key={e.id} entity={e} options={clientOptions} busy={resolving} readOnly={!canEdit}
                  onSave={(name) => resolveEntity.mutate({ mapId: e.id, name })} />
              ))}
              {openIssues.map((i) => (
                <IssueCard key={`${i.id}:${String(i.effectiveValue ?? '')}`} issue={i} clientOptions={clientOptions} busy={resolving} readOnly={!canEdit}
                  onResolve={(status, value) => resolveIssue.mutate({ issueId: i.id, status, value })} />
              ))}
            </>
          )}
        </div>
      )}

      {/* commit gate — telefonda ustunga aylanadi va tab bar + home indicator
          ustida turadi (spec R8): aks holda tab bar uni butunlay yopib qo'yadi.
          Telefondagi zIndex ChatDock FAB'idan (150) past: tasma ~150px baland
          bo'lgani uchun FAB butunlay uning ichiga tushadi va yuqoriroq qatlamda
          bo'lsa AI tugmasi ko'rinmay/bosilmay qolar edi. OrderDetail'dagi
          MobileActionBar bilan bir xil qatlam (140) — tasma tab bar ustida
          joylashgani uchun 200 dan yuqori bo'lishi shart emas. FAB o'ng
          chekkadagi ~56px ni qoplaydi, «yuborish» tugmasining markazdagi
          yorlig'i va bosish maydoni esa to'liq ochiq qoladi. */}
      {createPortal(<div style={{
        position: 'fixed', left: 0, right: 0,
        bottom: isPhone ? 'calc(var(--sb-tabbar-h) + var(--sb-safe-b))' : 0,
        zIndex: isPhone ? 140 : 20,
        display: 'flex',
        flexDirection: isPhone ? 'column' : 'row',
        alignItems: isPhone ? 'stretch' : 'center',
        gap: isPhone ? 8 : 16,
        padding: isPhone ? '10px 12px' : '12px 24px',
        background: 'var(--sb-surface)', color: 'var(--sb-fg)', borderTop: '1px solid var(--sb-border)',
      }}>
        <Space size={isPhone ? 10 : 16} style={{ flex: isPhone ? undefined : 1, fontSize: isPhone ? 12 : undefined }} wrap>
          <span>⛔ {t('{n} toʼsiq', { n: blockers.length })}</span>
          <span>❓ {t('{n} mijoz nomi', { n: pendingEntities.length })}</span>
          <span>⚠ {t('{n} ogoh', { n: openIssues.length - blockers.length })}</span>
        </Space>
        {canEdit ? (
          <Space
            direction="vertical"
            size={2}
            align={isPhone ? undefined : 'end'}
            style={isPhone ? { width: '100%' } : undefined}
          >
            <Segmented
              block={isPhone}
              style={isPhone ? { width: '100%' } : undefined}
              value={mode}
              onChange={(v) => setMode(v as 'APPEND' | 'REPLACE')}
              options={[
                { value: 'APPEND', label: t("Ustiga qoʼshish") },
                { value: 'REPLACE', label: t("Toʼliq almashtirish") },
              ]}
            />
            <span style={{
              fontSize: 11,
              color: mode === 'REPLACE' ? 'var(--ant-color-error)' : 'var(--ant-color-text-tertiary)',
              textAlign: isPhone ? 'center' : undefined,
              display: isPhone ? 'block' : undefined,
            }}>
              {mode === 'REPLACE'
                ? t('butun baza oʼchirilib, shu fayldan qayta quriladi')
                : t('mavjud maʼlumot ustiga qoʼshiladi')}
            </span>
          </Space>
        ) : null}
        {isAdmin && s?.batch.status === 'COMMITTED' && (
          <Button danger ghost size="large" block={isPhone} icon={<RollbackOutlined />} onClick={() => { setRollbackWord(''); setRollbackOpen(true); }}>
            {t('Importni orqaga qaytarish')}
          </Button>
        )}
        {isAdmin && <Button
          type="primary"
          size="large"
          block={isPhone}
          icon={<CloudUploadOutlined />}
          disabled={!s?.commitReady || s?.batch.status === 'COMMITTED' || s?.batch.status === 'ROLLED_BACK' || s?.batch.status === 'COMMITTING'}
          loading={preparing || commit.isPending || s?.batch.status === 'COMMITTING'}
          onClick={doCommit}
        >
          {s?.batch.status === 'COMMITTED' ? t('Yuborilgan ✓')
            : s?.batch.status === 'ROLLED_BACK' ? t('Orqaga qaytarilgan')
              : s?.batch.status === 'COMMITTING' ? t('Yuborilyapti')
                : (blockers.length + pendingEntities.length) > 0 ? t('Avval {n} ta muammoni toʼgʼirlang', { n: blockers.length + pendingEntities.length })
                  : t('Maʼlumotlar bazasiga yuborish')}
        </Button>}
      </div>, document.body)}

      {/* rollback confirm — typed-word guard; POST /import/:id/rollback takes no body,
          so a required-reason ReasonModal would collect a reason we'd silently drop. */}
      <Modal
        open={rollbackOpen}
        title={t('Importni orqaga qaytarish?')}
        okText={t('Orqaga qaytarish')}
        cancelText={t('Bekor')}
        okButtonProps={{ danger: true, disabled: rollbackWord !== 'ROLLBACK', loading: rollback.isPending }}
        cancelButtonProps={{ disabled: rollback.isPending }}
        onOk={() => rollback.mutate()}
        onCancel={() => { if (!rollback.isPending) setRollbackOpen(false); }}
        maskClosable={!rollback.isPending}
        keyboard={!rollback.isPending}
        width={modalWidth(460)}
        centered={isPhone}
        destroyOnHidden
      >
        <div style={{ display: 'grid', gap: 12, marginTop: 4 }}>
          <p style={{ margin: 0 }}>
            {t('Bu import bazaga yozgan hamma narsa bekor qilinadi: buyurtmalar bekor, toʼlovlar storno, poddon va ledger yozuvlari teskari yoziladi. Bu amalni qaytarib boʼlmaydi.')}
          </p>
          <div>
            <div style={{ fontSize: 13, color: 'var(--ant-color-text-secondary)', marginBottom: 6 }}>
              {t('Tasdiqlash uchun «{word}» deb yozing:', { word: 'ROLLBACK' })}
            </div>
            <Input
              value={rollbackWord}
              onChange={(e) => setRollbackWord(e.target.value)}
              placeholder="ROLLBACK"
              disabled={rollback.isPending}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── a pending client-name (spelling variant) — owner picks/types the real name ──
function EntityCard({ entity, options, busy, readOnly, onSave }: {
  entity: Entity; options: { value: string }[]; busy: boolean; readOnly: boolean; onSave: (name: string) => void;
}) {
  const [name, setName] = useState(entity.suggestion?.targetName ?? entity.sourceName);
  const t = useT();
  const isPhone = useIsPhone();

  // telefonda `Space.Compact` yopishtirilgan qatorga sig'maydi (input + uzun
  // tugma) — o'sha ikki bolaning o'zi ustma-ust, to'liq kenglikda chiqadi
  const nameInput = (
    <AutoComplete
      style={{ flex: 1, width: '100%', minWidth: 0 }}
      value={name}
      options={options}
      onChange={setName}
      filterOption={(inp, opt) => (opt?.value ?? '').toLowerCase().includes(inp.toLowerCase())}
      placeholder={t('Mijoz nomini yozing')}
    />
  );
  const saveBtn = (
    <Button type="primary" block={isPhone} icon={<CheckOutlined />} loading={busy} disabled={!name.trim()} onClick={() => onSave(name.trim())}>
      {t('Saqlash')}
    </Button>
  );

  return (
    <TableCard>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusChip meta={SEV.CONFIRM} />
          <code style={{ fontSize: 11.5, minWidth: 0, wordBreak: 'break-word' }}>MIJOZ_NOMI_VARIANTI</code>
          <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>{t('{n} marta', { n: entity.occurrences })}</span>
        </div>
        <div style={{ ...wrap }}>
          «<b>{entity.sourceName}</b>» {t('— bu yozuv qaysi mijoz?')}
          {entity.suggestion && <> {t('Ehtimol')} «<b>{entity.suggestion.targetName}</b>» {t('({pct}% oʼxshash).', { pct: Math.round(entity.suggestion.confidence * 100) })}</>}
          {' '}{t('Toʼgʼri nomni tanlang yoki yozing.')}
        </div>
        {!readOnly && (isPhone ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {nameInput}
            {saveBtn}
          </div>
        ) : (
          <Space.Compact style={{ maxWidth: 460 }}>
            {nameInput}
            {saveBtn}
          </Space.Compact>
        ))}
      </div>
    </TableCard>
  );
}

// ── a validation issue — inline editor typed by the field it touches ──
function IssueCard({ issue, clientOptions, busy, readOnly, onResolve }: {
  issue: Issue; clientOptions: { value: string }[]; busy: boolean; readOnly: boolean;
  onResolve: (status: 'ACCEPTED' | 'IGNORED', value?: unknown) => void;
}) {
  const t = useT();
  const isPhone = useIsPhone();
  const field = issue.field ?? '';
  const isClient = CLIENT_FIELDS.has(field);
  const isNumeric = NUMERIC.has(field);
  const isDate = field === 'date';
  const isText = ['receiver', 'payer', 'factoryRaw', 'agentRaw'].includes(field);
  const isTransportPayer = field === 'transportPayerRaw';
  const isPalletMovement = field === 'movementType';
  // «Утказилган пул» kanali — a CLOSED list, never free text: this one cell decides which
  // kassa the money left and which factory pocket the advance stands in, and a typo here
  // would only be caught at commit time (the commit refuses an unknown channel).
  const isChannel = field === 'channel';
  // Both channel fields use the names in the Smart blok journal.
  const isPayType = field === 'factoryPayChannel';
  const editable = isClient || isNumeric || isDate || isText || isChannel || isPayType || isTransportPayer;
  const hasSug = issue.suggestedValue != null;
  const isBlock = issue.severity === 'BLOCK';

  const effective = Object.prototype.hasOwnProperty.call(issue, 'effectiveValue') ? issue.effectiveValue : issue.currentValue;
  const initial = hasSug ? issue.suggestedValue
    : isNumeric ? (typeof effective === 'number' || typeof effective === 'string' ? effective : null)
      : isDate ? (effective ? String(effective) : null)
        : effective == null ? '' : String(effective);
  const [val, setVal] = useState<unknown>(initial);
  const countIssue = ['PODDON_NISBATI', 'MOSHINA_SIGIMI', 'PADDON_ORTIQCHA', 'PADDON_TUZATISH'].includes(issue.ruleId);
  const unit = issue.guidance?.unit ?? (COUNT_FIELDS.has(field) || countIssue ? t('ta') : field === 'cube' ? 'm³' : t('soʼm'));
  const canApplySuggestion = !!issue.field && !!issue.rowId;

  const numericValid = val != null && val !== '' && Number.isFinite(Number(val)) &&
    (!COUNT_FIELDS.has(field) || Number.isSafeInteger(Number(val))) &&
    (!POSITIVE_FIELDS.has(field) || Number(val) > 0) &&
    (!NONNEGATIVE_FIELDS.has(field) || Number(val) >= 0);
  const valid = isNumeric ? numericValid : isDate ? !!val && dayjs(String(val)).isValid()
    : isClient || isText || isChannel || isPayType || isTransportPayer ? String(val ?? '').trim().length > 0 : true;
  const save = () => onResolve('ACCEPTED', isNumeric
    ? COUNT_FIELDS.has(field) || field === 'cube' ? Number(val) : String(val)
    : isText || isClient || isChannel || isPayType || isTransportPayer ? String(val).trim() : val);

  // Telefonda tahrirlagich va tugmalar bitta qatorga sig'maydi (320px da
  // `minWidth: 320` mumkin emas) — muharrir to'liq kenglikda, tugmalar ostida.
  const editor = isClient ? (
    <AutoComplete
      style={{ flex: 1, minWidth: isPhone ? 0 : 220, width: isPhone ? '100%' : undefined }}
      value={String(val ?? '')}
      options={clientOptions}
      onChange={(v) => setVal(v)}
      filterOption={(inp, opt) => (opt?.value ?? '').toLowerCase().includes(inp.toLowerCase())}
      placeholder={t('Mijoz nomini yozing')}
    />
  ) : isNumeric ? (
    <InputNumber
      style={{ flex: 1, minWidth: isPhone ? 0 : 160, width: isPhone ? '100%' : undefined }}
      stringMode
      value={val == null ? null : String(val)}
      onChange={(v) => setVal(v)}
      min={POSITIVE_FIELDS.has(field) || NONNEGATIVE_FIELDS.has(field) ? '0' : undefined}
      precision={COUNT_FIELDS.has(field) ? 0 : field === 'cube' ? 3 : undefined}
      formatter={moneyFmt}
      parser={moneyParse}
      addonAfter={unit}
    />
  ) : isDate ? (
    <DatePicker
      style={{ flex: 1, width: isPhone ? '100%' : undefined }}
      value={val && dayjs(String(val)).isValid() ? dayjs(String(val)) : undefined}
      onChange={(d) => setVal(d ? d.format('YYYY-MM-DD') : null)}
    />
  ) : isPalletMovement ? (
    <Select
      style={{ flex: 1, minWidth: isPhone ? 0 : 220, width: isPhone ? '100%' : undefined }}
      value={String(val ?? '') || undefined}
      onChange={(v) => setVal(v)}
      placeholder={t('Harakat turini tanlang')}
      options={[
        { value: 'RETURNED_TO_FACTORY', label: t('Zavodga qaytarilgan') },
        { value: 'DEFECTIVE_FROM_FACTORY', label: t('Yaroqsiz — qaytarilmaydi') },
      ]}
    />
  ) : isChannel || isPayType || isTransportPayer ? (
    <Select
      style={{ flex: 1, minWidth: isPhone ? 0 : 200, width: isPhone ? '100%' : undefined }}
      value={String(val ?? '') || undefined}
      onChange={(v) => setVal(v)}
      placeholder={t(isTransportPayer ? 'Transportni kim toʼlagan?' : 'Kanalni tanlang')}
      options={isTransportPayer
        ? [
          { value: 'Клиент', label: t('Mijoz') },
          { value: 'Сотувчи', label: t('Sotuvchi') },
        ]
        : [
          { value: 'Перечисления', label: t('Bank oʼtkazmasi') },
          { value: 'Касса', label: t('Naqd') },
        ]}
    />
  ) : (
    <Input
      style={{ flex: 1, width: isPhone ? '100%' : undefined }}
      value={String(val ?? '')}
      onChange={(e) => setVal(e.target.value)}
      placeholder={t('Qiymatni yozing')}
    />
  );
  const fixBtn = (
    <Button type="primary" block={isPhone} icon={<CheckOutlined />} loading={busy} disabled={!valid} onClick={save}>
      {t('Toʼgʼrilash')}
    </Button>
  );
  const acceptSugBtn = (
    <Button type="primary" ghost block={isPhone} icon={<CheckOutlined />} loading={busy} onClick={() => onResolve('ACCEPTED', issue.suggestedValue)}>
      {t('Toʼgʼrilash')}
    </Button>
  );
  const ignoreBtn = (
    <Button block={isPhone} loading={busy} onClick={() => onResolve('IGNORED')}>
      {hasSug || editable ? t('Shundoq toʼgʼri') : t('Tushundim')}
    </Button>
  );

  return (
    <TableCard bodyPadding={16}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusChip meta={SEV[issue.severity]} />
          {issue.guidance && <b>{issue.guidance.fieldLabel}{issue.guidance.sourceCell ? ` · ${issue.guidance.sourceCell}` : ''}</b>}
          <code style={{ fontSize: 11.5, minWidth: 0, wordBreak: 'break-word' }}>{issue.ruleId.replace(/^AI_/, '🤖 ')}</code>
        </div>
        <div style={{ ...wrap }}>{issue.message}</div>
        <ImportIssueDetails context={issue.context} guidance={issue.guidance} />
        {issue.field && Object.prototype.hasOwnProperty.call(issue, 'effectiveValue') && (
          <div style={{ ...wrap, fontSize: 13 }}>
            <b>{t('Joriy qiymat')}:</b> {importValue(issue.effectiveValue, t('Kiritilmagan'))}{issue.effectiveValue != null && issue.guidance?.unit ? ` ${t(issue.guidance.unit)}` : ''}
            {Object.prototype.hasOwnProperty.call(issue, 'sourceValue') && String(issue.sourceValue ?? '') !== String(issue.effectiveValue ?? '') &&
              <div><b>{t('Asl fayldagi qiymat')}:</b> {importValue(issue.sourceValue, t('Kiritilmagan'))}</div>}
          </div>
        )}
        {isBlock && !editable && !hasSug && (
          <Typography.Text type="secondary">
            {t('Manba Excel faylda koʼrsatilgan qatorni toʼgʼrilab, faylni qayta yuklang.')}
          </Typography.Text>
        )}

        {hasSug && (
          <div style={{ fontSize: 12.5, wordBreak: 'break-word' }}>
            <span style={{ color: 'var(--ant-color-text-tertiary)', textDecoration: 'line-through' }}>{fmtVal(issue.currentValue, unit)}</span>
            {' → '}<b style={{ color: '#2b7f52' }}>{fmtVal(issue.suggestedValue, unit)}</b>
          </div>
        )}
        {hasSug && !canApplySuggestion && <Typography.Text type="secondary">
          {t('Bu hisobiy taxmin. Haqiqiy dona yoki summani hujjat bilan tekshiring; qiymat avtomatik almashtirilmaydi. Xato bo‘lsa manba faylni tuzatib qayta yuklang.')}
        </Typography.Text>}

        {!readOnly && (isPhone ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {editable && editor}
            {editable && fixBtn}
            {!editable && hasSug && canApplySuggestion && acceptSugBtn}
            {!isBlock && ignoreBtn}
          </div>
        ) : (
          <Space wrap style={{ rowGap: 8 }}>
            {editable && (
              <Space.Compact style={{ minWidth: isClient ? 320 : 220 }}>
                {editor}
                {fixBtn}
              </Space.Compact>
            )}
            {!editable && hasSug && canApplySuggestion && acceptSugBtn}
            {!isBlock && ignoreBtn}
          </Space>
        ))}
      </div>
    </TableCard>
  );
}
