import { useQuery } from '@tanstack/react-query';
import { Factory, Wallet, TrendingUp } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { KpiCard } from '../components/ui/KpiCard';
import { TableSkeleton } from '../components/ui/Skeleton';
import { fmtUZS, fmtDate } from '../lib/format';

export default function Reports() {
  const { data: svod } = useQuery({ queryKey: ['svod'], queryFn: endpoints.svod });
  const { data: fp } = useQuery({ queryKey: ['factoryPayments'], queryFn: endpoints.factoryPayments });

  return (
    <div>
      <PageHeader title="Hisobot — Svod Zavod" subtitle="Agentlar yakuni va zavod bilan solishtiruv" breadcrumb={['Hisobotlar', 'Svod']} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Jami tovar (sotuv)" value={svod?.totals?.totalGoods ?? 0} suffix="so'm" tone="teal" hero icon={<TrendingUp size={20} />} />
        <KpiCard label="Umumiy foyda" value={svod?.totals?.totalProfit ?? 0} suffix="so'm" tone="green" icon={<TrendingUp size={20} />} />
        <KpiCard label="Zavodga to'langan" value={svod?.totals?.factoryPaid ?? 0} suffix="so'm" tone="blue" icon={<Wallet size={20} />} />
        <KpiCard label="Zavod qoldig'i (qarz)" value={Math.max(0, svod?.totals?.factoryBalance ?? 0)} suffix="so'm" tone="red" icon={<Factory size={20} />} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Agentlar yakuni</CardTitle>
          {!svod ? <TableSkeleton /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr><th className="py-2.5">Agent</th><th>Guruh</th><th className="text-right">Yetkazilgan</th><th className="text-right">To'langan</th><th className="text-right">Qoldiq</th></tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {svod.perAgent.map((a: any) => (
                    <tr key={a.agentId} className="hover:bg-hover">
                      <td className="py-2.5 font-medium text-content">{a.agent}</td>
                      <td><Badge tone="neutral">{a.groupNo ?? '—'}</Badge></td>
                      <td className="text-right tabular-nums">{fmtUZS(a.delivered)}</td>
                      <td className="text-right tabular-nums">{fmtUZS(a.paid)}</td>
                      <td className={'text-right tabular-nums ' + (a.balance < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>{fmtUZS(a.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Zavodga to'lovlar</CardTitle>
          {!fp ? <TableSkeleton /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr><th className="py-2.5">Sana</th><th>Zavod</th><th>Qabul qiluvchi</th><th className="text-right">Summa</th></tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {fp.map((p: any) => (
                    <tr key={p.id} className="hover:bg-hover">
                      <td className="py-2.5">{fmtDate(p.date)}</td>
                      <td>{p.factory?.name ?? '—'}</td>
                      <td className="text-muted">{p.recipient ?? '—'}</td>
                      <td className="text-right font-semibold tabular-nums">{fmtUZS(p.amount)}</td>
                    </tr>
                  ))}
                  {fp.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-faint">Yozuv yo'q</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
