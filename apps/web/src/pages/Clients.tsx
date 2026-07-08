import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Search } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Table, Th, Td } from '../components/ui/Table';
import { Drawer } from '../components/ui/Drawer';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Field';
import { TableSkeleton } from '../components/ui/Skeleton';
import { fmtUZS, fmtDate } from '../lib/format';

export default function Clients() {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: endpoints.clients });
  const { data: statement } = useQuery({
    queryKey: ['statement', openId],
    queryFn: () => endpoints.statement(openId as number),
    enabled: openId != null,
  });

  const filtered = (clients ?? []).filter((c: any) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Mijozlar"
        subtitle="Mijoz qoldig'i (qarzi) = to'lovlar − yetkazishlar"
        action={
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-ink-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish..." className="w-56 pl-9" />
          </div>
        }
      />

      {!clients ? <TableSkeleton /> : (
        <Table head={
          <tr>
            <Th>Mijoz</Th><Th>Agent</Th><Th>Hudud</Th>
            <Th right>Yetkazilgan</Th><Th right>To'langan</Th><Th right>Qoldiq</Th><Th right>Poddon</Th><Th>{''}</Th>
          </tr>
        }>
          {filtered.map((c: any) => (
            <tr key={c.id} className="cursor-pointer hover:bg-ink-50 dark:hover:bg-ink-800/40" onClick={() => setOpenId(c.id)}>
              <Td className="font-medium">{c.name}</Td>
              <Td>{c.agent?.name ?? '—'}</Td>
              <Td>{c.region?.name ?? '—'}</Td>
              <Td right>{fmtUZS(c.delivered)}</Td>
              <Td right>{fmtUZS(c.paid)}</Td>
              <Td right>
                {c.balance < 0 ? (
                  <Badge tone="red">{fmtUZS(Math.abs(c.balance))} qarz</Badge>
                ) : c.balance > 0 ? (
                  <Badge tone="green">{fmtUZS(c.balance)} avans</Badge>
                ) : (
                  <Badge tone="neutral">0</Badge>
                )}
              </Td>
              <Td right>{c.palletBalance}</Td>
              <Td><FileText size={15} className="text-ink-400" /></Td>
            </tr>
          ))}
          {filtered.length === 0 && <tr><Td className="py-10 text-center text-ink-400">Mijoz topilmadi</Td></tr>}
        </Table>
      )}

      <Drawer open={openId != null} onClose={() => setOpenId(null)} title={statement?.client?.name ?? 'Hisob-varaqa'}>
        {!statement ? (
          <TableSkeleton rows={8} />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-950">
                <p className="text-xs text-ink-400">Jami yetkazilgan</p>
                <p className="font-bold tabular-nums">{fmtUZS(statement.totals.delivered)}</p>
              </div>
              <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-950">
                <p className="text-xs text-ink-400">Jami to'langan</p>
                <p className="font-bold tabular-nums">{fmtUZS(statement.totals.paid)}</p>
              </div>
              <div className="col-span-2 rounded-xl bg-brand-500/10 p-3 ring-1 ring-brand-500/20">
                <p className="text-xs text-ink-500">Qoldiq (Ostatok)</p>
                <p className={'text-lg font-extrabold tabular-nums ' + (statement.totals.balance < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
                  {fmtUZS(statement.totals.balance)}{statement.totals.balance < 0 ? ' (qarzdor)' : ''}
                </p>
                <p className="mt-1 text-xs text-ink-400">Poddon qoldig'i: {statement.totals.palletBalance} dona</p>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">Yetkazib berishlar (Tovar)</h4>
              <div className="space-y-1.5">
                {statement.deliveries.map((d: any) => (
                  <div key={d.id} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-sm dark:border-ink-800">
                    <div>
                      <p className="font-medium">{d.plate ?? '—'} · {d.size ?? ''}</p>
                      <p className="text-xs text-ink-400">{fmtDate(d.date)} · {d.cubes} m³ · {d.palletQty} poddon</p>
                    </div>
                    <span className="tabular-nums font-semibold">{fmtUZS(d.amount)}</span>
                  </div>
                ))}
                {statement.deliveries.length === 0 && <p className="text-sm text-ink-400">Yozuv yo'q</p>}
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">To'lovlar (Oplata)</h4>
              <div className="space-y-1.5">
                {statement.payments.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-sm dark:border-ink-800">
                    <div>
                      <p className="font-medium">{p.payerName ?? p.method}</p>
                      <p className="text-xs text-ink-400">{fmtDate(p.date)} · {p.method}</p>
                    </div>
                    <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{fmtUZS(p.amount)}</span>
                  </div>
                ))}
                {statement.payments.length === 0 && <p className="text-sm text-ink-400">Yozuv yo'q</p>}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
