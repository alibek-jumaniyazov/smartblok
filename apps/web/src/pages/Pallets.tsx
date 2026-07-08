import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Package } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Table, Th, Td } from '../components/ui/Table';
import { Modal } from '../components/ui/Modal';
import { Field, Input, Select } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';
import { KpiCard } from '../components/ui/KpiCard';
import { TableSkeleton } from '../components/ui/Skeleton';

const empty = { clientId: '', returnedQty: 0, date: new Date().toISOString().slice(0, 10), note: '' };

export default function Pallets() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);

  const { data: summary } = useQuery({ queryKey: ['pallets'], queryFn: endpoints.pallets });
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: endpoints.clients });

  const create = useMutation({
    mutationFn: (d: any) => endpoints.createPalletReturn(d),
    onSuccess: () => { qc.invalidateQueries(); setOpen(false); setForm(empty); },
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div>
      <PageHeader
        title="Poddonlar"
        subtitle="Berilgan − qaytarilgan = poddon qoldig'i (zalog/qaytim tizimi)"
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Poddon qaytimi</Button>}
      />

      <div className="mb-5 max-w-xs">
        <KpiCard label="Umumiy poddon qoldig'i" value={summary?.totalBalance ?? 0} suffix="dona" tone="amber" icon={<Package size={20} />} />
      </div>

      {!summary ? <TableSkeleton /> : (
        <Table head={<tr><Th>Mijoz</Th><Th right>Berilgan</Th><Th right>Qaytarilgan</Th><Th right>Qoldiq</Th></tr>}>
          {summary.rows.map((r: any) => (
            <tr key={r.clientId} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
              <Td className="font-medium">{r.client}</Td>
              <Td right>{r.issued}</Td>
              <Td right>{r.returned}</Td>
              <Td right>{r.balance > 0 ? <Badge tone="amber">{r.balance}</Badge> : <Badge tone="green">0</Badge>}</Td>
            </tr>
          ))}
          {summary.rows.length === 0 && <tr><Td className="py-10 text-center text-ink-400">Yozuv yo'q</Td></tr>}
        </Table>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Poddon qaytimini qayd etish">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form }); }} className="space-y-3">
          <Field label="Mijoz">
            <Select value={form.clientId} onChange={(e) => set('clientId', e.target.value)} required>
              <option value="">—</option>
              {(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Qaytarilgan poddon soni"><Input type="number" value={form.returnedQty} onChange={(e) => set('returnedQty', e.target.value)} required /></Field>
          <Field label="Sana"><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button>
            <Button type="submit" disabled={create.isPending}>Saqlash</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
