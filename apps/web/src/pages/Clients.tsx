import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Drawer } from '../components/ui/Drawer';
import { Field, Input, Select } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { fmtUZS } from '../lib/format';

const empty = { name: '', legalEntity: '', phone: '', agentId: '', regionId: '' };

export default function Clients() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: endpoints.clients });
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: endpoints.agents });
  const { data: regions } = useQuery({ queryKey: ['regions'], queryFn: endpoints.regions });
  const create = useMutation({ mutationFn: (d: any) => endpoints.createClient(d), onSuccess: () => { qc.invalidateQueries(); setOpen(false); setForm(empty); toast("Mijoz qo'shildi"); } });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const columns: Column<any>[] = [
    { key: 'name', header: 'Mijoz', render: (c) => <span className="font-medium text-content">{c.name}</span> },
    { key: 'agent', header: 'Agent', render: (c) => c.agent?.name ?? '—' },
    { key: 'region', header: 'Hudud', render: (c) => c.region?.name ?? '—' },
    { key: 'delivered', header: 'Buyurtma', align: 'right', render: (c) => fmtUZS(c.delivered), value: (c) => c.delivered },
    { key: 'paid', header: "To'langan", align: 'right', render: (c) => fmtUZS(c.paid), value: (c) => c.paid },
    { key: 'balance', header: 'Qoldiq', align: 'right', value: (c) => c.balance, render: (c) =>
      c.balance > 0 ? <Badge tone="red">{fmtUZS(c.balance)} qarz</Badge> : c.balance < 0 ? <Badge tone="green">{fmtUZS(-c.balance)} avans</Badge> : <Badge tone="neutral">0</Badge> },
  ];

  return (
    <div>
      <PageHeader title="Mijozlar" subtitle="Qatorga bosib mijozning batafsil sahifasini oching" breadcrumb={['Savdo', 'Mijozlar']}
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Yangi mijoz</Button>} />
      <EntityTable columns={columns} data={clients} rowKey={(c) => c.id} searchKeys={['name', (c) => c.agent?.name ?? '']} exportName="mijozlar" onRowClick={(c) => nav(`/clients/${c.id}`)} />
      <Drawer open={open} onClose={() => setOpen(false)} title="Yangi mijoz" subtitle="Mijoz agentga bog'lanadi">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form }); }} className="space-y-3">
          <Field label="Nomi" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} required /></Field>
          <Field label="Agent" required><Select value={form.agentId} onChange={(e) => set('agentId', e.target.value)} required><option value="">—</option>{(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Field label="Hudud"><Select value={form.regionId} onChange={(e) => set('regionId', e.target.value)}><option value="">—</option>{(regions ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefon"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+998" /></Field>
            <Field label="Yuridik shaxs"><Input value={form.legalEntity} onChange={(e) => set('legalEntity', e.target.value)} /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button><Button type="submit" loading={create.isPending}>Saqlash</Button></div>
        </form>
      </Drawer>
    </div>
  );
}
