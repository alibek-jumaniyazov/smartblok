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

export default function FactoryDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ method: 'BANK', amount: 0, date: new Date().toISOString().slice(0, 10) });
  const { data: factory } = useQuery({ queryKey: ['factory', id], queryFn: () => endpoints.factory(id as string) });
  const { data: orders } = useQuery({ queryKey: ['orders', 'factory', id], queryFn: () => endpoints.orders({ factoryId: id }) });
  const { data: payments } = useQuery({ queryKey: ['payments', 'factory', id], queryFn: () => endpoints.payments({ type: 'FACTORY', factoryId: id }) });

  const pay = useMutation({ mutationFn: () => endpoints.createPayment({ type: 'FACTORY', factoryId: id, ...form }), onSuccess: () => { qc.invalidateQueries(); setOpen(false); toast("Zavodga to'lov saqlandi"); } });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  if (!factory) return <TableSkeleton rows={8} />;
  const delivered = (orders ?? []).filter((o: any) => ['DELIVERED', 'COMPLETED'].includes(o.status));
  const cost = delivered.reduce((s: number, o: any) => s + o.costTotal, 0);
  const paid = (payments ?? []).reduce((s: number, p: any) => s + p.amount, 0);
  const balance = cost - paid;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <button onClick={() => nav(-1)} className="rounded-md border border-line p-2 text-muted hover:bg-hover"><ArrowLeft size={18} /></button>
        <div className="flex-1"><h1 className="text-2xl font-bold text-content">{factory.name}</h1><p className="mt-1 text-sm text-muted">Gazoblok ishlab chiqaruvchi zavod</p></div>
        <Button onClick={() => setOpen(true)}><Plus size={16} /> Zavodga to'lov</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Olingan mahsulot" value={cost} suffix="so'm" tone="teal" />
        <KpiCard label="To'langan" value={paid} suffix="so'm" tone="green" />
        <div className={'rounded-lg border p-5 shadow-e1 ' + (balance > 0 ? 'border-red-500/30 bg-red-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{balance > 0 ? 'Biz qarzmiz' : 'Qarz yo\'q'}</p>
          <p className={'mt-1.5 text-[26px] font-bold tabular-nums ' + (balance > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>{fmtUZS(Math.abs(balance))}</p>
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
          <CardTitle>Olingan buyurtmalar ({orders?.length ?? 0})</CardTitle>
          <div className="space-y-1.5">
            {(orders ?? []).slice(0, 15).map((o: any) => (
              <div key={o.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                <div><p className="font-medium text-content">{o.orderNo} · {o.client?.name}</p><p className="text-xs text-faint">{fmtDate(o.date)} · {fmtNum(o.quantity, 2)} m³</p></div>
                <div className="text-right"><p className="font-semibold tabular-nums">{fmtUZS(o.costTotal)}</p><Badge tone={statusMeta[o.status]?.tone ?? 'neutral'}>{statusMeta[o.status]?.label ?? o.status}</Badge></div>
              </div>
            ))}
            {(orders ?? []).length === 0 && <p className="py-6 text-center text-sm text-faint">Buyurtma yo'q</p>}
          </div>
        </Card>
      </div>

      <Drawer open={open} onClose={() => setOpen(false)} title="Zavodga to'lov" subtitle={factory.name}>
        <form onSubmit={(e) => { e.preventDefault(); pay.mutate(); }} className="space-y-3">
          <Field label="Usul" required><Select value={form.method} onChange={(e) => set('method', e.target.value)}>{Object.entries(methods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Summa" required><MoneyInput value={form.amount} onChange={(v) => set('amount', v)} /></Field>
          <Field label="Sana"><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button><Button type="submit" loading={pay.isPending}>Saqlash</Button></div>
        </form>
      </Drawer>
    </div>
  );
}
