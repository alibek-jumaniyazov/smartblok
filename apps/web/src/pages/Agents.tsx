import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserCog, KeyRound } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Drawer } from '../components/ui/Drawer';
import { Field, Input } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { fmtUZS } from '../lib/format';

const empty = { name: '', phone: '', groupNo: '', username: '', password: '' };

export default function Agents() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: endpoints.agents });
  const create = useMutation({
    mutationFn: (d: any) => endpoints.createAgent(d),
    onSuccess: (res: any) => { qc.invalidateQueries(); setOpen(false); setForm(empty); toast(`Agent + foydalanuvchi yaratildi: ${res.createdUsername ?? ''}`); },
    onError: () => toast('Xatolik', 'error'),
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const columns: Column<any>[] = [
    { key: 'name', header: 'Agent', render: (a) => (
      <div className="flex items-center gap-3">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/12 text-primary"><UserCog size={16} /></div>
        <div><p className="font-medium text-content">{a.name}</p><p className="text-xs text-faint">{a.users?.[0]?.username ? '@' + a.users[0].username : '—'}</p></div>
      </div>
    ) },
    { key: 'groupNo', header: 'Guruh', render: (a) => <Badge tone="neutral">{a.groupNo ?? '—'}</Badge> },
    { key: 'phone', header: 'Telefon', render: (a) => a.phone ?? '—' },
    { key: 'clients', header: 'Mijoz', align: 'right', render: (a) => a._count?.clients ?? 0 },
    { key: 'sales', header: 'Sotuv', align: 'right', render: (a) => fmtUZS(a.sales), value: (a) => a.sales },
    { key: 'profit', header: 'Foyda', align: 'right', render: (a) => <span className="text-emerald-600 dark:text-emerald-400">{fmtUZS(a.profit)}</span>, value: (a) => a.profit },
  ];

  return (
    <div>
      <PageHeader title="Agentlar" subtitle="Agent yaratilganda unga login (foydalanuvchi) avtomatik ochiladi" breadcrumb={['Savdo', 'Agentlar']}
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Yangi agent</Button>} />
      <EntityTable columns={columns} data={agents} rowKey={(a) => a.id} searchKeys={['name', 'phone']} exportName="agentlar" onRowClick={(a) => nav(`/agents/${a.id}`)} />
      <Drawer open={open} onClose={() => setOpen(false)} title="Yangi agent" subtitle="Agent + login foydalanuvchi birga yaratiladi">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form, groupNo: form.groupNo || null }); }} className="space-y-3">
          <Field label="Ismi" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefon"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+998" /></Field>
            <Field label="Guruh"><Input type="number" value={form.groupNo} onChange={(e) => set('groupNo', e.target.value)} /></Field>
          </div>
          <div className="rounded-lg border border-line bg-subtle p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted"><KeyRound size={13} /> Login ma'lumotlari (ixtiyoriy — bo'sh qoldirsangiz avtomatik)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Foydalanuvchi nomi"><Input value={form.username} onChange={(e) => set('username', e.target.value)} placeholder="avtomatik" /></Field>
              <Field label="Parol"><Input value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="agent123" /></Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button><Button type="submit" loading={create.isPending}>Yaratish</Button></div>
        </form>
      </Drawer>
    </div>
  );
}
