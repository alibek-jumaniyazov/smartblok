import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Drawer } from '../components/ui/Drawer';
import { Badge } from '../components/ui/Badge';
import { TableSkeleton } from '../components/ui/Skeleton';
import { fmtUZS, fmtDate } from '../lib/format';

export default function Clients() {
  const [openId, setOpenId] = useState<number | null>(null);
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: endpoints.clients });
  const { data: statement } = useQuery({ queryKey: ['statement', openId], queryFn: () => endpoints.statement(openId as number), enabled: openId != null });

  const columns: Column<any>[] = [
    { key: 'name', header: 'Mijoz', render: (c) => <span className="font-medium text-content">{c.name}</span> },
    { key: 'agent', header: 'Agent', render: (c) => c.agent?.name ?? '—' },
    { key: 'region', header: 'Hudud', render: (c) => c.region?.name ?? '—' },
    { key: 'delivered', header: 'Yetkazilgan', align: 'right', render: (c) => fmtUZS(c.delivered), value: (c) => c.delivered },
    { key: 'paid', header: "To'langan", align: 'right', render: (c) => fmtUZS(c.paid), value: (c) => c.paid },
    { key: 'balance', header: 'Qoldiq', align: 'right', value: (c) => c.balance, render: (c) =>
      c.balance < 0 ? <Badge tone="red">{fmtUZS(Math.abs(c.balance))} qarz</Badge>
      : c.balance > 0 ? <Badge tone="green">{fmtUZS(c.balance)} avans</Badge>
      : <Badge tone="neutral">0</Badge> },
    { key: 'palletBalance', header: 'Poddon', align: 'right', render: (c) => c.palletBalance },
    { key: 'view', header: '', align: 'center', render: () => <FileText size={15} className="text-faint" /> },
  ];

  return (
    <div>
      <PageHeader title="Mijozlar" subtitle="Qoldiq = to'lovlar − yetkazishlar. Qatorga bosib hisob-varaqani ko'ring." breadcrumb={['Savdo', 'Mijozlar']} />

      <EntityTable columns={columns} data={clients} rowKey={(c) => c.id} exportName="mijozlar"
        searchKeys={['name', (c) => c.agent?.name ?? '']} onRowClick={(c) => setOpenId(c.id)} />

      <Drawer open={openId != null} onClose={() => setOpenId(null)} title={statement?.client?.name ?? 'Hisob-varaqa'} subtitle="Mijoz hisob-varaqasi (statement)">
        {!statement ? <TableSkeleton rows={8} /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-subtle p-3"><p className="text-xs text-faint">Yetkazilgan</p><p className="font-bold tabular-nums">{fmtUZS(statement.totals.delivered)}</p></div>
              <div className="rounded-lg bg-subtle p-3"><p className="text-xs text-faint">To'langan</p><p className="font-bold tabular-nums">{fmtUZS(statement.totals.paid)}</p></div>
              <div className="col-span-2 rounded-lg bg-primary/8 p-3 ring-1 ring-primary/20">
                <p className="text-xs text-muted">Qoldiq (Ostatok)</p>
                <p className={'text-lg font-extrabold tabular-nums ' + (statement.totals.balance < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
                  {fmtUZS(statement.totals.balance)}{statement.totals.balance < 0 ? ' (qarzdor)' : ''}
                </p>
                <p className="mt-1 text-xs text-faint">Poddon qoldig'i: {statement.totals.palletBalance} dona</p>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-content">Yetkazib berishlar</h4>
              <div className="space-y-1.5">
                {statement.deliveries.map((d: any) => (
                  <div key={d.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                    <div><p className="font-medium text-content">{d.plate ?? '—'} · {d.size ?? ''}</p><p className="text-xs text-faint">{fmtDate(d.date)} · {d.cubes} m³ · {d.palletQty} poddon</p></div>
                    <span className="font-semibold tabular-nums">{fmtUZS(d.amount)}</span>
                  </div>
                ))}
                {statement.deliveries.length === 0 && <p className="text-sm text-faint">Yozuv yo'q</p>}
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-content">To'lovlar</h4>
              <div className="space-y-1.5">
                {statement.payments.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                    <div><p className="font-medium text-content">{p.payerName ?? p.method}</p><p className="text-xs text-faint">{fmtDate(p.date)} · {p.method}</p></div>
                    <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUZS(p.amount)}</span>
                  </div>
                ))}
                {statement.payments.length === 0 && <p className="text-sm text-faint">Yozuv yo'q</p>}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
