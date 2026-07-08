import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Users, Factory, Truck } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { KpiCard } from '../components/ui/KpiCard';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Card, CardTitle } from '../components/ui/Card';
import { fmtUZS } from '../lib/format';
import { cn } from '../lib/utils';

function BalanceCell({ v, weOwe }: { v: number; weOwe?: boolean }) {
  // clients: +v = they owe us; factories/vehicles: +v = we owe them
  const negative = v < 0;
  return <span className={cn('font-semibold tabular-nums', negative ? 'text-amber-600 dark:text-amber-400' : weOwe ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
    {fmtUZS(Math.abs(v))}{negative ? (weOwe ? ' (ortiqcha)' : ' (avans)') : ''}
  </span>;
}

export default function Debts() {
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ['debts'], queryFn: endpoints.debts });

  const clientCols: Column<any>[] = [
    { key: 'name', header: 'Mijoz', render: (r) => <span className="font-medium text-content">{r.name}</span> },
    { key: 'agent', header: 'Agent', render: (r) => r.agent ?? '—' },
    { key: 'delivered', header: 'Buyurtma', align: 'right', render: (r) => fmtUZS(r.delivered) },
    { key: 'paid', header: "To'lagan", align: 'right', render: (r) => fmtUZS(r.paid) },
    { key: 'balance', header: 'Qoldiq', align: 'right', value: (r) => r.balance, render: (r) => <BalanceCell v={r.balance} /> },
  ];
  const facCols: Column<any>[] = [
    { key: 'name', header: 'Zavod', render: (r) => <span className="font-medium text-content">{r.name}</span> },
    { key: 'cost', header: 'Olingan', align: 'right', render: (r) => fmtUZS(r.cost) },
    { key: 'paid', header: "To'langan", align: 'right', render: (r) => fmtUZS(r.paid) },
    { key: 'balance', header: 'Qoldiq', align: 'right', value: (r) => r.balance, render: (r) => <BalanceCell v={r.balance} weOwe /> },
  ];
  const vehCols: Column<any>[] = [
    { key: 'name', header: 'Moshina', render: (r) => <span className="font-medium text-content">{r.name}</span> },
    { key: 'owed', header: 'Xizmat', align: 'right', render: (r) => fmtUZS(r.owed) },
    { key: 'paid', header: "To'langan", align: 'right', render: (r) => fmtUZS(r.paid) },
    { key: 'balance', header: 'Qoldiq', align: 'right', value: (r) => r.balance, render: (r) => <BalanceCell v={r.balance} weOwe /> },
  ];

  return (
    <div>
      <PageHeader title="Qarzlar" subtitle="Mijoz bizga qarz · biz zavod va moshinaga qarz" breadcrumb={['Moliya', 'Qarzlar']} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Mijozlar bizga qarz" value={data?.totals?.clientsOweUs ?? 0} suffix="so'm" tone="green" hero icon={<Users size={20} />} />
        <KpiCard label="Mijozlar avansi" value={data?.totals?.clientsAdvance ?? 0} suffix="so'm" tone="teal" icon={<Users size={20} />} />
        <KpiCard label="Biz zavodga qarz" value={data?.totals?.weOweFactories ?? 0} suffix="so'm" tone="red" icon={<Factory size={20} />} />
        <KpiCard label="Biz moshinaga qarz" value={data?.totals?.weOweVehicles ?? 0} suffix="so'm" tone="amber" icon={<Truck size={20} />} />
      </div>

      <div className="mt-6 space-y-6">
        <Card padded={false}>
          <div className="p-5 pb-2"><CardTitle><span className="flex items-center gap-2"><Users size={17} /> Mijozlar qarzi</span></CardTitle></div>
          <div className="px-5 pb-5"><EntityTable columns={clientCols} data={data?.clients} rowKey={(r) => r.id} searchKeys={['name']} exportName="mijoz-qarzlari" onRowClick={(r) => nav(`/clients/${r.id}`)} emptyLabel="Qarzdor mijoz yo'q" /></div>
        </Card>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card padded={false}>
            <div className="p-5 pb-2"><CardTitle><span className="flex items-center gap-2"><Factory size={17} /> Zavodlar qarzi</span></CardTitle></div>
            <div className="px-5 pb-5"><EntityTable columns={facCols} data={data?.factories} rowKey={(r) => r.id} searchKeys={['name']} exportName="zavod-qarzlari" onRowClick={(r) => nav(`/factories/${r.id}`)} emptyLabel="Qarz yo'q" /></div>
          </Card>
          <Card padded={false}>
            <div className="p-5 pb-2"><CardTitle><span className="flex items-center gap-2"><Truck size={17} /> Moshinalar qarzi</span></CardTitle></div>
            <div className="px-5 pb-5"><EntityTable columns={vehCols} data={data?.vehicles} rowKey={(r) => r.id} searchKeys={['name']} exportName="moshina-qarzlari" onRowClick={(r) => nav(`/vehicles/${r.id}`)} emptyLabel="Qarz yo'q" /></div>
          </Card>
        </div>
      </div>
    </div>
  );
}
