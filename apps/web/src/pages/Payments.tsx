import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Drawer } from '../components/ui/Drawer';
import { Field, Input, Select } from '../components/ui/Field';
import { MoneyInput } from '../components/ui/MoneyInput';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { fmtUZS, fmtDate } from '../lib/format';
import { cn } from '../lib/utils';

const methods: Record<string, string> = { CASH: 'Naqd', CLICK: 'Click', TERMINAL: 'Terminal', USD: 'Dollar', BANK: 'Bank' };
const typeMeta: Record<string, { label: string; tone: any; dir: 'IN' | 'OUT' }> = {
  CLIENT: { label: 'Mijozdan', tone: 'green', dir: 'IN' },
  FACTORY: { label: 'Zavodga', tone: 'red', dir: 'OUT' },
  VEHICLE: { label: 'Moshinaga', tone: 'amber', dir: 'OUT' },
};
const empty = { date: new Date().toISOString().slice(0, 10), type: 'CLIENT', clientId: '', factoryId: '', vehicleId: '', agentId: '', method: 'CASH', amount: 0, usdAmount: 0, rate: 12700, payerName: '', note: '' };

export default function Payments() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);

  const { data: payments } = useQuery({ queryKey: ['payments'], queryFn: () => endpoints.payments() });
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: endpoints.clients });
  const { data: factories } = useQuery({ queryKey: ['factories'], queryFn: endpoints.factories });
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: endpoints.vehicles });

  const create = useMutation({ mutationFn: (d: any) => endpoints.createPayment(d), onSuccess: () => { qc.invalidateQueries(); setOpen(false); setForm(empty); toast("To'lov qo'shildi"); }, onError: (e: any) => toast(e?.response?.data?.message || 'Xatolik', 'error') });
  const del = useMutation({ mutationFn: (id: string) => endpoints.deletePayment(id), onSuccess: () => { qc.invalidateQueries(); toast("O'chirildi"); } });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const amountPreview = useMemo(() => (form.method === 'USD' ? (Number(form.usdAmount) || 0) * (Number(form.rate) || 0) : Number(form.amount) || 0), [form]);

  const party = (pmt: any) => pmt.client?.name || pmt.factory?.name || pmt.vehicle?.name || '—';

  const columns: Column<any>[] = [
    { key: 'date', header: 'Sana', render: (p) => fmtDate(p.date), value: (p) => p.date },
    { key: 'type', header: 'Turi', render: (p) => <Badge tone={typeMeta[p.type]?.tone ?? 'neutral'} dot>{typeMeta[p.type]?.label ?? p.type}</Badge> },
    { key: 'party', header: 'Kim', render: (p) => <span className="font-medium text-content">{party(p)}</span>, value: (p) => party(p) },
    { key: 'method', header: 'Usul', render: (p) => methods[p.method] ?? p.method },
    { key: 'amount', header: 'Summa', align: 'right', value: (p) => p.amount, render: (p) => {
      const dir = typeMeta[p.type]?.dir ?? 'IN';
      return <span className={cn('inline-flex items-center gap-1 font-semibold tabular-nums', dir === 'IN' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
        {dir === 'IN' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{fmtUZS(p.amount)}</span>;
    } },
  ];

  return (
    <div>
      <PageHeader title="To'lovlar" subtitle="Barcha tranzaksiyalar: mijozdan kirim, zavod/moshinaga chiqim" breadcrumb={['Moliya', "To'lovlar"]}
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Yangi to'lov</Button>} />

      <EntityTable columns={columns} data={payments} rowKey={(p) => p.id} exportName="tolovlar"
        searchKeys={[(p) => party(p), 'payerName']}
        actions={(p) => <button onClick={() => del.mutate(p.id)} className="rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500"><Trash2 size={15} /></button>} />

      <Drawer open={open} onClose={() => setOpen(false)} title="Yangi to'lov" subtitle="To'lov turini tanlang — kassaga avtomatik yoziladi">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form }); }} className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(typeMeta).map(([k, v]) => (
              <button key={k} type="button" onClick={() => set('type', k)}
                className={cn('rounded-lg border p-2.5 text-sm font-medium transition', form.type === k ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover')}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sana" required><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required /></Field>
            <Field label="Usul" required><Select value={form.method} onChange={(e) => set('method', e.target.value)}>{Object.entries(methods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            {form.type === 'CLIENT' && <Field label="Mijoz" required><Select value={form.clientId} onChange={(e) => set('clientId', e.target.value)} required><option value="">—</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
            {form.type === 'FACTORY' && <Field label="Zavod" required><Select value={form.factoryId} onChange={(e) => set('factoryId', e.target.value)} required><option value="">—</option>{(factories ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>}
            {form.type === 'VEHICLE' && <Field label="Moshina" required><Select value={form.vehicleId} onChange={(e) => set('vehicleId', e.target.value)} required><option value="">—</option>{(vehicles ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>}
            {form.method === 'USD' ? (
              <>
                <Field label="Dollar ($)"><Input type="number" value={form.usdAmount} onChange={(e) => set('usdAmount', e.target.value)} /></Field>
                <Field label="Kurs"><Input type="number" value={form.rate} onChange={(e) => set('rate', e.target.value)} /></Field>
              </>
            ) : (
              <Field label="Summa"><MoneyInput value={form.amount} onChange={(v) => set('amount', v)} /></Field>
            )}
            {form.type === 'CLIENT' && <Field label="To'lovchi"><Input value={form.payerName} onChange={(e) => set('payerName', e.target.value)} /></Field>}
            <div className="col-span-2"><Field label="Izoh (nima uchun)"><Input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="masalan: iyun tovar uchun" /></Field></div>
          </div>
          <div className="rounded-lg bg-subtle p-3 text-sm"><span className="text-xs text-faint">Jami: </span><span className="font-bold tabular-nums">{fmtUZS(amountPreview)}</span></div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button>
            <Button type="submit" loading={create.isPending}>Saqlash</Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
