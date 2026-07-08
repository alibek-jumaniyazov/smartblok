import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Factory, Trophy } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Field';
import { TableSkeleton } from '../components/ui/Skeleton';
import { fmtUZS, fmtNum } from '../lib/format';
import { cn } from '../lib/utils';

const methodLabel: Record<string, string> = { CASH: 'Naqd', TRANSFER: "O'tkazma" };

export default function Procurement() {
  const { data: regions } = useQuery({ queryKey: ['regions'], queryFn: endpoints.regions });
  const [regionId, setRegionId] = useState<string | null>(null);

  useEffect(() => {
    if (regions && regions.length && regionId == null) {
      const beruniy = regions.find((r: any) => r.name.toLowerCase().includes('beruniy'));
      setRegionId((beruniy ?? regions[0]).id);
    }
  }, [regions]);

  const { data: matrix } = useQuery({ queryKey: ['matrix', regionId], queryFn: () => endpoints.matrix(regionId as string), enabled: regionId != null });

  return (
    <div>
      <PageHeader title="Zavod narxlari — tannarx matritsasi" breadcrumb={['Katalog', 'Zavod narxlari']}
        subtitle="Klientgacha = zavod narxi + logistika / mashina m³. Eng arzon manba avtomatik topiladi."
        action={<Select value={regionId ?? ''} onChange={(e) => setRegionId(e.target.value)} className="w-52">{(regions ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>} />

      {matrix?.cheapest && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="mb-5 flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"><Trophy size={22} /></div>
          <div>
            <p className="text-sm text-muted">Eng arzon manba — {matrix.region}</p>
            <p className="font-bold text-content">{matrix.cheapest.factory} ({methodLabel[matrix.cheapest.paymentMethod] ?? matrix.cheapest.paymentMethod}) → {fmtUZS(matrix.cheapest.landedCostPerM3)}/m³</p>
          </div>
        </motion.div>
      )}

      <Card padded={false}>
        <div className="p-5 pb-0"><CardTitle><span className="flex items-center gap-2"><Factory size={18} /> Zavodlar taqqoslovi</span></CardTitle></div>
        {!matrix ? <div className="p-5"><TableSkeleton /></div> : (
          <div className="overflow-x-auto p-5 pt-2">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-2.5">Zavod</th><th>To'lov</th>
                  <th className="text-right">Zavod narxi</th><th className="text-right">Logistika</th><th className="text-right">Mashina m³</th>
                  <th className="text-right">Klientgacha</th><th className="text-right">Bonus</th><th className="text-right">Bonusdan keyin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {matrix.rows.map((r: any, i: number) => (
                  <tr key={i} className={cn(i === 0 ? 'bg-emerald-500/5' : 'hover:bg-hover')}>
                    <td className="py-3 font-medium text-content">{r.factory} {i === 0 && <Badge tone="green" className="ml-1">eng arzon</Badge>}</td>
                    <td>{methodLabel[r.paymentMethod] ?? r.paymentMethod}</td>
                    <td className="text-right tabular-nums">{fmtNum(r.pricePerM3)}</td>
                    <td className="text-right tabular-nums">{fmtNum(r.logisticsCostPerTruck)}</td>
                    <td className="text-right tabular-nums">{r.truckCapacityM3}</td>
                    <td className="text-right font-bold tabular-nums">{fmtNum(r.landedCostPerM3)}</td>
                    <td className="text-right tabular-nums">{r.dealerBonusPct ? Math.round(r.dealerBonusPct * 100) + '%' : '—'}</td>
                    <td className="text-right tabular-nums text-muted">{fmtNum(r.netCostPerM3)}</td>
                  </tr>
                ))}
                {matrix.rows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-faint">Bu hudud uchun marshrut yo'q</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
