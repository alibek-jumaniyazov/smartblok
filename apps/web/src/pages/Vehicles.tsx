import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Truck } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Drawer } from '../components/ui/Drawer';
import { Field, Input } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { fmtUZS } from '../lib/format';

const empty = { name: '', plate: '', driver: '', phone: '' };

export default function Vehicles() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: endpoints.vehicles });
  const create = useMutation({ mutationFn: (d: any) => endpoints.createVehicle(d), onSuccess: () => { qc.invalidateQueries(); setOpen(false); setForm(empty); toast("Moshina qo'shildi"); } });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const columns: Column<any>[] = [
    { key: 'name', header: 'Moshina', render: (v) => <span className="font-medium text-content">{v.name}</span> },
    { key: 'plate', header: 'Davlat raqami', render: (v) => v.plate ?? '—' },
    { key: 'driver', header: 'Haydovchi', render: (v) => v.driver ?? '—' },
    { key: 'phone', header: 'Telefon', render: (v) => v.phone ?? '—' },
    { key: 'orders', header: 'Reyslar', align: 'right', render: (v) => v._count?.orders ?? 0 },
    { key: 'balance', header: 'Biz qarzmiz', align: 'right', value: (v) => v.balance, render: (v) => v.balance > 0 ? <Badge tone="red">{fmtUZS(v.balance)}</Badge> : <Badge tone="green">0</Badge> },
  ];

  return (
    <div>
      <PageHeader title="Moshinalar" subtitle="Yetkazib beruvchi transport — biz ularga xizmat haqi to'laymiz" breadcrumb={['Katalog', 'Moshinalar']}
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Yangi moshina</Button>} />
      <EntityTable columns={columns} data={vehicles} rowKey={(v) => v.id} searchKeys={['name', 'plate', 'driver']} exportName="moshinalar" onRowClick={(v) => nav(`/vehicles/${v.id}`)} />
      <Drawer open={open} onClose={() => setOpen(false)} title="Yangi moshina">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form }); }} className="space-y-3">
          <Field label="Nomi / haydovchi" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Isuzu — Baxtiyor" required /></Field>
          <Field label="Davlat raqami"><Input value={form.plate} onChange={(e) => set('plate', e.target.value)} placeholder="90 A 123 BC" /></Field>
          <Field label="Haydovchi"><Input value={form.driver} onChange={(e) => set('driver', e.target.value)} /></Field>
          <Field label="Telefon"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+998" /></Field>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button><Button type="submit" loading={create.isPending}>Saqlash</Button></div>
        </form>
      </Drawer>
    </div>
  );
}
