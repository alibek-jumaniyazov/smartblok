import { useQuery } from '@tanstack/react-query';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { TrendingUp, Wallet, Users, Factory, Package, Boxes, HandCoins } from 'lucide-react';
import { endpoints } from '../lib/api';
import { KpiCard } from '../components/ui/KpiCard';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { TableSkeleton } from '../components/ui/Skeleton';
import { fmtShort, fmtUZS, fmtNum } from '../lib/format';
import { Badge } from '../components/ui/Badge';

export default function Dashboard() {
  const { data: s } = useQuery({ queryKey: ['dashboard'], queryFn: endpoints.dashboard });
  const { data: trend } = useQuery({ queryKey: ['trend'], queryFn: endpoints.salesTrend });
  const { data: perf } = useQuery({ queryKey: ['perf'], queryFn: endpoints.agentPerformance });

  const trendData = (trend ?? []).map((t: any) => ({
    date: new Date(t.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
    sales: t.sales, profit: t.profit,
  }));

  return (
    <div>
      <PageHeader title="Boshqaruv paneli" subtitle="Umumiy ko'rsatkichlar va statistika" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Jami sotuv" value={s?.totalSales ?? 0} suffix="so'm" tone="amber" delay={0.02} icon={<TrendingUp size={20} />} hint={`${s?.salesCount ?? 0} ta yuk · ${fmtNum(s?.totalCubes ?? 0)} m³`} />
        <KpiCard label="Umumiy foyda" value={s?.totalProfit ?? 0} suffix="so'm" tone="green" delay={0.06} icon={<HandCoins size={20} />} />
        <KpiCard label="Mijoz qarzi (debitor)" value={Math.max(0, s?.receivable ?? 0)} suffix="so'm" tone="red" delay={0.1} icon={<Wallet size={20} />} />
        <KpiCard label="Zavodga qarz" value={Math.max(0, s?.factoryBalance ?? 0)} suffix="so'm" tone="blue" delay={0.14} icon={<Factory size={20} />} />
        <KpiCard label="Jami to'lov" value={s?.totalPaid ?? 0} suffix="so'm" tone="green" delay={0.18} icon={<Wallet size={20} />} hint={`${s?.paymentsCount ?? 0} ta to'lov`} />
        <KpiCard label="Mijozlar" value={s?.clientCount ?? 0} tone="slate" delay={0.22} icon={<Users size={20} />} />
        <KpiCard label="Agentlar" value={s?.agentCount ?? 0} tone="slate" delay={0.26} icon={<Users size={20} />} />
        <KpiCard label="Poddon qoldig'i" value={s?.palletBalance ?? 0} suffix="dona" tone="amber" delay={0.3} icon={<Package size={20} />} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" delay={0.1}>
          <h3 className="mb-4 font-semibold">Sotuv va foyda dinamikasi</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ left: -10, right: 10, top: 4 }}>
                <defs>
                  <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} stroke="#94a3b8" width={60} />
                <Tooltip formatter={(v: any) => fmtUZS(v)} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Area type="monotone" dataKey="sales" name="Sotuv" stroke="#f59e0b" strokeWidth={2} fill="url(#gSales)" />
                <Area type="monotone" dataKey="profit" name="Foyda" stroke="#10b981" strokeWidth={2} fill="url(#gProfit)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card delay={0.16}>
          <h3 className="mb-4 font-semibold">Agentlar bo'yicha sotuv</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(perf ?? []).map((p: any) => ({ name: p.agent.split(' ')[0], sales: p.sales }))} margin={{ left: -10, right: 10, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#94a3b8" interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} stroke="#94a3b8" width={55} />
                <Tooltip formatter={(v: any) => fmtUZS(v)} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Bar dataKey="sales" name="Sotuv" fill="#f59e0b" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="mt-6" delay={0.2}>
        <h3 className="mb-4 flex items-center gap-2 font-semibold"><Boxes size={18} /> Agentlar reytingi</h3>
        {!perf ? (
          <TableSkeleton rows={5} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-ink-400">
                <tr>
                  <th className="py-2">Agent</th><th>Guruh</th>
                  <th className="text-right">Yuklar</th>
                  <th className="text-right">Sotuv</th>
                  <th className="text-right">Foyda</th>
                  <th className="text-right">Yig'ilgan to'lov</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {perf.map((p: any) => (
                  <tr key={p.agentId} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                    <td className="py-2.5 font-medium">{p.agent}</td>
                    <td><Badge tone="neutral">{p.groupNo ?? '—'}-guruh</Badge></td>
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
