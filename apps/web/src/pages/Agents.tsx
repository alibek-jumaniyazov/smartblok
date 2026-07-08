import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { UserCog, Phone } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';

export default function Agents() {
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: endpoints.agents });
  const { data: perf } = useQuery({ queryKey: ['perf'], queryFn: endpoints.agentPerformance });

  const perfMap = new Map((perf ?? []).map((p: any) => [p.agentId, p]));

  return (
    <div>
      <PageHeader title="Agentlar" subtitle="Sotuvchi agentlar va ularning ko'rsatkichlari" />
      {!agents ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a: any, i: number) => {
            const p: any = perfMap.get(a.id);
            return (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.28 }}
                whileHover={{ y: -3 }}
                className="rounded-2xl border border-ink-200/70 bg-white p-5 shadow-sm dark:border-ink-800 dark:bg-ink-900"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-400">
                    <UserCog size={22} />
                  </div>
                  <div>
                    <p className="font-bold">{a.name}</p>
                    <Badge tone="neutral">{a.groupNo ?? '—'}-guruh</Badge>
                  </div>
                </div>
                {a.phone && (
                  <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-500"><Phone size={14} /> {a.phone}</p>
                )}
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-ink-100 pt-3 text-center dark:border-ink-800">
                  <div>
                    <p className="text-xs text-ink-400">Mijoz</p>
                    <p className="font-bold">{a._count?.clients ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-400">Yuklar</p>
                    <p className="font-bold">{p?.deliveries ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-400">Foyda</p>
                    <p className="font-bold text-emerald-600 dark:text-emerald-400">{p ? Math.round(p.profit / 1e6) + 'M' : '0'}</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
