import { useQuery } from '@tanstack/react-query';
import { Factory, Wallet, TrendingUp } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { KpiCard } from '../components/ui/KpiCard';
import { TableSkeleton } from '../components/ui/Skeleton';
import { fmtUZS } from '../lib/format';

export default function Reports() {
  const { data: svod } = useQuery({ queryKey: ['svod'], queryFn: endpoints.svod });
  const { data: fp } = useQuery({ queryKey: ['factoryPayments'], queryFn: endpoints.factoryPayments });

  return (
    <div>
      <PageHeader title="Hisobot — Svod Zavod" subtitle="Agentlar yakuni va zavod bilan solishtiruv" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Jami tovar (sotuv)" value={svod?.totals?.totalGoods ?? 0} suffix="so'm" tone="amber" icon={<TrendingUp size={20} />} />
        <KpiCard label="Umumiy foyda" value={svod?.totals?.totalProfit ?? 0} suffix="so'm" tone="green" icon={<TrendingUp size={20} />} />
        <KpiCard label="Zavodga to'langan" value={svod?.totals?.factoryPaid ?? 0} suffix="so'm" tone="blue" icon={<Wallet size={20} />} />
        <KpiCard label="Zavod qoldig'i (qarz)" value={Math.max(0, svod?.totals?.factoryBalance ?? 0)} suffix="so'm" tone="red" icon={<Factory size={20} />} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <h3 className="mb-4 font-semibold">Agentlar yakuni</h3>
          {!svod ? <TableSkeleton /> : (
            <Table head={<tr><Th>Agent</Th><Th>Guruh</Th><Th right>Yetkazilgan</Th><Th right>To'langan</Th><Th right>Qoldiq</Th></tr>}>
              {svod.perAgent.map((a: any) => (
                <tr key={a.agentId} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                  <Td className="font-medium">{a.agent}</Td>
                  <Td><Badge tone="neutral">{a.groupNo ?? '—'}</Badge></Td>
                  <Td right>{fmtUZS(a.delivered)}</Td>
                  <Td right>{fmtUZS(a.paid)}</Td>
                  <Td right>
                    {a.balance < 0
                      ? <span className="text-red-600 dark:text-red-400">{fmtUZS(a.balance)}</span>
                      : <span className="text-emerald-600 dark:text-emerald-400">{fmtUZS(a.balance)}</span>}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <h3 className="mb-4 font-semibold">Zavodga to'lovlar (Oplata Zavod)</h3>
          {!fp ? <TableSkeleton /> : (
            <Table head={<tr><Th>Sana</Th><Th>Zavod</Th><Th>Qabul qiluvchi</Th><Th right>Summa</Th></tr>}>
              {fp.map((p: any) => (
                <tr key={p.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                  <Td>{new Date(p.date).toLocaleDateString('ru-RU')}</Td>
                  <Td>{p.factory?.name ?? '—'}</Td>
                  <Td className="text-ink-500">{p.recipient ?? '—'}</Td>
                  <Td right className="font-semibold">{fmtUZS(p.amount)}</Td>
                </tr>
              ))}
              {fp.length === 0 && <tr><Td className="py-10 text-center text-ink-400">Yozuv yo'q</Td></tr>}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
