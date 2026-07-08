import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Table, Th, Td } from '../components/ui/Table';
import { Modal } from '../components/ui/Modal';
import { Field, Input, Select } from '../components/ui/Field';
import { TableSkeleton } from '../components/ui/Skeleton';
import { fmtUZS, fmtDate, fmtNum } from '../lib/format';
import { useAuth } from '../auth/AuthContext';

const empty = {
  date: new Date().toISOString().slice(0, 10),
  agentId: '', clientId: '', factoryId: '', regionId: '', plate: '',
  blockSizeId: '', cubes: 32.832, costPricePerM3: 500000, palletQty: 19,
  palletPrice: 130000, salePricePerM3: 730000, transportCost: 2000000, transportPaid: true,
};

export default function Sales() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = user?.role !== undefined;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const [suggest, setSuggest] = useState<string>('');

  const { data: sales } = useQuery({ queryKey: ['sales'], queryFn: () => endpoints.sales() });
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: endpoints.agents });
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: endpoints.clients });
  const { data: sizes } = useQuery({ queryKey: ['sizes'], queryFn: endpoints.blockSizes });
  const { data: factories } = useQuery({ queryKey: ['factories'], queryFn: endpoints.factories });
  const { data: regions } = useQuery({ queryKey: ['regions'], queryFn: endpoints.regions });

  const create = useMutation({
    mutationFn: (d: any) => endpoints.createSale(d),
    onSuccess: () => { qc.invalidateQueries(); setOpen(false); setForm(empty); setSuggest(''); },
  });
  const del = useMutation({
    mutationFn: (id: number) => endpoints.deleteSale(id),
    onSuccess: () => qc.invalidateQueries(),
  });

  const preview = useMemo(() => {
    const cubes = Number(form.cubes) || 0;
    const cost = Number(form.costPricePerM3) || 0;
    const pq = Number(form.palletQty) || 0;
    const pp = Number(form.palletPrice) || 0;
    const sale = Number(form.salePricePerM3) || 0;
    const tr = Number(form.transportCost) || 0;
    const costTotal = cubes * cost;
    const palletTotal = pq * pp;
    const saleTotal = cubes * sale;
    const profit = saleTotal - costTotal - palletTotal - tr;
    return { costTotal, palletTotal, saleTotal, profit };
  }, [form]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  async function suggestCost() {
    if (!form.regionId) { setSuggest('Avval hududni tanlang'); return; }
    const m = await endpoints.matrix(Number(form.regionId));
    if (m.cheapest) {
      set('costPricePerM3', Math.round(m.cheapest.landedCostPerM3));
      setSuggest('Eng arzon: ' + m.cheapest.factory + ' (' + m.cheapest.paymentMethod + ') -> ' + fmtUZS(m.cheapest.landedCostPerM3) + '/m3');
    } else setSuggest('Bu hudud uchun marshrut topilmadi');
  }

  return (
    <div>
      <PageHeader
        title="Sotuvlar (Tovar)"
        subtitle="Har bir yozuv — bitta mashina yuki. Foyda avtomatik hisoblanadi."
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Yangi sotuv</Button>}
      />

      {!sales ? <TableSkeleton /> : (
        <Table head={
          <tr>
            <Th>Sana</Th><Th>Agent</Th><Th>Mijoz</Th><Th>Avto</Th><Th>O'lcham</Th>
            <Th right>m³</Th><Th right>Sotuv narxi</Th><Th right>Sotuv summa</Th><Th right>Foyda</Th><Th>{''}</Th>
          </tr>
        }>
          {sales.map((s: any) => (
            <tr key={s.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
              <Td>{fmtDate(s.date)}</Td>
              <Td>{s.agent?.name ?? '—'}</Td>
              <Td className="font-medium">{s.client?.name}</Td>
              <Td>{s.plate ?? '—'}</Td>
              <Td>{s.blockSize?.name ?? '—'}</Td>
              <Td right>{fmtNum(s.cubes, 2)}</Td>
              <Td right>{fmtNum(s.salePricePerM3)}</Td>
              <Td right>{fmtUZS(s.saleTotal)}</Td>
              <Td right><span className="text-emerald-600 dark:text-emerald-400">{fmtUZS(s.profit)}</span></Td>
              <Td>
                {canEdit && (
                  <button onClick={() => del.mutate(s.id)} className="rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
                    <Trash2 size={15} />
                  </button>
                )}
              </Td>
            </tr>
          ))}
          {sales.length === 0 && (
            <tr><Td className="py-10 text-center text-ink-400">Hozircha sotuvlar yo'q</Td></tr>
          )}
        </Table>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Yangi sotuv (mashina yuki)" wide>
        <form
          onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form }); }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        >
          <Field label="Sana"><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required /></Field>
          <Field label="Agent">
            <Select value={form.agentId} onChange={(e) => set('agentId', e.target.value)}>
              <option value="">—</option>
              {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Mijoz">
            <Select value={form.clientId} onChange={(e) => set('clientId', e.target.value)} required>
              <option value="">—</option>
              {(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Zavod">
            <Select value={form.factoryId} onChange={(e) => set('factoryId', e.target.value)}>
              <option value="">—</option>
              {(factories ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
          <Field label="Hudud">
            <Select value={form.regionId} onChange={(e) => set('regionId', e.target.value)}>
              <option value="">—</option>
              {(regions ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label="Avto raqami"><Input value={form.plate} onChange={(e) => set('plate', e.target.value)} placeholder="90 A 123 BC" /></Field>
          <Field label="O'lcham">
            <Select value={form.blockSizeId} onChange={(e) => set('blockSizeId', e.target.value)}>
              <option value="">—</option>
              {(sizes ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Hajm (m³)"><Input type="number" step="0.001" value={form.cubes} onChange={(e) => set('cubes', e.target.value)} /></Field>
          <Field label="Kirim narxi (m³)"><Input type="number" value={form.costPricePerM3} onChange={(e) => set('costPricePerM3', e.target.value)} /></Field>
          <Field label="Poddon soni"><Input type="number" value={form.palletQty} onChange={(e) => set('palletQty', e.target.value)} /></Field>
          <Field label="Poddon narxi"><Input type="number" value={form.palletPrice} onChange={(e) => set('palletPrice', e.target.value)} /></Field>
          <Field label="Sotuv narxi (m³)"><Input type="number" value={form.salePricePerM3} onChange={(e) => set('salePricePerM3', e.target.value)} /></Field>
          <Field label="Transport xarajati"><Input type="number" value={form.transportCost} onChange={(e) => set('transportCost', e.target.value)} /></Field>

          <div className="col-span-2 sm:col-span-3">
            <Button type="button" variant="outline" onClick={suggestCost}><Sparkles size={15} /> Eng arzon tannarxni taklif qil</Button>
            {suggest && <p className="mt-1 text-xs text-brand-600 dark:text-brand-400">{suggest}</p>}
          </div>

          <div className="col-span-2 grid grid-cols-2 gap-3 rounded-xl bg-ink-50 p-3 text-sm sm:col-span-3 sm:grid-cols-4 dark:bg-ink-950">
            <div><p className="text-xs text-ink-400">Kirim summa</p><p className="font-semibold tabular-nums">{fmtUZS(preview.costTotal)}</p></div>
            <div><p className="text-xs text-ink-400">Poddon summa</p><p className="font-semibold tabular-nums">{fmtUZS(preview.palletTotal)}</p></div>
            <div><p className="text-xs text-ink-400">Sotuv summa</p><p className="font-semibold tabular-nums">{fmtUZS(preview.saleTotal)}</p></div>
            <div><p className="text-xs text-ink-400">Foyda</p><p className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUZS(preview.profit)}</p></div>
          </div>

          <div className="col-span-2 mt-2 flex justify-end gap-2 sm:col-span-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Saqlanmoqda...' : 'Saqlash'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
