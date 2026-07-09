import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Receipt, Tag } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Drawer } from '../components/ui/Drawer';
import { Field, Input, Select } from '../components/ui/Field';
import { MoneyInput } from '../components/ui/MoneyInput';
import { KpiCard } from '../components/ui/KpiCard';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { fmtUZS, fmtDate } from '../lib/format';

const empty = { date: new Date().toISOString().slice(0, 10), categoryId: '', amount: 0, cashboxId: '', note: '' };

export default function Expenses() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const [newCat, setNewCat] = useState('');

  const { data: expenses } = useQuery({ queryKey: ['expenses'], queryFn: endpoints.expenses });
  const { data: summary } = useQuery({ queryKey: ['expenseSummary'], queryFn: endpoints.expenseSummary });
  const { data: cats } = useQuery({ queryKey: ['expenseCategories'], queryFn: endpoints.expenseCategories });
  const { data: kassa } = useQuery({ queryKey: ['kassa'], queryFn: endpoints.kassaSummary });

  const create = useMutation({ mutationFn: (d: any) => endpoints.createExpense(d), onSuccess: () => { qc.invalidateQueries(); setOpen(false); setForm(empty); toast("Xarajat qo'shildi"); }, onError: (e: any) => toast(e?.response?.data?.message || 'Xatolik', 'error') });
  const del = useMutation({ mutationFn: (id: string) => endpoints.deleteExpense(id), onSuccess: () => { qc.invalidateQueries(); toast("O'chirildi"); } });
  const addCat = useMutation({ mutationFn: (name: string) => endpoints.createExpenseCategory({ name }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenseCategories'] }); setNewCat(''); toast("Kategoriya qo'shildi"); } });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const columns: Column<any>[] = [
    { key: 'date', header: 'Sana', render: (e) => fmtDate(e.date), value: (e) => e.date },
    { key: 'category', header: 'Kategoriya', render: (e) => e.category ? <Badge tone="violet">{e.category.name}</Badge> : '—' },
    { key: 'note', header: 'Izoh', render: (e) => e.note ?? '—' },
    { key: 'cashbox', header: 'Kassa', render: (e) => e.cashbox?.name ?? '—' },
    { key: 'amount', header: 'Summa', align: 'right', value: (e) => e.amount, render: (e) => <span className="font-semibold text-red-600 dark:text-red-400 tabular-nums">− {fmtUZS(e.amount)}</span> },
  ];

  return (
    <div>
      <PageHeader title="Xarajatlar" subtitle="Kassadan chiqim — kategoriya bilan" breadcrumb={['Moliya', 'Xarajatlar']}
        action={<div className="flex gap-2"><Button variant="outline" onClick={() => setCatOpen(true)}><Tag size={15} /> Kategoriyalar</Button><Button onClick={() => setOpen(true)}><Plus size={16} /> Yangi xarajat</Button></div>} />

      <div className="mb-5 max-w-xs"><KpiCard label="Jami xarajat" value={summary?.total ?? 0} suffix="so'm" tone="red" icon={<Receipt size={20} />} /></div>

      <EntityTable columns={columns} data={expenses} rowKey={(e) => e.id} searchKeys={['note', (e) => e.category?.name ?? '']} exportName="xarajatlar"
        actions={(e) => <button onClick={() => del.mutate(e.id)} className="rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500"><Trash2 size={15} /></button>} />

      <Drawer open={open} onClose={() => setOpen(false)} title="Yangi xarajat" subtitle="Pul kassadan chiqadi">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form }); }} className="space-y-3">
          <Field label="Kategoriya" required><Select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)} required><option value="">—</option>{(cats ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Summa" required><MoneyInput value={form.amount} onChange={(v) => set('amount', v)} /></Field>
          <Field label="Kassa" required><Select value={form.cashboxId} onChange={(e) => set('cashboxId', e.target.value)} required><option value="">—</option>{(kassa?.boxes ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
          <Field label="Sana"><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="Izoh"><Input value={form.note} onChange={(e) => set('note', e.target.value)} /></Field>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button><Button type="submit" loading={create.isPending}>Saqlash</Button></div>
        </form>
      </Drawer>

      <Drawer open={catOpen} onClose={() => setCatOpen(false)} title="Xarajat kategoriyalari">
        <div className="space-y-3">
          <form onSubmit={(e) => { e.preventDefault(); if (newCat.trim()) addCat.mutate(newCat.trim()); }} className="flex gap-2">
            <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Yangi kategoriya" />
            <Button type="submit" loading={addCat.isPending}>Qo'shish</Button>
          </form>
          <div className="space-y-1.5">
            {(cats ?? []).map((c: any) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                <span className="font-medium text-content">{c.name}</span>
                <span className="text-xs text-faint">{c._count?.expenses ?? 0} ta</span>
              </div>
            ))}
          </div>
        </div>
      </Drawer>
    </div>
  );
}
