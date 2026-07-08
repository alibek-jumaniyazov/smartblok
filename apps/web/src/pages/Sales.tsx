import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EntityTable, type Column } from '../components/ui/EntityTable';
import { Modal } from '../components/ui/Modal';
import { Field, Input, Select } from '../components/ui/Field';
import { MoneyInput } from '../components/ui/MoneyInput';
import { useToast } from '../components/ui/Toaster';
import { fmtUZS, fmtDate, fmtNum } from '../lib/format';

const empty = {
  date: new Date().toISOString().slice(0, 10),
  agentId: '', clientId: '', factoryId: '', regionId: '', plate: '',
  blockSizeId: '', cubes: 32.832, costPricePerM3: 500000, palletQty: 19,
  palletPrice: 130000, salePricePerM3: 730000, transportCost: 2000000, transportPaid: true,
};

export default function Sales() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const [suggest, setSuggest] = useState('');

  const { data: sales } = useQuery({ queryKey: ['sales'], queryFn: () => endpoints.sales() });
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: endpoints.agents });
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: endpoints.clients });
  const { data: sizes } = useQuery({ queryKey: ['sizes'], queryFn: endpoints.blockSizes });
  const { data: factories } = useQuery({ queryKey: ['factories'], queryFn: endpoints.factories });
  const { data: regions } = useQuery({ queryKey: ['regions'], queryFn: endpoints.regions });

  const create = useMutation({
    mutationFn: (d: any) => endpoints.createSale(d),
    onSuccess: () => { qc.invalidateQueries(); setOpen(false); setForm(empty); setSuggest(''); toast("Sotuv qo'shildi"); },
    onError: () => toast('Xatolik', 'error'),
  });
  const del = useMutation({ mutationFn: (id: number) => endpoints.deleteSale(id), onSuccess: () => { qc.invalidateQueries(); toast("O'chirildi"); } });

  const preview = useMemo(() => {
    const cubes = Number(form.cubes) || 0, cost = Number(form.costPricePerM3) || 0;
    const pq = Number(form.palletQty) || 0, pp = Number(form.palletPrice) || 0;
    const sale = Number(form.salePricePerM3) || 0, tr = Number(form.transportCost) || 0;
    const costTotal = cubes * cost, palletTotal = pq * pp, saleTotal = cubes * sale;
    return { costTotal, palletTotal, saleTotal, profit: saleTotal - costTotal - palletTotal - tr };
  }, [form]);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  async function suggestCost() {
    if (!form.regionId) { setSuggest('Avval hududni tanlang'); return; }
    const m = await endpoints.matrix(Number(form.regionId));
    if (m.cheapest) { set('costPricePerM3', Math.round(m.cheapest.landedCostPerM3)); setSuggest(`Eng arzon: ${m.cheapest.factory} (${m.cheapest.paymentMethod}) → ${fmtUZS(m.cheapest.landedCostPerM3)}/m³`); }
    else setSuggest('Marshrut topilmadi');
  }

  const columns: Column<any>[] = [
    { key: 'date', header: 'Sana', render: (s) => fmtDate(s.date), value: (s) => s.date },
    { key: 'agent', header: 'Agent', render: (s) => s.agent?.name ?? '—' },
    { key: 'client', header: 'Mijoz', render: (s) => <span className="font-medium text-content">{s.client?.name}</span> },
    { key: 'plate', header: 'Avto', render: (s) => s.plate ?? '—' },
    { key: 'size', header: "O'lcham", render: (s) => s.blockSize?.name ?? '—' },
    { key: 'cubes', header: 'm³', align: 'right', render: (s) => fmtNum(s.cubes, 2) },
    { key: 'salePricePerM3', header: 'Narx', align: 'right', render: (s) => fmtNum(s.salePricePerM3) },
    { key: 'saleTotal', header: 'Summa', align: 'right', render: (s) => fmtUZS(s.saleTotal), value: (s) => s.saleTotal },
    { key: 'profit', header: 'Foyda', align: 'right', render: (s) => <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtUZS(s.profit)}</span>, value: (s) => s.profit },
  ];

  return (
    <div>
      <PageHeader title="Sotuvlar" subtitle="Har yozuv — bitta mashina yuki. Foyda avtomatik hisoblanadi." breadcrumb={['Savdo', 'Sotuvlar']}
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Yangi sotuv</Button>} />

      <EntityTable columns={columns} data={sales} rowKey={(s) => s.id} exportName="sotuvlar"
        searchKeys={[(s) => s.client?.name ?? '', (s) => s.agent?.name ?? '', 'plate']}
        actions={(s) => <button onClick={() => del.mutate(s.id)} className="rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500"><Trash2 size={15} /></button>} />

      <Modal open={open} onClose={() => setOpen(false)} title="Yangi sotuv" subtitle="Mashina yuki" wide>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form }); }} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Sana" required><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required /></Field>
          <Field label="Agent"><Select value={form.agentId} onChange={(e) => set('agentId', e.target.value)}><option value="">—</option>{(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Field label="Mijoz" required><Select value={form.clientId} onChange={(e) => set('clientId', e.target.value)} required><option value="">—</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Zavod"><Select value={form.factoryId} onChange={(e) => set('factoryId', e.target.value)}><option value="">—</option>{(factories ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
          <Field label="Hudud"><Select value={form.regionId} onChange={(e) => set('regionId', e.target.value)}><option value="">—</option>{(regions ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          <Field label="Avto raqami"><Input value={form.plate} onChange={(e) => set('plate', e.target.value)} placeholder="90 A 123 BC" /></Field>
          <Field label="O'lcham"><Select value={form.blockSizeId} onChange={(e) => set('blockSizeId', e.target.value)}><option value="">—</option>{(sizes ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Hajm (m³)"><Input type="number" step="0.001" value={form.cubes} onChange={(e) => set('cubes', e.target.value)} /></Field>
          <Field label="Kirim narxi (m³)"><MoneyInput value={form.costPricePerM3} onChange={(v) => set('costPricePerM3', v)} /></Field>
          <Field label="Poddon soni"><Input type="number" value={form.palletQty} onChange={(e) => set('palletQty', e.target.value)} /></Field>
          <Field label="Poddon narxi"><MoneyInput value={form.palletPrice} onChange={(v) => set('palletPrice', v)} /></Field>
          <Field label="Sotuv narxi (m³)"><MoneyInput value={form.salePricePerM3} onChange={(v) => set('salePricePerM3', v)} /></Field>
          <Field label="Transport xarajati"><MoneyInput value={form.transportCost} onChange={(v) => set('transportCost', v)} /></Field>

          <div className="col-span-2 sm:col-span-3">
            <Button type="button" variant="outline" size="sm" onClick={suggestCost}><Sparkles size={15} /> Eng arzon tannarx</Button>
            {suggest && <p className="mt-1 text-xs text-primary">{suggest}</p>}
          </div>

          <div className="col-span-2 grid grid-cols-2 gap-3 rounded-lg bg-subtle p-3 text-sm sm:col-span-3 sm:grid-cols-4">
            <div><p className="text-xs text-faint">Kirim</p><p className="font-semibold tabular-nums">{fmtUZS(preview.costTotal)}</p></div>
            <div><p className="text-xs text-faint">Poddon</p><p className="font-semibold tabular-nums">{fmtUZS(preview.palletTotal)}</p></div>
            <div><p className="text-xs text-faint">Sotuv</p><p className="font-semibold tabular-nums">{fmtUZS(preview.saleTotal)}</p></div>
            <div><p className="text-xs text-faint">Foyda</p><p className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUZS(preview.profit)}</p></div>
          </div>

          <div className="col-span-2 mt-1 flex justify-end gap-2 sm:col-span-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button>
            <Button type="submit" loading={create.isPending}>Saqlash</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
