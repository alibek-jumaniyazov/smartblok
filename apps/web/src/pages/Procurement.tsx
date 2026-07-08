import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Factory, Trophy } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Field';
import { TableSkeleton } from '../components/ui/Skeleton';
import { fmtUZS, fmtNum } from '../lib/format';

const methodLabel: Record<string, string> = { CASH: 'Naqd', TRANSFER: "O'tkazma" };

export default function Procurement() {
  const { data: regions } = useQuery({ queryKey: ['regions'], queryFn: endpoints.regions });
  const [regionId, setRegionId] = useState<number | null>(null);

  useEffect(() => {
    if (regions && regions.length && regionId == null) {
      const beruniy = regions.find((r: any) => r.name.toLowerCase().includes('beruniy'));
      setRegionId((beruniy ?? regions[0]).id);
    }
  }, [regions]);

  const { data: matrix } = useQuery({
    queryKey: ['matrix', regionId],
    queryFn: () => endpoints.matrix(regionId as number),
    enabled: regionId != null,
  });

  return (
    <div>
      <PageHeader
        title="Zavod narxlari — tannarx matritsasi"
        subtitle="Klientgacha = zavod narxi + logistika / bir mashina m³. Eng arzon manba avtomatik topiladi."
        action={
          <Select value={regionId ?? ''} onChange={(e) => setRegionId(Number(e.target.value))} className="w-52">
            {(regions ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        }
      />

      {matrix?.cheapest && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4"
        >
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
            <Trophy size={22} />
          </div>
          <div>
            <p className="text-sm text-ink-500">Eng arzon manba — {matrix.region}</p>
            <p className="font-bold">
              {matrix.cheapest.factory} ({methodLabel[matrix.cheapest.paymentMethod] ?? matrix.cheapest.paymentMethod}) → {fmtUZS(matrix.cheapest.landedCostPerM3)}/m³
            </p>
          </div>
        </motion.div>
      )}

      <Card>
        <h3 className="mb-4 flex items-center gap-2 font-semibold"><Factory size={18} /> Zavodlar taqqoslovi</h3>
        {!matrix ? <TableSkeleton /> : (
          <Table head={
            <tr>
              <Th>Zavod</Th><Th>To'lov</Th>
              <Th right>Zavod narxi</Th><Th right>Logistika</Th><Th right>Mashina m³</Th>
              <Th right>Klientgacha</Th><Th right>Bonus</Th><Th right>Bonusdan keyin</Th>
            </tr>
          }>
            {matrix.rows.map((r: any, i: number) => (
              <tr key={i} className={i === 0 ? 'bg-emerald-500/5' : 'hover:bg-ink-50 dark:hover:bg-ink-800/40'}>
                <Td className="font-medium">
                  {r.factory} {i === 0 && <Badge tone="green" className="ml-1">eng arzon</Badge>}
                </Td>
                <Td>{methodLabel[r.paymentMethod] ?? r.paymentMethod}</Td>
                <Td right>{fmtNum(r.pricePerM3)}</Td>
                <Td right>{fmtNum(r.logisticsCostPerTruck)}</Td>
                <Td right>{r.truckCapacityM3}</Td>
                <Td right className="font-bold">{fmtNum(r.landedCostPerM3)}</Td>
                <Td right>{r.dealerBonusPct ? Math.round(r.dealerBonusPct * 100) + '%' : '—'}</Td>
                <Td right>{fmtNum(r.netCostPerM3)}</Td>
              </tr>
            ))}
            {matrix.rows.length === 0 && <tr><Td className="py-10 text-center text-ink-400">Bu hudud uchun marshrut yo'q</Td></tr>}
          </Table>
        )}
      </Card>
    </div>
  );
}
