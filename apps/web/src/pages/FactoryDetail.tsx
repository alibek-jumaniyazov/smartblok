import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Package } from 'lucide-react';
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

const methods: Record<string, string> = { CASH: 'Naqd', CLICK: 'Click', BANK: 'Bank', USD: 'Dollar' };
const emptyForm = () => ({ method: 'BANK', amount: 0, usdAmount: 0, rate: 12700, date: new Date().toISOString().slice(0, 10), note: '' });

export default function FactoryDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(emptyForm());
  const { data: factory } = useQuery({ queryKey: ['factory', id], queryFn: () => endpoints.factory(id as string) });

  const pay = useMutation({
    mutationFn: () => endpoints.createPayment({ type: 'FACTORY', factoryId: id, ...form }),
    onSuccess: () => { qc.invalidateQueries(); setOpen(false); setForm(emptyForm()); toast("Zavodga to'lov saqlandi"); },
    onError: (e: any) => toast(e?.response?.data?.message || 'Xatolik', 'error'),
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  if (!factory) return <TableSkeleton rows={8} />;
  const t = factory.totals ?? { cost: 0, paid: 0, balance: 0 };
  const orders = factory.orders ?? [];
  const payments = factory.payments ?? [];
  const weOwe = t.balance > 0;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <button onClick={() => nav(-1)} className="rounded-md border border-line p-2 text-muted hover:bg-hover"><ArrowLeft size={18} /></button>
        <div className="flex-1"><h1 className="text-2xl font-bold text-content">{factory.name}</h1><p className="mt-1 text-sm text-muted">Gazoblok ishlab chiqaruvchi zavod</p></div>
        <Button onClick={() => setOpen(true)}><Plus size={16} /> Zavodga to'lov</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Olingan mahsulot" value={t.cost} suffix="so'm" tone="teal" />
        <KpiCard label="To'langan" value={t.paid} suffix="so'm" tone="green" />
        <div className={'rounded-lg border p-5 shadow-e1 ' + (weOwe ? 'border-red-500/30 bg-red-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{weOwe ? 'Biz qarzmiz' : t.balance < 0 ? 'Avans (biz oldindan to\'ladik)' : 'Qarz yo\'q'}</p>
          <p className={'mt-1.5 text-[26px] font-bold tabular-nums ' + (weOwe ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>{fmtUZS(Math.abs(t.balance))}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle><span className="flex items-center gap-2"><Package size={16} /> Mahsulotlari ({factory.products?.length ?? 0})</span></CardTitle>
          <div className="space-y-1.5">
            {(factory.products ?? []).map((p: any) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                <span className="font-medium text-content">{p.name}</span>
                <span className="text-xs text-faint">kirim {fmtNum(p.costPrice)} · sotuv {fmtNum(p.salePrice)}</span>
              </div>
            ))}
            {(factory.products ?? []).length === 0 && <p className="py-6 text-center text-sm text-faint">Mahsulot yo'q</p>}
          </div>
        </Card>
        <Card>
          <CardTitle>Olingan buyurtmalar ({orders.length})</CardTitle>
          <div className="space-y-1.5">
            {orders.map((o: any) => (
              <div key={o.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                <div><p className="font-medium text-content">{o.orderNo} · {o.client?.name}</p><p className="text-xs text-faint">{fmtDate(o.date)} · {fmtNum(o.quantity, 2)} m³ · {o.product?.name}</p></div>
                <div className="text-right"><p className="font-semibold tabular-nums">{fmtUZS(o.costTotal)}</p><Badge tone={statusMeta[o.status]?.tone ?? 'neutral'}>{statusMeta[o.status]?.label ?? o.status}</Badge></div>
              </div>
            ))}
            {orders.length === 0 && <p className="py-6 text-center text-sm text-faint">Buyurtma yo'q</p>}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardTitle>To'lovlar tarixi ({payments.length})</CardTitle>
        <div className="space-y-1.5">
          {payments.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
              <div><p className="font-medium text-content">{methods[p.method] ?? p.method}{p.note ? ' · ' + p.note : ''}</p><p className="text-xs text-faint">{fmtDate(p.date)}{p.cashbox ? ' · ' + p.cashbox.name : ''}</p></div>
              <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">− {fmtUZS(p.amount)}</span>
            </div>
          ))}
          {payments.length === 0 && <p className="py-6 text-center text-sm text-faint">To'lov yo'q</p>}
        </div>
      </Card>

      <Drawer open={open} onClose={() => setOpen(false)} title="Zavodga to'lov" subtitle={factory.name}>
        <form onSubmit={(e) => { e.preventDefault(); pay.mutate(); }} className="space-y-3">
          <Field label="Usul" required><Select value={form.method} onChange={(e) => set('method', e.target.value)}>{Object.entries(methods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          {form.method === 'USD' ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Dollar ($)" required><Input type="number" value={form.usdAmount} onChange={(e) => set('usdAmount', e.target.value)} /></Field>
              <Field label="Kurs" required><Input type="number" value={form.rate} onChange={(e) => set('rate', e.target.value)} /></Field>
            </div>
          ) : (
            <Field label="Summa" required><MoneyInput value={form.amount} onChange={(v) => set('amount', v)} /></Field>
          )}
          <Field label="Sana"><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="Izoh (nima uchun)"><Input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="masalan: iyun oyidagi tovar uchun" /></Field>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button><Button type="submit" loading={pay.isPending}>Saqlash</Button></div>
        </form>
      </Drawer>
    </div>
  );
}
