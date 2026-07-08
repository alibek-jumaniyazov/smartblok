import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Table, Th, Td } from '../components/ui/Table';
import { Modal } from '../components/ui/Modal';
import { Field, Input, Select } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';
import { TableSkeleton } from '../components/ui/Skeleton';
import { fmtUZS, fmtDate } from '../lib/format';

const methods: Record<string, { label: string; tone: any }> = {
  CASH: { label: 'Naqd', tone: 'green' },
  CLICK: { label: 'Click', tone: 'blue' },
  TERMINAL: { label: 'Terminal', tone: 'blue' },
  USD: { label: 'Dollar', tone: 'amber' },
  TRANSFER: { label: "O'tkazma", tone: 'neutral' },
  OTHER: { label: 'Boshqa', tone: 'neutral' },
};

const empty = {
  date: new Date().toISOString().slice(0, 10),
  agentId: '', clientId: '', method: 'TRANSFER', payerName: '',
  amount: 0, usdAmount: 0, rate: 12700, note: '',
};

export default function Payments() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);

  const { data: payments } = useQuery({ queryKey: ['payments'], queryFn: () => endpoints.payments() });
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: endpoints.agents });
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: endpoints.clients });

  const create = useMutation({
    mutationFn: (d: any) => endpoints.createPayment(d),
    onSuccess: () => { qc.invalidateQueries(); setOpen(false); setForm(empty); },
  });
  const del = useMutation({ mutationFn: (id: number) => endpoints.deletePayment(id), onSuccess: () => qc.invalidateQueries() });

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const amountPreview = useMemo(
    () => (form.method === 'USD' ? (Number(form.usdAmount) || 0) * (Number(form.rate) || 0) : Number(form.amount) || 0),
    [form],
  );

  return (
    <div>
      <PageHeader
        title="To'lovlar (Oplata)"
        subtitle="Ko'p usulli to'lovlar: naqd, Click, terminal, dollar, o'tkazma"
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Yangi to'lov</Button>}
      />

      {!payments ? <TableSkeleton /> : (
        <Table head={
          <tr>
            <Th>Sana</Th><Th>Agent</Th><Th>Mijoz</Th><Th>To'lovchi</Th><Th>Usul</Th><Th right>Summa</Th><Th>{''}</Th>
          </tr>
        }>
          {payments.map((p: any) => (
            <tr key={p.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
              <Td>{fmtDate(p.date)}</Td>
              <Td>{p.agent?.name ?? '—'}</Td>
              <Td className="font-medium">{p.client?.name}</Td>
              <Td className="text-ink-500">{p.payerName ?? '—'}</Td>
              <Td><Badge tone={methods[p.method]?.tone ?? 'neutral'}>{methods[p.method]?.label ?? p.method}</Badge></Td>
              <Td right className="font-semibold">{fmtUZS(p.amount)}</Td>
              <Td>
                <button onClick={() => del.mutate(p.id)} className="rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
                  <Trash2 size={15} />
                </button>
              </Td>
            </tr>
          ))}
          {payments.length === 0 && <tr><Td className="py-10 text-center text-ink-400">Hozircha to'lovlar yo'q</Td></tr>}
        </Table>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Yangi to'lov">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form }); }} className="grid grid-cols-2 gap-3">
          <Field label="Sana"><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required /></Field>
          <Field label="Usul">
            <Select value={form.method} onChange={(e) => set('method', e.target.value)}>
              {Object.entries(methods).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
          <Field label="Agent">
            <Select value={form.agentId} onChange={(e) => set('agentId', e.target.value)}>
              <option value="">—</option>
              {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Mijoz">
            <Select value={form.clientId} onChange={(e) => set('clientId', e.target.value)} required>
              <option value="">—</option>
              {(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          {form.method === 'USD' ? (
            <>
              <Field label="Dollar ($)"><Input type="number" value={form.usdAmount} onChange={(e) => set('usdAmount', e.target.value)} /></Field>
              <Field label="Kurs"><Input type="number" value={form.rate} onChange={(e) => set('rate', e.target.value)} /></Field>
            </>
          ) : (
            <Field label="Summa (so'm)"><Input type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
          )}
          <Field label="To'lovchi (yuridik shaxs)"><Input value={form.payerName} onChange={(e) => set('payerName', e.target.value)} /></Field>
          <div className="col-span-2 rounded-xl bg-ink-50 p-3 text-sm dark:bg-ink-950">
            <span className="text-xs text-ink-400">Jami summa: </span>
            <span className="font-bold tabular-nums">{fmtUZS(amountPreview)}</span>
          </div>
          <div className="col-span-2 mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Saqlanmoqda...' : 'Saqlash'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
