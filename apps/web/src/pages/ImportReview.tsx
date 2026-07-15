import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, AutoComplete, Button, DatePicker, Empty, Input, InputNumber, Space, Typography } from 'antd';
import { CheckOutlined, CloudUploadOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, apiError } from '../lib/api';
import { fmtMoney } from '../lib/format';
import { KpiBand, PageHeader, StatusChip, TableCard } from '../components';
import type { StatusMeta } from '../lib/status-maps';

// ── shape of the backend responses (import.service summary/issues/entities) ──
interface BatchSummary {
  batch: { id: string; filename: string; status: string; previewHash: string | null; preview: Preview | null; createdAt: string };
  rowsByKind: Record<string, number>;
  entitiesByDecision: Record<string, number>;
  commitReady: boolean;
  previewFresh: boolean;
  openBlockers: number;
  pendingEntities: number;
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

const SEV: Record<string, StatusMeta> = {
  BLOCK: { label: 'Toʼsiq', light: '#B23A2E', dark: '#E07A6D' },
  CONFIRM: { label: 'Tasdiq', light: '#A06A12', dark: '#D3A24A' },
  WARN: { label: 'Ogoh', light: '#2C6A97', dark: '#6AA8D4' },
  INFO: { label: 'Maʼlumot', light: '#5B6A66', dark: '#9AA8A4' },
};
const BATCH_META: Record<string, StatusMeta> = {
  DRAFT: { label: 'Qoralama', light: '#5B6A66', dark: '#9AA8A4' },
  READY: { label: 'Tayyor', light: '#2B7F52', dark: '#5FC088' },
  COMMITTED: { label: 'Yuborilgan', light: '#0C6B62', dark: '#45BCAF' },
  COMMITTING: { label: 'Yuborilyapti', light: '#A06A12', dark: '#D3A24A' },
  FAILED: { label: 'Xato', light: '#B23A2E', dark: '#E07A6D' },
};

// which staged field a rule edits → picks the right inline input
const NUMERIC = new Set(['transport', 'diff', 'salePrice', 'costPrice', 'total', 'saleSum', 'palletPrice', 'amount']);
const CLIENT_FIELDS = new Set(['clientRaw']);
const wrap = { whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.5 } as const;

const moneyFmt = (v?: string | number) => (v == null || v === '' ? '' : `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
const moneyParse = (v?: string) => (v ?? '').replace(/\s/g, '');
const fmtVal = (v: unknown): string => {
  if (v == null || v === '') return '—';
  const sv = String(v);
  return typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(sv) ? `${fmtMoney(sv)} soʼm` : sv;
};

export default function ImportReview() {
  const { batchId = '' } = useParams();
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [tab, setTab] = useState('summary');
  const [preparing, setPreparing] = useState(false);

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
    onSuccess: () => { message.success('Preview hisoblandi'); invalidate(); },
    onError: (e) => message.error(apiError(e)),
  });
  const resolveIssue = useMutation({
    mutationFn: (v: { issueId: string; status: string; value?: unknown }) =>
      api.post(`/import/${batchId}/issues/${v.issueId}/resolve`, { status: v.status, value: v.value }),
    onSuccess: () => { message.success('Toʼgʼrilandi ✓'); invalidate(); },
    onError: (e) => message.error(apiError(e)),
  });
  const resolveEntity = useMutation({
    mutationFn: (v: { mapId: string; name: string }) => api.post(`/import/${batchId}/entities/${v.mapId}/resolve`, { name: v.name }),
    onSuccess: () => { message.success('Mijoz nomi saqlandi ✓'); invalidate(); },
    onError: (e) => message.error(apiError(e)),
  });
  const commit = useMutation({
    mutationFn: (token: string) => api.post(`/import/${batchId}/commit`, { confirmToken: token }).then((r) => r.data),
    onSuccess: () => { message.success('Bazaga yuborildi ✓'); invalidate(); },
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
    const profitReturned = +pv.saleTotal - +pv.costTotal - 151_650_000; // if all pallets return
    return {
      cards: [
        { label: 'Zavod qoldigʼi', value: pv.factoryBalance, variant: 'in' as const, note: 'Свод Завод B4 = 242 034 270' },
        { label: 'Sotuv jami', value: pv.saleTotal, note: `${pv.orders} buyurtma` },
        { label: 'Mijozlar qarzi', value: pv.clientDebtTotal, variant: 'owedToUs' as const },
        { label: 'Poddon tashqarida', value: pv.palletsOut, suffix: 'ta', note: `${fmtMoney(String(pv.palletsOut * 130000))} soʼm` },
      ],
      profitReturned,
    };
  }, [pv]);

  const doCommit = async () => {
    setPreparing(true);
    try {
      // always recompute the dry-run so the confirm dialog shows current numbers and
      // the token is fresh (any fix invalidates the previous preview).
      const fresh = (await api.post(`/import/${batchId}/preview`)).data as Preview & { previewHash: string };
      invalidate();
      modal.confirm({
        title: 'Maʼlumotlar bazasiga yuborish?',
        icon: <CloudUploadOutlined />,
        width: 460,
        content: (
          <div>
            <p>Bu amal <b>{s?.rowsByKind.SHIPMENT ?? 0}</b> yuklama va <b>{(s?.rowsByKind.CLIENT_PAYMENT ?? 0) + (s?.rowsByKind.FACTORY_PAYMENT ?? 0)}</b> toʼlovni bazaga yozadi.</p>
            <p style={{ color: 'var(--ant-color-text-secondary)' }}>Zavod qoldigʼi <b>{fmtMoney(fresh.factoryBalance)}</b> soʼm · Mijozlar qarzi <b>{fmtMoney(fresh.clientDebtTotal)}</b> soʼm — «Свод Завод» bilan solishtiring.</p>
          </div>
        ),
        okText: 'Ha, yuborish',
        cancelText: 'Bekor',
        onOk: () => commit.mutateAsync(fresh.previewHash),
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
          { key: 'summary', label: 'Xulosa' },
          { key: 'issues', label: `Muammolar${problemCount ? ` · ${problemCount}` : ''}` },
        ]}
        activeTab={tab}
        onTabChange={setTab}
        actions={[{ key: 'preview', label: 'Preview', icon: <ReloadOutlined />, onClick: () => preview.mutate() }]}
      />

      {tab === 'summary' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {kpi ? (
            <>
              <KpiBand label="KUTILAYOTGAN BAZA HOLATI (dry-run)" cards={kpi.cards} />
              <TableCard>
                <Typography.Paragraph style={{ margin: 0 }}>
                  Foyda: agar 1 630 poddon qaytsa <b>+{fmtMoney(String(Math.round(kpi.profitReturned)))}</b> soʼm.
                  Shofyor qoldigʼi <b>{fmtMoney(pv!.vehicleBalance)}</b> (soxta 68.1 mln emas).
                  Bu raqamlar bazaga yozilmagan — «Yuborish» tugmasini bosguningizcha hech narsa saqlanmaydi.
                </Typography.Paragraph>
              </TableCard>
            </>
          ) : (
            <TableCard>
              <Typography.Paragraph>
                Balanslarni koʼrish uchun <b>Preview</b> ni bosing. Import bazaga yozmaydi —
                avval bu yerda hamma narsani tekshirasiz.
              </Typography.Paragraph>
              <Button type="primary" icon={<ReloadOutlined />} loading={preview.isPending} onClick={() => preview.mutate()}>
                Preview hisoblash
              </Button>
            </TableCard>
          )}
          {problemCount > 0 && (
            <TableCard>
              <Typography.Paragraph style={{ margin: 0 }}>
                <b style={{ color: '#B23A2E' }}>{problemCount} ta muammo</b> hal qilinishi kerak.
                «Muammolar» boʼlimiga oʼting — har birini oʼsha yerning oʼzida toʼgʼirlaysiz.
              </Typography.Paragraph>
            </TableCard>
          )}
        </div>
      )}

      {tab === 'issues' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {(issuesQ.isLoading || entitiesQ.isLoading) ? (
            <TableCard><Typography.Paragraph style={{ margin: 0 }}>Yuklanmoqda…</Typography.Paragraph></TableCard>
          ) : problemCount === 0 ? (
            <TableCard>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span>Hamma muammolar hal qilindi ✓ — pastdagi <b>«Maʼlumotlar bazasiga yuborish»</b> tugmasini bosing.</span>} />
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
          <span>⛔ {blockers.length} toʼsiq</span>
          <span>❓ {pendingEntities.length} mijoz nomi</span>
          <span>⚠ {openIssues.length - blockers.length} ogoh</span>
        </Space>
        <Button
          type="primary"
          size="large"
          icon={<CloudUploadOutlined />}
          disabled={!s?.commitReady || s?.batch.status === 'COMMITTED'}
          loading={preparing || commit.isPending}
          onClick={doCommit}
        >
          {s?.batch.status === 'COMMITTED' ? 'Yuborilgan ✓'
            : problemCount > 0 ? `Avval ${problemCount} ta muammoni toʼgʼirlang`
              : 'Maʼlumotlar bazasiga yuborish'}
        </Button>
      </div>
    </div>
  );
}

// ── a pending client-name (spelling variant) — owner picks/types the real name ──
function EntityCard({ entity, options, busy, onSave }: {
  entity: Entity; options: { value: string }[]; busy: boolean; onSave: (name: string) => void;
}) {
  const [name, setName] = useState(entity.suggestion?.targetName ?? entity.sourceName);
  return (
    <TableCard>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusChip meta={SEV.CONFIRM} />
          <code style={{ fontSize: 11.5 }}>MIJOZ_NOMI_VARIANTI</code>
          <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>{entity.occurrences} marta</span>
        </div>
        <div style={{ ...wrap }}>
          «<b>{entity.sourceName}</b>» — bu yozuv qaysi mijoz?
          {entity.suggestion && <> Ehtimol «<b>{entity.suggestion.targetName}</b>» ({Math.round(entity.suggestion.confidence * 100)}% oʼxshash).</>}
          {' '}Toʼgʼri nomni tanlang yoki yozing.
        </div>
        <Space.Compact style={{ maxWidth: 460 }}>
          <AutoComplete
            style={{ flex: 1, width: '100%' }}
            value={name}
            options={options}
            onChange={setName}
            filterOption={(inp, opt) => (opt?.value ?? '').toLowerCase().includes(inp.toLowerCase())}
            placeholder="Mijoz nomini yozing"
          />
          <Button type="primary" icon={<CheckOutlined />} loading={busy} disabled={!name.trim()} onClick={() => onSave(name.trim())}>
            Saqlash
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
                  placeholder="Mijoz nomini yozing"
                />
              ) : isNumeric ? (
                <InputNumber
                  style={{ flex: 1, minWidth: 160 }}
                  value={val as number}
                  onChange={(v) => setVal(v)}
                  min={0}
                  formatter={moneyFmt}
                  parser={moneyParse}
                  addonAfter="soʼm"
                />
              ) : isDate ? (
                <DatePicker
                  style={{ flex: 1 }}
                  value={val ? dayjs(String(val)) : undefined}
                  onChange={(d) => setVal(d ? d.format('YYYY-MM-DD') : null)}
                />
              ) : (
                <Input style={{ flex: 1 }} value={String(val ?? '')} onChange={(e) => setVal(e.target.value)} placeholder="Qiymatni yozing" />
              )}
              <Button type="primary" icon={<CheckOutlined />} loading={busy} disabled={!valid} onClick={save}>
                Toʼgʼrilash
              </Button>
            </Space.Compact>
          )}
          {!editable && hasSug && (
            <Button type="primary" ghost icon={<CheckOutlined />} loading={busy} onClick={() => onResolve('ACCEPTED', issue.suggestedValue)}>
              Toʼgʼrilash
            </Button>
          )}
          {!isBlock && (
            <Button loading={busy} onClick={() => onResolve('IGNORED')}>
              {hasSug || editable ? 'Shundoq toʼgʼri' : 'Tushundim'}
            </Button>
          )}
        </Space>
      </div>
    </TableCard>
  );
}
