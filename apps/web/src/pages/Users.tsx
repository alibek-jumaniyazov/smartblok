import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Modal } from '../components/ui/Modal';
import { Field, Input, Select } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { fmtDate } from '../lib/format';

const roleTone: Record<string, any> = { ADMIN: 'violet', ACCOUNTANT: 'blue', AGENT: 'teal', CASHIER: 'amber' };
const roleLabel: Record<string, string> = { ADMIN: 'Administrator', ACCOUNTANT: 'Buxgalter', AGENT: 'Agent', CASHIER: 'Kassir' };
const empty = { username: '', name: '', role: 'AGENT', email: '', phone: '', password: '', agentId: '', active: true };

export default function Users() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(empty);

  const { data: users } = useQuery({ queryKey: ['users'], queryFn: endpoints.users });
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: endpoints.agents });

  const save = useMutation({
    mutationFn: (d: any) => (editing ? endpoints.updateUser(editing.id, d) : endpoints.createUser(d)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); close(); toast(editing ? 'Yangilandi' : "Foydalanuvchi qo'shildi"); },
    onError: (e: any) => toast(e?.response?.data?.message || 'Xatolik yuz berdi', 'error'),
  });
  const del = useMutation({
    mutationFn: (id: number) => endpoints.deleteUser(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast("O'chirildi"); },
  });

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(u: any) { setEditing(u); setForm({ ...empty, ...u, email: u.email ?? '', password: '', agentId: u.agentId ?? '' }); setOpen(true); }
  function close() { setOpen(false); setEditing(null); setForm(empty); }

  const columns: Column<any>[] = [
    { key: 'name', header: 'Foydalanuvchi', render: (u) => (
      <div className="flex items-center gap-3">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">{u.name?.[0]?.toUpperCase()}</div>
        <div><p className="font-medium text-content">{u.name}</p><p className="text-xs text-faint">@{u.username}</p></div>
      </div>
    ) },
    { key: 'role', header: 'Rol', render: (u) => <Badge tone={roleTone[u.role] ?? 'neutral'} dot>{roleLabel[u.role] ?? u.role}</Badge> },
    { key: 'agent', header: 'Agent', render: (u) => u.agent?.name ?? '—' },
    { key: 'phone', header: 'Telefon', render: (u) => u.phone ?? '—' },
    { key: 'active', header: 'Holat', render: (u) => u.active ? <Badge tone="green">Faol</Badge> : <Badge tone="red">Bloklangan</Badge> },
    { key: 'createdAt', header: 'Sana', render: (u) => fmtDate(u.createdAt) },
  ];

  return (
    <div>
      <PageHeader title="Foydalanuvchilar" subtitle="Tizim foydalanuvchilari va rollari" breadcrumb={['Tizim', 'Foydalanuvchilar']}
        action={<Button onClick={openNew}><Plus size={16} /> Yangi foydalanuvchi</Button>} />
      <EntityTable columns={columns} data={users} rowKey={(u) => u.id} searchKeys={['name', 'username', 'role']} exportName="foydalanuvchilar"
        actions={(u) => (
          <>
            <button onClick={() => openEdit(u)} className="rounded-md p-1.5 text-faint hover:bg-hover hover:text-content"><Pencil size={15} /></button>
            <button onClick={() => del.mutate(u.id)} className="rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500"><Trash2 size={15} /></button>
          </>
        )} />

      <Modal open={open} onClose={close} title={editing ? 'Foydalanuvchini tahrirlash' : 'Yangi foydalanuvchi'} subtitle="Rol va kirish ma'lumotlari">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate({ ...form, agentId: form.agentId || null }); }} className="grid grid-cols-2 gap-3">
          <Field label="Ism" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} required /></Field>
          <Field label="Foydalanuvchi nomi" required><Input value={form.username} onChange={(e) => set('username', e.target.value)} placeholder="masalan: sardor" required /></Field>
          <Field label="Rol" required>
            <Select value={form.role} onChange={(e) => set('role', e.target.value)}>
              {Object.entries(roleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Telefon"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+998" /></Field>
          {form.role === 'AGENT' && (
            <Field label="Bog'langan agent">
              <Select value={form.agentId} onChange={(e) => set('agentId', e.target.value)}>
                <option value="">—</option>
                {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Email (ixtiyoriy)"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label={editing ? 'Yangi parol (ixtiyoriy)' : 'Parol'} required={!editing}>
            <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="••••••" />
          </Field>
          <div className="col-span-2 flex items-center gap-2">
            <input id="active" type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="h-4 w-4 accent-[color:var(--primary)]" />
            <label htmlFor="active" className="text-sm text-body">Faol (tizimga kira oladi)</label>
          </div>
          <div className="col-span-2 mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>Bekor</Button>
            <Button type="submit" loading={save.isPending}>Saqlash</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
