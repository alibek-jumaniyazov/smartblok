import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Phone, User, Users } from 'lucide-react';
import { endpoints } from '../lib/api';
import { Card, CardTitle } from '../components/ui/Card';
import { KpiCard } from '../components/ui/KpiCard';
import { Badge } from '../components/ui/Badge';
import { TableSkeleton } from '../components/ui/Skeleton';
import { statusMeta } from '../lib/orderStatus';
import { fmtUZS, fmtDate, fmtNum } from '../lib/format';

export default function AgentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: agent } = useQuery({ queryKey: ['agent', id], queryFn: () => endpoints.agent(id as string) });

  if (!agent) return <TableSkeleton rows={8} />;
  const t = agent.totals ?? { sales: 0, profit: 0, collected: 0, outstanding: 0, advance: 0, clientsCount: 0 };
  const orders = agent.orders ?? [];
  const owedToUs = t.outstanding > 0;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <button onClick={() => nav(-1)} className="rounded-md border border-line p-2 text-muted hover:bg-hover"><ArrowLeft size={18} /></button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-content">{agent.name}</h1>
          <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted">
            <Badge tone="neutral">{agent.groupNo ?? '—'}-guruh</Badge>
            {agent.phone && <span className="flex items-center gap-1"><Phone size={14} /> {agent.phone}</span>}
            {agent.users?.[0]?.username && <span className="flex items-center gap-1"><User size={14} /> @{agent.users[0].username}</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Mijozlar" value={t.clientsCount} tone="violet" icon={<Users size={20} />} />
        <KpiCard label="Sotuv" value={t.sales} suffix="so'm" tone="teal" />
        <KpiCard label="Yig'ilgan to'lov" value={t.collected} suffix="so'm" tone="green" />
        <div className={'rounded-lg border p-5 shadow-e1 ' + (owedToUs ? 'border-red-500/30 bg-red-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{owedToUs ? 'Mijozlar qarzi (bizga)' : t.advance > 0 ? 'Mijozlar avansi' : 'Qarz yo\'q'}</p>
          <p className={'mt-1.5 text-[26px] font-bold tabular-nums ' + (owedToUs ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>{fmtUZS(owedToUs ? t.outstanding : t.advance)}</p>
          <p className="mt-1 text-xs text-faint">Foyda: {fmtUZS(t.profit)}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Mijozlari ({agent.clients?.length ?? 0})</CardTitle>
          <div className="space-y-1.5">
            {(agent.clients ?? []).map((c: any) => (
              <button key={c.id} onClick={() => nav(`/clients/${c.id}`)} className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-hover">
                <span className="font-medium text-content">{c.name}</span>
                {c.phone && <span className="text-xs text-faint">{c.phone}</span>}
              </button>
            ))}
            {(agent.clients ?? []).length === 0 && <p className="py-6 text-center text-sm text-faint">Mijoz yo'q</p>}
          </div>
        </Card>
        <Card>
          <CardTitle>Buyurtmalari ({orders.length})</CardTitle>
          <div className="space-y-1.5">
            {orders.map((o: any) => (
              <button key={o.id} onClick={() => nav(`/clients/${o.clientId}`)} className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-hover">
                <div><p className="font-medium text-content">{o.orderNo} · {o.client?.name}</p><p className="text-xs text-faint">{fmtDate(o.date)} · {fmtNum(o.quantity, 2)} m³ · {o.product?.name}</p></div>
                <div className="text-right"><p className="font-semibold tabular-nums">{fmtUZS(o.saleTotal)}</p><Badge tone={statusMeta[o.status]?.tone ?? 'neutral'}>{statusMeta[o.status]?.label ?? o.status}</Badge></div>
              </button>
            ))}
            {orders.length === 0 && <p className="py-6 text-center text-sm text-faint">Buyurtma yo'q</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
