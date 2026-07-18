import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, AutoComplete, Button, DatePicker, Empty, Input, InputNumber, Modal, Segmented, Space, Typography } from 'antd';
import { CheckOutlined, CloudUploadOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, apiError } from '../lib/api';
import { fmtMoney } from '../lib/format';
import { KpiBand, PageHeader, StatusChip, TableCard } from '../components';
import { useT } from '../components/LangContext';
import { translate } from '../lib/i18n';
import type { StatusMeta } from '../lib/status-maps';

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
}
interface Preview {
  orders: number; factoryBalance: string; clientDebtTotal: string; vehicleBalance: string;
  saleTotal: string; costTotal: string; factoryPaidTotal: string; clientPaidTotal: string; palletsOut: number;
}
interface Issue {
  id: string; rowId: string | null; ruleId: string; severity: 'BLOCK' | 'CONFIRM' | 'WARN' | 'INFO';
  field: string | null; message: string; currentValue: unknown; suggestedValue: unknown; status: string;
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
const NUMERIC = new Set(['transport', 'diff', 'salePrice', 'costPrice', 'total', 'saleSum', 'palletPrice', 'amount', 'palletReturn']);
const COUNT_FIELDS = new Set(['palletReturn']); // dona, soʼm emas
const CLIENT_FIELDS = new Set(['clientRaw']);
const wrap = { whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.5 } as const;

const moneyFmt = (v?: string | number) => (v == null || v === '' ? '' : `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
const moneyParse = (v?: string) => (v ?? '').replace(/\s/g, '');
const fmtVal = (v: unknown): string => {
  if (v == null || v === '') return '—';
  const sv = String(v);
  return typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(sv) ? `${fmtMoney(sv)} ${translate('soʼm')}` : sv;
};

export default function ImportReview() {
  const { batchId = '' } = useParams();
  const { message, modal } = App.useApp();
  const t = useT();
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
    mutationFn: () => api.post(`/import/${batchId}/preview`).then((r) => r.data),
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
      message.success(mode === 'REPLACE' ? t('Bazaga yozildi ✓ — avvalgi importlar almashtirildi') : t('Bazaga yuborildi ✓'));
      // REPLACE touched other batches + every downstream aggregate — refresh broadly
      qc.invalidateQueries();
    },
    onError: (e) => message.error(apiError(e)),
  });
  const rollback = useMutation({
    mutationFn: () =>
      api.post(`/import/${batchId}/rollback`).then((r) => r.data as {
        reversedLedger: number; reversedPallets: number; voidedPayments: number; cancelledOrders: number;
      }),
    onSuccess: (d) => {
      setRollbackOpen(false);
      message.success(t('{n} ta yozuv qaytarildi — {p} poddon harakati, {v} toʼlov storno, {o} buyurtma bekor qilindi.', {
        n: d.reversedLedger, p: d.reversedPallets, v: d.voidedPayments, o: d.cancelledOrders,
      }));
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const s = batchQ.data;
  const pv = s?.batch.preview;
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
    const margin = +pv.saleTotal - +pv.costTotal; // = Лист1 «Общая прибль» (sotuv − blok tannarxi)
    return {
      cards: [
        { label: 'Zavod qoldigʼi', value: pv.factoryBalance, variant: 'in' as const, note: 'Лист1 «Завод» bloki bilan solishtiring (faqat blok puli)' },
        { label: 'Sotuv jami', value: pv.saleTotal, note: t('{n} buyurtma', { n: pv.orders }) },
        { label: 'Mijozlar qarzi', value: pv.clientDebtTotal, variant: 'owedToUs' as const, note: 'Лист1 «Ост» jami bilan solishtiring' },
        { label: 'Poddon tashqarida', value: pv.palletsOut, suffix: 'ta', note: 'naturada qaytariladi — zavod balansiga kirmaydi' },
      ],
      margin,
    };
  }, [pv]);

  const doCommit = async () => {
    setPreparing(true);
    try {
      // always recompute the dry-run so the confirm dialog shows current numbers and
      // the token is fresh (any fix invalidates the previous preview).
      const fresh = (await api.post(`/import/${batchId}/preview`)).data as Preview & { previewHash: string };
      invalidate();
      const priorCount = s?.priorCommittedImports ?? 0;
      const replacing = mode === 'REPLACE';
      modal.confirm({
        title: replacing ? t('Maʼlumotni toʼliq almashtirish?') : t('Maʼlumotlar bazasiga qoʼshish?'),
        icon: <CloudUploadOutlined />,
        width: 480,
        content: (
          <div>
            <p>{t('Bu amal')} <b>{s?.rowsByKind.SHIPMENT ?? 0}</b> {t('yuklama va')} <b>{(s?.rowsByKind.CLIENT_PAYMENT ?? 0) + (s?.rowsByKind.FACTORY_PAYMENT ?? 0)}</b> {t('toʼlovni bazaga yozadi.')}</p>
            {replacing ? (
              <p style={{ color: 'var(--ant-color-error)' }}>
                {priorCount > 0
                  ? t('Diqqat: avval {n} ta avvalgi import butunlay orqaga qaytariladi (buyurtma/toʼlov/kassa/ledger storno), soʼng shu fayl yoziladi. Qoʼlda kiritilgan yozuvlar saqlanadi.', { n: priorCount })
                  : t('Orqaga qaytariladigan avvalgi import yoʼq — faqat shu fayl yoziladi.')}
              </p>
            ) : (
              <p style={{ color: 'var(--ant-color-text-secondary)' }}>{t('Maʼlumot mavjudlarning ustiga qoʼshiladi (avvalgilari saqlanadi).')}</p>
            )}
            <p style={{ color: 'var(--ant-color-text-secondary)' }}>{t('Zavod qoldigʼi')} <b>{fmtMoney(fresh.factoryBalance)}</b> {t('soʼm · Mijozlar qarzi')} <b>{fmtMoney(fresh.clientDebtTotal)}</b> {t('soʼm — Лист1 dagi jami/Ост qiymatlari bilan solishtiring.')}</p>
          </div>
        ),
        okText: replacing ? t('Ha, almashtirish') : t('Ha, qoʼshish'),
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
    <div style={{ paddingBottom: 92 }}>
      <PageHeader
        accent
        title="Excel importi — koʼrib chiqish"
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

      {tab === 'summary' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {s?.batch.status === 'FAILED' && s.batch.error && (
            <Alert type="error" showIcon message={t('Yuborish xatosi')} description={s.batch.error} />
          )}
          {kpi ? (
            <>
              <KpiBand label="KUTILAYOTGAN BAZA HOLATI (dry-run)" cards={kpi.cards} />
              <TableCard>
                <Typography.Paragraph style={{ margin: 0 }}>
                  {t('Yalpi foyda («Общая прибль»):')} <b>{fmtMoney(String(Math.round(kpi.margin)))}</b> {t('soʼm — sotuv minus blok tannarxi; transport ayirilgach sof foyda dashboardda koʼrinadi.')}{' '}
                  {t('Shofyor qoldigʼi')} <b>{fmtMoney(pv!.vehicleBalance)}</b> {t('soʼm — «Расход Авто» toʼlangan boʼlsa 0 boʼladi. Bu raqamlar bazaga yozilmagan — «Yuborish» tugmasini bosguningizcha hech narsa saqlanmaydi.')}
                </Typography.Paragraph>
              </TableCard>
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
          {(issuesQ.isLoading || entitiesQ.isLoading) ? (
            <TableCard><Typography.Paragraph style={{ margin: 0 }}>{t('Yuklanmoqda…')}</Typography.Paragraph></TableCard>
          ) : problemCount === 0 ? (
            <TableCard>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span>{t('Hamma muammolar hal qilindi ✓ — pastdagi')} <b>{t('«Maʼlumotlar bazasiga yuborish»')}</b> {t('tugmasini bosing.')}</span>} />
            </TableCard>
          ) : (
            <>
              {pendingEntities.map((e) => (
                <EntityCard key={e.id} entity={e} options={clientOptions} busy={resolving}
                  onSave={(name) => resolveEntity.mutate({ mapId: e.id, name })} />
              ))}
              {openIssues.map((i) => (
                <IssueCard key={i.id} issue={i} clientOptions={clientOptions} busy={resolving}
                  onResolve={(status, value) => resolveIssue.mutate({ issueId: i.id, status, value })} />
              ))}
            </>
          )}
        </div>
      )}

      {/* commit gate */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px',
        background: 'var(--ant-color-bg-container)', borderTop: '1px solid var(--ant-color-border)',
      }}>
        <Space size={16} style={{ flex: 1 }} wrap>
          <span>⛔ {t('{n} toʼsiq', { n: blockers.length })}</span>
          <span>❓ {t('{n} mijoz nomi', { n: pendingEntities.length })}</span>
          <span>⚠ {t('{n} ogoh', { n: openIssues.length - blockers.length })}</span>
        </Space>
        {s && !['COMMITTED', 'ROLLED_BACK', 'COMMITTING'].includes(s.batch.status) ? (
          <Space direction="vertical" size={2} align="end">
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as 'APPEND' | 'REPLACE')}
              options={[
                { value: 'APPEND', label: t("Ustiga qoʼshish") },
                { value: 'REPLACE', label: t("Toʼliq almashtirish") },
              ]}
            />
            <span style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
              {mode === 'REPLACE'
                ? (s.priorCommittedImports > 0
                    ? t('{n} ta avvalgi import almashtiriladi', { n: s.priorCommittedImports })
                    : t('almashtiradigan import yoʼq'))
                : t('mavjud maʼlumot ustiga qoʼshiladi')}
            </span>
          </Space>
        ) : null}
        {s?.batch.status === 'COMMITTED' && (
          <Button danger ghost size="large" icon={<RollbackOutlined />} onClick={() => { setRollbackWord(''); setRollbackOpen(true); }}>
            {t('Importni orqaga qaytarish')}
          </Button>
        )}
        <Button
          type="primary"
          size="large"
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
        </Button>
      </div>

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
        width={460}
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
function EntityCard({ entity, options, busy, onSave }: {
  entity: Entity; options: { value: string }[]; busy: boolean; onSave: (name: string) => void;
}) {
  const [name, setName] = useState(entity.suggestion?.targetName ?? entity.sourceName);
  const t = useT();
  return (
    <TableCard>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusChip meta={SEV.CONFIRM} />
          <code style={{ fontSize: 11.5 }}>MIJOZ_NOMI_VARIANTI</code>
          <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>{t('{n} marta', { n: entity.occurrences })}</span>
        </div>
        <div style={{ ...wrap }}>
          «<b>{entity.sourceName}</b>» {t('— bu yozuv qaysi mijoz?')}
          {entity.suggestion && <> {t('Ehtimol')} «<b>{entity.suggestion.targetName}</b>» {t('({pct}% oʼxshash).', { pct: Math.round(entity.suggestion.confidence * 100) })}</>}
          {' '}{t('Toʼgʼri nomni tanlang yoki yozing.')}
        </div>
        <Space.Compact style={{ maxWidth: 460 }}>
          <AutoComplete
            style={{ flex: 1, width: '100%' }}
            value={name}
            options={options}
            onChange={setName}
            filterOption={(inp, opt) => (opt?.value ?? '').toLowerCase().includes(inp.toLowerCase())}
            placeholder={t('Mijoz nomini yozing')}
          />
          <Button type="primary" icon={<CheckOutlined />} loading={busy} disabled={!name.trim()} onClick={() => onSave(name.trim())}>
            {t('Saqlash')}
          </Button>
        </Space.Compact>
      </div>
    </TableCard>
  );
}

// ── a validation issue — inline editor typed by the field it touches ──
function IssueCard({ issue, clientOptions, busy, onResolve }: {
  issue: Issue; clientOptions: { value: string }[]; busy: boolean;
  onResolve: (status: 'ACCEPTED' | 'IGNORED', value?: unknown) => void;
}) {
  const t = useT();
  const field = issue.field ?? '';
  const isClient = CLIENT_FIELDS.has(field);
  const isNumeric = NUMERIC.has(field);
  const isDate = field === 'date';
  const isText = field === 'receiver' || field === 'payer';
  const editable = isClient || isNumeric || isDate || isText;
  const hasSug = issue.suggestedValue != null;
  const isBlock = issue.severity === 'BLOCK';

  const initial = hasSug ? issue.suggestedValue
    : isNumeric ? (typeof issue.currentValue === 'number' ? issue.currentValue : null)
      : isDate ? (issue.currentValue ? String(issue.currentValue) : null)
        : '';
  const [val, setVal] = useState<unknown>(initial);

  const valid = isNumeric ? val != null && val !== '' : isDate ? !!val : isClient || isText ? String(val ?? '').trim().length > 0 : true;
  const save = () => onResolve('ACCEPTED', isNumeric ? Number(val) : isText || isClient ? String(val).trim() : val);

  return (
    <TableCard>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusChip meta={SEV[issue.severity]} />
          <code style={{ fontSize: 11.5 }}>{issue.ruleId.replace(/^AI_/, '🤖 ')}</code>
        </div>
        <div style={{ ...wrap }}>{issue.message}</div>

        {hasSug && (
          <div style={{ fontSize: 12.5 }}>
            <span style={{ color: 'var(--ant-color-text-tertiary)', textDecoration: 'line-through' }}>{fmtVal(issue.currentValue)}</span>
            {' → '}<b style={{ color: '#2b7f52' }}>{fmtVal(issue.suggestedValue)}</b>
          </div>
        )}

        <Space wrap style={{ rowGap: 8 }}>
          {editable && (
            <Space.Compact style={{ minWidth: isClient ? 320 : 220 }}>
              {isClient ? (
                <AutoComplete
                  style={{ flex: 1, minWidth: 220 }}
                  value={String(val ?? '')}
                  options={clientOptions}
                  onChange={(v) => setVal(v)}
                  filterOption={(inp, opt) => (opt?.value ?? '').toLowerCase().includes(inp.toLowerCase())}
                  placeholder={t('Mijoz nomini yozing')}
                />
              ) : isNumeric ? (
                <InputNumber
                  style={{ flex: 1, minWidth: 160 }}
                  value={val as number}
                  onChange={(v) => setVal(v)}
                  min={0}
                  formatter={moneyFmt}
                  parser={moneyParse}
                  addonAfter={COUNT_FIELDS.has(field) ? t('ta') : t('soʼm')}
                />
              ) : isDate ? (
                <DatePicker
                  style={{ flex: 1 }}
                  value={val ? dayjs(String(val)) : undefined}
                  onChange={(d) => setVal(d ? d.format('YYYY-MM-DD') : null)}
                />
              ) : (
                <Input style={{ flex: 1 }} value={String(val ?? '')} onChange={(e) => setVal(e.target.value)} placeholder={t('Qiymatni yozing')} />
              )}
              <Button type="primary" icon={<CheckOutlined />} loading={busy} disabled={!valid} onClick={save}>
                {t('Toʼgʼrilash')}
              </Button>
            </Space.Compact>
          )}
          {!editable && hasSug && (
            <Button type="primary" ghost icon={<CheckOutlined />} loading={busy} onClick={() => onResolve('ACCEPTED', issue.suggestedValue)}>
              {t('Toʼgʼrilash')}
            </Button>
          )}
          {!isBlock && (
            <Button loading={busy} onClick={() => onResolve('IGNORED')}>
              {hasSug || editable ? t('Shundoq toʼgʼri') : t('Tushundim')}
            </Button>
          )}
        </Space>
      </div>
    </TableCard>
  );
}
