import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { UserCog, Phone } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { fmtShort } from '../lib/format';

export default function Agents() {
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: endpoints.agents });
  const { data: perf } = useQuery({ queryKey: ['perf'], queryFn: endpoints.agentPerformance });
  const perfMap = new Map((perf ?? []).map((p: any) => [p.agentId, p]));

  return (
    <div>
      <PageHeader title="Agentlar" subtitle="Sotuvchi agentlar va ularning ko'rsatkichlari" breadcrumb={['Savdo', 'Agentlar']} />
      {!agents ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a: any, i: number) => {
            const p: any = perfMap.get(a.id);
            return (
              <motion.div key={a.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.28 }} whileHover={{ y: -3 }}
                className="rounded-lg border border-line bg-surface p-5 shadow-e1">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/12 text-primary"><UserCog size={22} /></div>
                  <div><p className="font-bold text-content">{a.name}</p><Badge tone="neutral">{a.groupNo ?? '—'}-guruh</Badge></div>
                </div>
                {a.phone && <p className="mt-3 flex items-center gap-1.5 text-sm text-muted"><Phone size={14} /> {a.phone}</p>}
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                  <div><p className="text-xs text-faint">Mijoz</p><p className="font-bold text-content">{a._count?.clients ?? 0}</p></div>
                  <div><p className="text-xs text-faint">Yuklar</p><p className="font-bold text-content">{p?.deliveries ?? 0}</p></div>
                  <div><p className="text-xs text-faint">Foyda</p><p className="font-bold text-emerald-600 dark:text-emerald-400">{p ? fmtShort(p.profit) : '0'}</p></div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
