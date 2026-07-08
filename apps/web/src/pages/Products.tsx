import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Drawer } from '../components/ui/Drawer';
import { Field, Input, Select } from '../components/ui/Field';
import { MoneyInput } from '../components/ui/MoneyInput';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { fmtNum } from '../lib/format';

const empty = { factoryId: '', name: '', size: '', unit: 'm3', costPrice: 500000, salePrice: 730000 };

export default function Products() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(empty);

  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => endpoints.products() });
  const { data: factories } = useQuery({ queryKey: ['factories'], queryFn: endpoints.factories });

  const save = useMutation({ mutationFn: (d: any) => (editing ? endpoints.updateProduct(editing.id, d) : endpoints.createProduct(d)), onSuccess: () => { qc.invalidateQueries(); close(); toast('Saqlandi'); } });
  const del = useMutation({ mutationFn: (id: string) => endpoints.deleteProduct(id), onSuccess: () => { qc.invalidateQueries(); toast("O'chirildi"); } });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(p: any) { setEditing(p); setForm({ ...empty, ...p }); setOpen(true); }
  function close() { setOpen(false); setEditing(null); setForm(empty); }

  const columns: Column<any>[] = [
    { key: 'name', header: 'Mahsulot', render: (p) => <span className="font-medium text-content">{p.name}</span> },
    { key: 'factory', header: 'Zavod', render: (p) => <Badge tone="teal">{p.factory?.name}</Badge> },
    { key: 'size', header: "O'lcham", render: (p) => p.size ?? '—' },
    { key: 'costPrice', header: 'Kirim narxi', align: 'right', render: (p) => fmtNum(p.costPrice) },
    { key: 'salePrice', header: 'Sotuv narxi', align: 'right', render: (p) => fmtNum(p.salePrice) },
    { key: 'orders', header: 'Buyurtma', align: 'right', render: (p) => p._count?.orders ?? 0 },
  ];

  return (
    <div>
      <PageHeader title="Mahsulotlar" subtitle="Zavodga bog'langan mahsulotlar (gazoblok o'lchamlari)" breadcrumb={['Katalog', 'Mahsulotlar']}
        action={<Button onClick={openNew}><Plus size={16} /> Yangi mahsulot</Button>} />
      <EntityTable columns={columns} data={products} rowKey={(p) => p.id} searchKeys={['name', (p) => p.factory?.name ?? '']} exportName="mahsulotlar"
        actions={(p) => (<>
          <button onClick={() => openEdit(p)} className="rounded-md p-1.5 text-faint hover:bg-hover hover:text-content"><Pencil size={15} /></button>
          <button onClick={() => del.mutate(p.id)} className="rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500"><Trash2 size={15} /></button>
        </>)} />
      <Drawer open={open} onClose={close} title={editing ? 'Mahsulotni tahrirlash' : 'Yangi mahsulot'}>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate({ ...form }); }} className="space-y-3">
          <Field label="Zavod" required><Select value={form.factoryId} onChange={(e) => set('factoryId', e.target.value)} required><option value="">—</option>{(factories ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
          <Field label="Nomi" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Gazoblok 600x300x200" required /></Field>
          <Field label="O'lcham"><Input value={form.size} onChange={(e) => set('size', e.target.value)} placeholder="600x300x200" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kirim narxi (m³)"><MoneyInput value={form.costPrice} onChange={(v) => set('costPrice', v)} /></Field>
            <Field label="Sotuv narxi (m³)"><MoneyInput value={form.salePrice} onChange={(v) => set('salePrice', v)} /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={close}>Bekor</Button><Button type="submit" loading={save.isPending}>Saqlash</Button></div>
        </form>
      </Drawer>
    </div>
  );
}
