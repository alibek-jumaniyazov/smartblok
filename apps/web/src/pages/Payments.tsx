import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Modal } from '../components/ui/Modal';
import { Field, Input, Select } from '../components/ui/Field';
import { MoneyInput } from '../components/ui/MoneyInput';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { fmtUZS, fmtDate } from '../lib/format';

const methods: Record<string, { label: string; tone: any }> = {
  CASH: { label: 'Naqd', tone: 'green' },
  CLICK: { label: 'Click', tone: 'blue' },
  TERMINAL: { label: 'Terminal', tone: 'blue' },
  USD: { label: 'Dollar', tone: 'amber' },
  TRANSFER: { label: "O'tkazma", tone: 'neutral' },
  OTHER: { label: 'Boshqa', tone: 'neutral' },
};
const empty = { date: new Date().toISOString().slice(0, 10), agentId: '', clientId: '', method: 'TRANSFER', payerName: '', amount: 0, usdAmount: 0, rate: 12700, note: '' };

export default function Payments() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);

  const { data: payments } = useQuery({ queryKey: ['payments'], queryFn: () => endpoints.payments() });
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: endpoints.agents });
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: endpoints.clients });

  const create = useMutation({ mutationFn: (d: any) => endpoints.createPayment(d), onSuccess: () => { qc.invalidateQueries(); setOpen(false); setForm(empty); toast("To'lov qo'shildi"); } });
  const del = useMutation({ mutationFn: (id: number) => endpoints.deletePayment(id), onSuccess: () => { qc.invalidateQueries(); toast("O'chirildi"); } });

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const amountPreview = useMemo(() => (form.method === 'USD' ? (Number(form.usdAmount) || 0) * (Number(form.rate) || 0) : Number(form.amount) || 0), [form]);

  const columns: Column<any>[] = [
    { key: 'date', header: 'Sana', render: (p) => fmtDate(p.date), value: (p) => p.date },
    { key: 'agent', header: 'Agent', render: (p) => p.agent?.name ?? '—' },
    { key: 'client', header: 'Mijoz', render: (p) => <span className="font-medium text-content">{p.client?.name}</span> },
    { key: 'payer', header: "To'lovchi", render: (p) => <span className="text-muted">{p.payerName ?? '—'}</span> },
    { key: 'method', header: 'Usul', render: (p) => <Badge tone={methods[p.method]?.tone ?? 'neutral'} dot>{methods[p.method]?.label ?? p.method}</Badge> },
    { key: 'amount', header: 'Summa', align: 'right', render: (p) => <span className="font-semibold">{fmtUZS(p.amount)}</span>, value: (p) => p.amount },
  ];

  return (
    <div>
      <PageHeader title="To'lovlar" subtitle="Naqd, Click, terminal, dollar, o'tkazma — kassaga avtomatik tushadi" breadcrumb={['Savdo', "To'lovlar"]}
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Yangi to'lov</Button>} />

      <EntityTable columns={columns} data={payments} rowKey={(p) => p.id} exportName="tolovlar"
        searchKeys={[(p) => p.client?.name ?? '', (p) => p.payerName ?? '']}
        actions={(p) => <button onClick={() => del.mutate(p.id)} className="rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500"><Trash2 size={15} /></button>} />

      <Modal open={open} onClose={() => setOpen(false)} title="Yangi to'lov" subtitle="To'lov kassaga avtomatik yoziladi">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form }); }} className="grid grid-cols-2 gap-3">
          <Field label="Sana" required><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required /></Field>
          <Field label="Usul" required><Select value={form.method} onChange={(e) => set('method', e.target.value)}>{Object.entries(methods).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          <Field label="Agent"><Select value={form.agentId} onChange={(e) => set('agentId', e.target.value)}><option value="">—</option>{(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Field label="Mijoz" required><Select value={form.clientId} onChange={(e) => set('clientId', e.target.value)} required><option value="">—</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          {form.method === 'USD' ? (
            <>
              <Field label="Dollar ($)"><Input type="number" value={form.usdAmount} onChange={(e) => set('usdAmount', e.target.value)} /></Field>
              <Field label="Kurs"><Input type="number" value={form.rate} onChange={(e) => set('rate', e.target.value)} /></Field>
            </>
          ) : (
            <Field label="Summa"><MoneyInput value={form.amount} onChange={(v) => set('amount', v)} /></Field>
          )}
          <Field label="To'lovchi (yuridik shaxs)"><Input value={form.payerName} onChange={(e) => set('payerName', e.target.value)} /></Field>
          <div className="col-span-2 rounded-lg bg-subtle p-3 text-sm">
            <span className="text-xs text-faint">Jami summa: </span><span className="font-bold tabular-nums">{fmtUZS(amountPreview)}</span>
          </div>
          <div className="col-span-2 mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button>
            <Button type="submit" loading={create.isPending}>Saqlash</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
