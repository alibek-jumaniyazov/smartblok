import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Drawer } from '../components/ui/Drawer';
import { Field, Input } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { fmtUZS } from '../lib/format';

const empty = { name: '', note: '' };

export default function Factories() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const { data: factories } = useQuery({ queryKey: ['factories'], queryFn: endpoints.factories });
  const create = useMutation({ mutationFn: (d: any) => endpoints.createFactory(d), onSuccess: () => { qc.invalidateQueries(); setOpen(false); setForm(empty); toast("Zavod qo'shildi"); } });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const columns: Column<any>[] = [
    { key: 'name', header: 'Zavod', render: (f) => <span className="font-medium text-content">{f.name}</span> },
    { key: 'products', header: 'Mahsulot', align: 'right', render: (f) => f._count?.products ?? 0 },
    { key: 'orders', header: 'Buyurtma', align: 'right', render: (f) => f._count?.orders ?? 0 },
    { key: 'balance', header: 'Biz qarzmiz', align: 'right', value: (f) => f.balance, render: (f) => f.balance > 0 ? <Badge tone="red">{fmtUZS(f.balance)}</Badge> : <Badge tone="green">0</Badge> },
  ];

  return (
    <div>
      <PageHeader title="Zavodlar" subtitle="Gazoblok ishlab chiqaruvchilar — biz ulardan mahsulot olamiz" breadcrumb={['Katalog', 'Zavodlar']}
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Yangi zavod</Button>} />
      <EntityTable columns={columns} data={factories} rowKey={(f) => f.id} searchKeys={['name']} exportName="zavodlar" onRowClick={(f) => nav(`/factories/${f.id}`)} />
      <Drawer open={open} onClose={() => setOpen(false)} title="Yangi zavod">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form }); }} className="space-y-3">
          <Field label="Nomi" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="CAOLS KS" required /></Field>
          <Field label="Izoh"><Input value={form.note} onChange={(e) => set('note', e.target.value)} /></Field>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button><Button type="submit" loading={create.isPending}>Saqlash</Button></div>
        </form>
      </Drawer>
    </div>
  );
}
