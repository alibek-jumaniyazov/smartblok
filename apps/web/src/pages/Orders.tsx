import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ChevronRight, Eye } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Drawer } from '../components/ui/Drawer';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { statusMeta, ORDER_STATUSES } from '../lib/orderStatus';
import { fmtUZS, fmtDate, fmtNum } from '../lib/format';

export default function Orders() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [detail, setDetail] = useState<any>(null);

  const { data: orders } = useQuery({ queryKey: ['orders'], queryFn: () => endpoints.orders() });

  const advance = useMutation({ mutationFn: (id: string) => endpoints.advanceOrder(id), onSuccess: () => { qc.invalidateQueries(); toast('Status yangilandi'); }, onError: (e: any) => toast(e?.response?.data?.message || 'Oxirgi bosqich', 'error') });
  const del = useMutation({ mutationFn: (id: string) => endpoints.deleteOrder(id), onSuccess: () => { qc.invalidateQueries(); toast("O'chirildi"); } });

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
        action={<Button onClick={() => nav('/orders/new')}><Plus size={16} /> Yangi buyurtma</Button>} />

      <EntityTable columns={columns} data={orders} rowKey={(o) => o.id} exportName="buyurtmalar"
        searchKeys={['orderNo', (o) => o.client?.name ?? '', (o) => o.agent?.name ?? '']}
        onRowClick={(o) => setDetail(o)}
        actions={(o) => (
          <>
            <button title="Batafsil" onClick={() => setDetail(o)} className="rounded-lg p-1.5 text-faint transition hover:bg-hover hover:text-content"><Eye size={15} /></button>
            {ORDER_STATUSES.indexOf(o.status) < ORDER_STATUSES.length - 1 && (
              <button title="Keyingi holat" onClick={() => advance.mutate(o.id)} className="rounded-lg p-1.5 text-primary transition hover:bg-primary/10"><ChevronRight size={15} /></button>
            )}
            <button title="O'chirish" onClick={() => del.mutate(o.id)} className="rounded-lg p-1.5 text-faint transition hover:bg-red-500/10 hover:text-red-500"><Trash2 size={15} /></button>
          </>
        )} />

      {/* detail drawer */}
      <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail ? `Buyurtma ${detail.orderNo}` : ''} subtitle={detail ? statusMeta[detail.status]?.label : ''}>
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[['Mijoz', detail.client?.name], ['Agent', detail.agent?.name], ['Zavod', detail.factory?.name], ['Mahsulot', detail.product?.name], ['Moshina', detail.vehicle?.name ?? '—'], ['Sana', fmtDate(detail.date)]].map(([k, v]) => (
                <div key={k as string} className="rounded-xl border border-line bg-surface-2/50 p-3"><p className="text-xs text-faint">{k}</p><p className="font-medium text-content">{v}</p></div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-subtle p-3 text-sm sm:grid-cols-4">
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
