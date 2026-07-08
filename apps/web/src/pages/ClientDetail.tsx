import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Phone, MapPin, UserCog } from 'lucide-react';
import { endpoints } from '../lib/api';
import { Card, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Drawer } from '../components/ui/Drawer';
import { Field, Input, Select } from '../components/ui/Field';
import { MoneyInput } from '../components/ui/MoneyInput';
import { Badge } from '../components/ui/Badge';
import { KpiCard } from '../components/ui/KpiCard';
import { TableSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toaster';
import { statusMeta } from '../lib/orderStatus';
import { fmtUZS, fmtDate, fmtNum } from '../lib/format';

const methods: Record<string, string> = { CASH: 'Naqd', CLICK: 'Click', TERMINAL: 'Terminal', USD: 'Dollar', BANK: 'Bank' };

export default function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ method: 'CASH', amount: 0, date: new Date().toISOString().slice(0, 10), payerName: '' });
  const { data } = useQuery({ queryKey: ['client', id], queryFn: () => endpoints.client(id as string) });

  const pay = useMutation({
    mutationFn: () => endpoints.createPayment({ type: 'CLIENT', clientId: id, ...form }),
    onSuccess: () => { qc.invalidateQueries(); setOpen(false); setForm({ method: 'CASH', amount: 0, date: new Date().toISOString().slice(0, 10), payerName: '' }); toast("To'lov qabul qilindi"); },
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  if (!data) return <TableSkeleton rows={8} />;
  const t = data.totals;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <button onClick={() => nav(-1)} className="rounded-md border border-line p-2 text-muted hover:bg-hover"><ArrowLeft size={18} /></button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-content">{data.name}</h1>
          <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted">
            {data.agent && <span className="flex items-center gap-1"><UserCog size={14} /> {data.agent.name}</span>}
            {data.phone && <span className="flex items-center gap-1"><Phone size={14} /> {data.phone}</span>}
            {data.region && <span className="flex items-center gap-1"><MapPin size={14} /> {data.region.name}</span>}
          </div>
        </div>
        <Button onClick={() => setOpen(true)}><Plus size={16} /> To'lov qabul qilish</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Jami buyurtma" value={t.delivered} suffix="so'm" tone="teal" icon={<Plus size={20} />} hint={`${t.ordersCount} ta buyurtma`} />
        <KpiCard label="Jami to'langan" value={t.paid} suffix="so'm" tone="green" />
        <div className={'rounded-lg border p-5 shadow-e1 ' + (t.balance > 0 ? 'border-red-500/30 bg-red-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{t.balance > 0 ? 'Bizga qarzi' : t.balance < 0 ? 'Avans (biz qarzmiz)' : 'Qarz yo\'q'}</p>
          <p className={'mt-1.5 text-[26px] font-bold tabular-nums ' + (t.balance > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>{fmtUZS(Math.abs(t.balance))}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Buyurtmalar ({data.orders.length})</CardTitle>
          <div className="space-y-1.5">
            {data.orders.map((o: any) => (
              <div key={o.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-content">{o.orderNo} · {o.product?.name}</p>
                  <p className="text-xs text-faint">{fmtDate(o.date)} · {fmtNum(o.quantity, 2)} m³ · {o.factory?.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{fmtUZS(o.saleTotal)}</p>
                  <Badge tone={statusMeta[o.status]?.tone ?? 'neutral'}>{statusMeta[o.status]?.label ?? o.status}</Badge>
                </div>
              </div>
            ))}
            {data.orders.length === 0 && <p className="py-6 text-center text-sm text-faint">Buyurtma yo'q</p>}
          </div>
        </Card>
        <Card>
          <CardTitle>To'lovlar tarixi ({data.payments.length})</CardTitle>
          <div className="space-y-1.5">
            {data.payments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                <div><p className="font-medium text-content">{methods[p.method] ?? p.method}{p.payerName ? ' · ' + p.payerName : ''}</p><p className="text-xs text-faint">{fmtDate(p.date)}</p></div>
                <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUZS(p.amount)}</span>
              </div>
            ))}
            {data.payments.length === 0 && <p className="py-6 text-center text-sm text-faint">To'lov yo'q</p>}
          </div>
        </Card>
      </div>

      <Drawer open={open} onClose={() => setOpen(false)} title="To'lov qabul qilish" subtitle={data.name}>
        <form onSubmit={(e) => { e.preventDefault(); pay.mutate(); }} className="space-y-3">
          <Field label="Usul" required><Select value={form.method} onChange={(e) => set('method', e.target.value)}>{Object.entries(methods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Summa" required><MoneyInput value={form.amount} onChange={(v) => set('amount', v)} /></Field>
          <Field label="Sana"><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="To'lovchi"><Input value={form.payerName} onChange={(e) => set('payerName', e.target.value)} /></Field>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button><Button type="submit" loading={pay.isPending}>Saqlash</Button></div>
        </form>
      </Drawer>
    </div>
  );
}
