import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingUp, Wallet, Factory, Truck, HandCoins, ClipboardList, Landmark, Receipt, Banknote, DollarSign } from 'lucide-react';
import { endpoints } from '../lib/api';
import { KpiCard } from '../components/ui/KpiCard';
import { Card, CardTitle } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { TableSkeleton } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';
import { statusMeta } from '../lib/orderStatus';
import { fmtShort, fmtUZS, fmtNum } from '../lib/format';
import { useAuth } from '../auth/AuthContext';

function CashierDashboard() {
  const { data: k } = useQuery({ queryKey: ['kassa'], queryFn: endpoints.kassaSummary });
  return (
    <div>
      <PageHeader title="Kassa paneli" subtitle="Kassa holati va tushumlar" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard label="Naqd jami (so'm)" value={k?.totalUZS ?? 0} suffix="so'm" tone="teal" hero icon={<Banknote size={20} />} />
        <KpiCard label="Dollar kassa" value={k?.totalUSD ?? 0} suffix="$" tone="amber" icon={<DollarSign size={20} />} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(k?.boxes ?? []).map((b: any, i: number) => (
          <KpiCard key={b.id} label={b.name} value={b.balance} suffix={b.currency === 'USD' ? '$' : "so'm"} tone={i % 2 ? 'blue' : 'slate'} delay={i * 0.05} icon={<Wallet size={20} />} />
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  if (user?.role === 'CASHIER') return <CashierDashboard />;

  const { data: s } = useQuery({ queryKey: ['dashboard'], queryFn: endpoints.dashboard });
  const { data: trend } = useQuery({ queryKey: ['trend'], queryFn: endpoints.salesTrend });
  const { data: perf } = useQuery({ queryKey: ['perf'], queryFn: endpoints.agentPerformance });
  const { data: funnel } = useQuery({ queryKey: ['funnel'], queryFn: endpoints.orderFunnel });

  const trendData = (trend ?? []).map((t: any) => ({ date: new Date(t.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }), sales: t.sales, profit: t.profit }));
  const funnelData = (funnel ?? []).map((f: any) => ({ name: statusMeta[f.status]?.label ?? f.status, count: f.count }));

  return (
    <div>
      <PageHeader title={`Xush kelibsiz, ${user?.name?.split(' ')[0] ?? ''}`} subtitle="Umumiy ko'rsatkichlar va statistika" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Jami sotuv" value={s?.totalSales ?? 0} suffix="so'm" tone="teal" hero delay={0.02} icon={<TrendingUp size={20} />} hint={`${s?.ordersCount ?? 0} yakunlangan`} />
        <KpiCard label="Umumiy foyda" value={s?.totalProfit ?? 0} suffix="so'm" tone="green" delay={0.06} icon={<HandCoins size={20} />} />
        <KpiCard label="Faol buyurtmalar" value={s?.activeOrders ?? 0} tone="violet" delay={0.1} icon={<ClipboardList size={20} />} />
        <KpiCard label="Kassa balansi" value={s?.cashBalance ?? 0} suffix="so'm" tone="blue" delay={0.14} icon={<Landmark size={20} />} />
        <KpiCard label="Mijoz qarzi" value={s?.clientsDebtToUs ?? 0} suffix="so'm" tone="amber" delay={0.18} icon={<Wallet size={20} />} />
        <KpiCard label="Zavodga qarz" value={s?.weOweFactory ?? 0} suffix="so'm" tone="red" delay={0.22} icon={<Factory size={20} />} />
        <KpiCard label="Moshinaga qarz" value={s?.weOweVehicle ?? 0} suffix="so'm" tone="red" delay={0.26} icon={<Truck size={20} />} />
        <KpiCard label="Xarajatlar" value={s?.totalExpense ?? 0} suffix="so'm" tone="slate" delay={0.3} icon={<Receipt size={20} />} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" delay={0.1}>
          <CardTitle>Sotuv va foyda dinamikasi</CardTitle>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ left: -8, right: 8, top: 4 }}>
                <defs>
                  <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563EB" stopOpacity={0.4} /><stop offset="100%" stopColor="#2563EB" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F59E0B" stopOpacity={0.35} /><stop offset="100%" stopColor="#F59E0B" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} stroke="#94a3b8" width={58} />
                <Tooltip formatter={(v: any) => fmtUZS(v)} contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12 }} />
                <Area type="monotone" dataKey="sales" name="Sotuv" stroke="#2563EB" strokeWidth={2.5} fill="url(#gS)" />
                <Area type="monotone" dataKey="profit" name="Foyda" stroke="#F59E0B" strokeWidth={2.5} fill="url(#gP)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card delay={0.16}>
          <CardTitle>Buyurtmalar holati</CardTitle>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} margin={{ left: -8, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#94a3b8" interval={0} angle={-25} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" width={30} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12 }} />
                <Bar dataKey="count" name="Buyurtma" fill="#2563EB" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="mt-6" delay={0.2}>
        <CardTitle>Agentlar reytingi</CardTitle>
        {!perf ? <TableSkeleton rows={5} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
                <tr><th className="py-2">Agent</th><th>Guruh</th><th className="text-right">Buyurtma</th><th className="text-right">Sotuv</th><th className="text-right">Foyda</th><th className="text-right">Yig'ilgan</th></tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {perf.map((p: any) => (
                  <tr key={p.agentId} className="hover:bg-hover">
                    <td className="py-2.5 font-medium text-content">{p.agent}</td>
                    <td><Badge tone="neutral">{p.groupNo ?? '—'}</Badge></td>
                    <td className="text-right tabular-nums">{p.deliveries}</td>
                    <td className="text-right tabular-nums">{fmtUZS(p.sales)}</td>
                    <td className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUZS(p.profit)}</td>
                    <td className="text-right tabular-nums">{fmtUZS(p.collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
