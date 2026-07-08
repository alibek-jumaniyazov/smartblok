import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ChevronRight, Eye } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Drawer } from '../components/ui/Drawer';
import { Field, Input, Select } from '../components/ui/Field';
import { MoneyInput } from '../components/ui/MoneyInput';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { statusMeta, ORDER_STATUSES } from '../lib/orderStatus';
import { fmtUZS, fmtDate, fmtNum } from '../lib/format';

const empty = { date: new Date().toISOString().slice(0, 10), agentId: '', clientId: '', factoryId: '', productId: '', vehicleId: '', quantity: 32.8, costPricePerUnit: 500000, salePricePerUnit: 730000, transportFee: 2000000, note: '' };

export default function Orders() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const [detail, setDetail] = useState<any>(null);

  const { data: orders } = useQuery({ queryKey: ['orders'], queryFn: () => endpoints.orders() });
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: endpoints.agents });
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: endpoints.clients });
  const { data: factories } = useQuery({ queryKey: ['factories'], queryFn: endpoints.factories });
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: endpoints.vehicles });
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => endpoints.products() });

  const create = useMutation({ mutationFn: (d: any) => endpoints.createOrder(d), onSuccess: () => { qc.invalidateQueries(); setOpen(false); setForm(empty); toast('Buyurtma yaratildi'); }, onError: () => toast('Xatolik', 'error') });
  const advance = useMutation({ mutationFn: (id: string) => endpoints.advanceOrder(id), onSuccess: () => { qc.invalidateQueries(); toast('Status yangilandi'); }, onError: (e: any) => toast(e?.response?.data?.message || 'Oxirgi bosqich', 'error') });
  const del = useMutation({ mutationFn: (id: string) => endpoints.deleteOrder(id), onSuccess: () => { qc.invalidateQueries(); toast("O'chirildi"); } });

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const factoryProducts = useMemo(() => (products ?? []).filter((p: any) => !form.factoryId || p.factoryId === form.factoryId), [products, form.factoryId]);
  const preview = useMemo(() => {
    const q = Number(form.quantity) || 0, c = Number(form.costPricePerUnit) || 0, s = Number(form.salePricePerUnit) || 0, t = Number(form.transportFee) || 0;
    return { costTotal: q * c, saleTotal: q * s, profit: q * s - q * c - t };
  }, [form]);

  function pickProduct(id: string) {
    const prod = (products ?? []).find((p: any) => p.id === id);
    setForm((f: any) => ({ ...f, productId: id, ...(prod ? { costPricePerUnit: prod.costPrice, salePricePerUnit: prod.salePrice, factoryId: prod.factoryId } : {}) }));
  }

  const columns: Column<any>[] = [
    { key: 'orderNo', header: '№', render: (o) => <span className="font-mono text-xs font-semibold text-muted">{o.orderNo}</span> },
    { key: 'date', header: 'Sana', render: (o) => fmtDate(o.date) },
    { key: 'client', header: 'Mijoz', render: (o) => <span className="font-medium text-content">{o.client?.name}</span> },
    { key: 'agent', header: 'Agent', render: (o) => o.agent?.name ?? '—' },
    { key: 'product', header: 'Mahsulot', render: (o) => o.product?.name ?? '—' },
    { key: 'quantity', header: 'Miqdor', align: 'right', render: (o) => fmtNum(o.quantity, 2) + ' m³' },
    { key: 'saleTotal', header: 'Summa', align: 'right', render: (o) => fmtUZS(o.saleTotal), value: (o) => o.saleTotal },
    { key: 'status', header: 'Holat', render: (o) => <Badge tone={statusMeta[o.status]?.tone ?? 'neutral'} dot>{statusMeta[o.status]?.label ?? o.status}</Badge> },
  ];

  return (
    <div>
      <PageHeader title="Buyurtmalar" subtitle="Agent → mijoz → zavod → moshina. Holat oxirida yakunlanadi." breadcrumb={['Savdo', 'Buyurtmalar']}
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Yangi buyurtma</Button>} />

      <EntityTable columns={columns} data={orders} rowKey={(o) => o.id} exportName="buyurtmalar"
        searchKeys={['orderNo', (o) => o.client?.name ?? '', (o) => o.agent?.name ?? '']}
        onRowClick={(o) => setDetail(o)}
        actions={(o) => (
          <>
            <button title="Batafsil" onClick={() => setDetail(o)} className="rounded-md p-1.5 text-faint hover:bg-hover hover:text-content"><Eye size={15} /></button>
            {ORDER_STATUSES.indexOf(o.status) < ORDER_STATUSES.length - 1 && (
              <button title="Keyingi holat" onClick={() => advance.mutate(o.id)} className="rounded-md p-1.5 text-primary hover:bg-primary/10"><ChevronRight size={15} /></button>
            )}
            <button title="O'chirish" onClick={() => del.mutate(o.id)} className="rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500"><Trash2 size={15} /></button>
          </>
        )} />

      {/* create drawer */}
      <Drawer open={open} onClose={() => setOpen(false)} title="Yangi buyurtma" subtitle="Buyurtma agent, mijoz, zavod, mahsulot va moshinaga bog'lanadi">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form }); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sana" required><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required /></Field>
            <Field label="Agent"><Select value={form.agentId} onChange={(e) => set('agentId', e.target.value)}><option value="">—</option>{(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
            <Field label="Mijoz" required><Select value={form.clientId} onChange={(e) => set('clientId', e.target.value)} required><option value="">—</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Zavod" required><Select value={form.factoryId} onChange={(e) => { set('factoryId', e.target.value); set('productId', ''); }} required><option value="">—</option>{(factories ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
            <Field label="Mahsulot" required><Select value={form.productId} onChange={(e) => pickProduct(e.target.value)} required><option value="">—</option>{factoryProducts.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Moshina"><Select value={form.vehicleId} onChange={(e) => set('vehicleId', e.target.value)}><option value="">—</option>{(vehicles ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
            <Field label="Miqdor (m³)"><Input type="number" step="0.01" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} /></Field>
            <Field label="Kirim narxi (m³)"><MoneyInput value={form.costPricePerUnit} onChange={(v) => set('costPricePerUnit', v)} /></Field>
            <Field label="Sotuv narxi (m³)"><MoneyInput value={form.salePricePerUnit} onChange={(v) => set('salePricePerUnit', v)} /></Field>
            <Field label="Transport haqi"><MoneyInput value={form.transportFee} onChange={(v) => set('transportFee', v)} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-subtle p-3 text-sm">
            <div><p className="text-xs text-faint">Kirim summa</p><p className="font-semibold tabular-nums">{fmtUZS(preview.costTotal)}</p></div>
            <div><p className="text-xs text-faint">Sotuv summa</p><p className="font-semibold tabular-nums">{fmtUZS(preview.saleTotal)}</p></div>
            <div><p className="text-xs text-faint">Foyda</p><p className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUZS(preview.profit)}</p></div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button>
            <Button type="submit" loading={create.isPending}>Saqlash</Button>
          </div>
        </form>
      </Drawer>

      {/* detail drawer */}
      <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail ? `Buyurtma ${detail.orderNo}` : ''} subtitle={detail ? statusMeta[detail.status]?.label : ''}>
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[['Mijoz', detail.client?.name], ['Agent', detail.agent?.name], ['Zavod', detail.factory?.name], ['Mahsulot', detail.product?.name], ['Moshina', detail.vehicle?.name ?? '—'], ['Sana', fmtDate(detail.date)]].map(([k, v]) => (
                <div key={k as string} className="rounded-lg border border-line p-3"><p className="text-xs text-faint">{k}</p><p className="font-medium text-content">{v}</p></div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-subtle p-3 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-faint">Miqdor</p><p className="font-semibold">{fmtNum(detail.quantity, 2)} m³</p></div>
              <div><p className="text-xs text-faint">Kirim</p><p className="font-semibold tabular-nums">{fmtUZS(detail.costTotal)}</p></div>
              <div><p className="text-xs text-faint">Sotuv</p><p className="font-semibold tabular-nums">{fmtUZS(detail.saleTotal)}</p></div>
              <div><p className="text-xs text-faint">Foyda</p><p className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUZS(detail.profit)}</p></div>
            </div>
            {ORDER_STATUSES.indexOf(detail.status) < ORDER_STATUSES.length - 1 && (
              <Button onClick={() => { advance.mutate(detail.id); setDetail(null); }} className="w-full"><ChevronRight size={16} /> Keyingi holatga o'tkazish</Button>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
