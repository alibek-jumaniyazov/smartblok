import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Banknote, CreditCard, Landmark, DollarSign, ArrowUpRight, ArrowDownRight, Trash2 } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { KpiCard } from '../components/ui/KpiCard';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Drawer } from '../components/ui/Drawer';
import { Field, Input, Select } from '../components/ui/Field';
import { MoneyInput } from '../components/ui/MoneyInput';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { fmtNum, fmtDate } from '../lib/format';
import { cn } from '../lib/utils';

const typeIcon: Record<string, any> = { CASH: Banknote, CLICK: CreditCard, BANK: Landmark };

export default function Kassa() {
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ cashboxId: '', direction: 'IN', amount: 0, rate: 12700, note: '', date: new Date().toISOString().slice(0, 10) });

  const { data: summary } = useQuery({ queryKey: ['kassa'], queryFn: endpoints.kassaSummary });
  const { data: txs } = useQuery({ queryKey: ['kassaTx', selected], queryFn: () => endpoints.kassaTransactions(selected ?? undefined) });

  const create = useMutation({ mutationFn: (d: any) => endpoints.createKassaTx(d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['kassa'] }); qc.invalidateQueries({ queryKey: ['kassaTx'] }); setOpen(false); toast('Amaliyot saqlandi'); } });
  const del = useMutation({ mutationFn: (id: string) => endpoints.deleteKassaTx(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['kassa'] }); qc.invalidateQueries({ queryKey: ['kassaTx'] }); toast("O'chirildi"); } });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const selectedBox = useMemo(() => summary?.boxes?.find((b: any) => b.id === selected), [summary, selected]);
  const formBox = useMemo(() => summary?.boxes?.find((b: any) => b.id === form.cashboxId), [summary, form.cashboxId]);

  function openTx(boxId?: string) {
    setForm({ cashboxId: boxId ?? summary?.boxes?.[0]?.id ?? '', direction: 'IN', amount: 0, rate: 12700, note: '', date: new Date().toISOString().slice(0, 10) });
    setOpen(true);
  }

  const columns: Column<any>[] = [
    { key: 'date', header: 'Sana', render: (t) => fmtDate(t.date) },
    { key: 'cashbox', header: 'Kassa', render: (t) => t.cashbox?.name ?? '—' },
    { key: 'direction', header: 'Turi', render: (t) => t.direction === 'IN' ? <Badge tone="green"><ArrowUpRight size={12} /> Kirim</Badge> : <Badge tone="red"><ArrowDownRight size={12} /> Chiqim</Badge> },
    { key: 'source', header: 'Manba', render: (t) => t.source === 'PAYMENT' ? "To'lov" : t.source === 'EXPENSE' ? 'Xarajat' : "Qo'lda" },
    { key: 'note', header: 'Izoh', render: (t) => t.note ?? '—' },
    { key: 'amount', header: 'Summa', align: 'right', value: (t) => t.amount, render: (t) => (
      <span className={cn('font-semibold tabular-nums', t.direction === 'IN' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
        {t.direction === 'IN' ? '+' : '−'}{fmtNum(t.amount)} {t.cashbox?.currency === 'USD' ? '$' : "so'm"}
      </span>) },
  ];

  return (
    <div>
      <PageHeader title="Kassalar" subtitle="Naqt (so'm/dollar), Click va Bank kassalari" breadcrumb={['Moliya', 'Kassalar']}
        action={<Button onClick={() => openTx()}><Plus size={16} /> Kirim / Chiqim</Button>} />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard label="Naqd kassa jami (so'm)" value={summary?.totalUZS ?? 0} suffix="so'm" tone="teal" icon={<Banknote size={20} />} />
        <KpiCard label="Dollar kassa" value={summary?.totalUSD ?? 0} suffix="$" tone="amber" icon={<DollarSign size={20} />} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(summary?.boxes ?? []).map((b: any, i: number) => {
          const Icon = typeIcon[b.type] ?? Banknote;
          const active = selected === b.id;
          return (
            <motion.button key={b.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} whileHover={{ y: -3 }}
              onClick={() => setSelected(active ? null : b.id)}
              className={cn('rounded-lg border p-4 text-left shadow-e1 transition-colors', active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-line bg-surface hover:bg-hover')}>
              <div className="flex items-center justify-between">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/12 text-primary"><Icon size={18} /></div>
                <Badge tone="neutral">{b.currency}</Badge>
              </div>
              <p className="mt-3 text-xs text-muted">{b.name}</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums text-content">{fmtNum(b.balance)} <span className="text-sm text-faint">{b.currency === 'USD' ? '$' : "so'm"}</span></p>
              <div className="mt-2 flex gap-3 text-[11px]"><span className="text-emerald-600 dark:text-emerald-400">↑ {fmtNum(b.inTotal)}</span><span className="text-red-600 dark:text-red-400">↓ {fmtNum(b.outTotal)}</span></div>
            </motion.button>
          );
        })}
      </div>

      <Card padded={false}>
        <div className="flex items-center justify-between p-4">
          <h3 className="text-[15px] font-semibold text-content">{selectedBox ? `${selectedBox.name} — amaliyotlar` : 'Barcha amaliyotlar'}</h3>
          {selected && <Button size="sm" variant="outline" onClick={() => setSelected(null)}>Barchasi</Button>}
        </div>
        <div className="px-4 pb-4">
          <EntityTable columns={columns} data={txs} rowKey={(t) => t.id} searchKeys={['note', (t) => t.cashbox?.name ?? '']} exportName="kassa"
            actions={(t) => <button onClick={() => del.mutate(t.id)} className="rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500"><Trash2 size={15} /></button>} />
        </div>
      </Card>

      <Drawer open={open} onClose={() => setOpen(false)} title="Kassa amaliyoti" subtitle="Kirim yoki chiqim">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form }); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kassa" required><Select value={form.cashboxId} onChange={(e) => set('cashboxId', e.target.value)} required><option value="">—</option>{(summary?.boxes ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
            <Field label="Turi" required><Select value={form.direction} onChange={(e) => set('direction', e.target.value)}><option value="IN">Kirim</option><option value="OUT">Chiqim</option></Select></Field>
          </div>
          <Field label="Summa" required><MoneyInput value={form.amount} onChange={(v) => set('amount', v)} currency={formBox?.currency === 'USD' ? '$' : "so'm"} /></Field>
          {formBox?.currency === 'USD' && <Field label="Kurs (so'm)"><Input type="number" value={form.rate} onChange={(e) => set('rate', e.target.value)} /></Field>}
          <Field label="Sana"><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="Izoh"><Input value={form.note} onChange={(e) => set('note', e.target.value)} /></Field>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button><Button type="submit" loading={create.isPending}>Saqlash</Button></div>
        </form>
      </Drawer>
    </div>
  );
}
