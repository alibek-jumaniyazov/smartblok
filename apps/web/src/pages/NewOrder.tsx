import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ClipboardList, Package, Wallet, FileText, Save, Plus,
  AlertTriangle, UserCog, Users, Factory, Truck, TrendingUp,
} from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field, Input, Select, Textarea } from '../components/ui/Field';
import { MoneyInput } from '../components/ui/MoneyInput';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { fmtUZS, fmtNum } from '../lib/format';
import { cn } from '../lib/utils';

const empty = { date: new Date().toISOString().slice(0, 10), agentId: '', clientId: '', factoryId: '', productId: '', vehicleId: '', quantity: '', costPricePerUnit: 0, salePricePerUnit: 0, transportFee: 0, note: '' };

function Section({ icon, title, subtitle, children, delay }: { icon: ReactNode; title: string; subtitle?: string; children: ReactNode; delay?: number }) {
  return (
    <Card delay={delay} className="p-0">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary-soft text-primary">{icon}</div>
        <div>
          <h3 className="text-sm font-bold tracking-tight text-content">{title}</h3>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-muted">{label}</span>
      <span className={cn('tabular-nums', strong ? 'text-sm font-bold text-content' : 'text-sm font-semibold text-body')}>{value}</span>
    </div>
  );
}

function ChainRow({ icon, label, value, tone = 'primary' }: { icon: ReactNode; label: string; value?: string; tone?: 'primary' | 'amber' | 'muted' }) {
  const set = value ? value : '—';
  const toneCls = value ? (tone === 'amber' ? 'bg-accent-500/15 text-accent-600 dark:text-accent-400' : 'bg-primary-soft text-primary') : 'bg-subtle text-faint';
  return (
    <div className="flex items-center gap-2.5">
      <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', toneCls)}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</p>
        <p className={cn('truncate text-[13px] font-semibold', value ? 'text-content' : 'text-faint')}>{set}</p>
      </div>
    </div>
  );
}

export default function NewOrder() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [form, setForm] = useState<any>(empty);

  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: endpoints.agents });
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: endpoints.clients });
  const { data: factories } = useQuery({ queryKey: ['factories'], queryFn: endpoints.factories });
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: endpoints.vehicles });
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => endpoints.products() });

  const create = useMutation({ mutationFn: (d: any) => endpoints.createOrder(d) });

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const factoryProducts = useMemo(
    () => (products ?? []).filter((p: any) => !form.factoryId || p.factoryId === form.factoryId),
    [products, form.factoryId],
  );

  const selectedClient = useMemo(() => (clients ?? []).find((c: any) => c.id === form.clientId), [clients, form.clientId]);
  const selectedAgent = useMemo(() => (agents ?? []).find((a: any) => a.id === form.agentId), [agents, form.agentId]);
  const selectedFactory = useMemo(() => (factories ?? []).find((f: any) => f.id === form.factoryId), [factories, form.factoryId]);
  const selectedVehicle = useMemo(() => (vehicles ?? []).find((v: any) => v.id === form.vehicleId), [vehicles, form.vehicleId]);
  const selectedProduct = useMemo(() => (products ?? []).find((p: any) => p.id === form.productId), [products, form.productId]);

  const preview = useMemo(() => {
    const q = Number(form.quantity) || 0, c = Number(form.costPricePerUnit) || 0, s = Number(form.salePricePerUnit) || 0, t = Number(form.transportFee) || 0;
    const costTotal = q * c, saleTotal = q * s, profit = saleTotal - costTotal - t;
    const margin = saleTotal > 0 ? (profit / saleTotal) * 100 : 0;
    return { q, costTotal, saleTotal, transport: t, profit, margin };
  }, [form]);

  // credit-limit projection — mirrors the server rule (creditLimit 0 = unlimited)
  const credit = useMemo(() => {
    const limit = Number(selectedClient?.creditLimit) || 0;
    const balance = Number(selectedClient?.balance) || 0;
    const projected = balance + preview.saleTotal;
    const over = limit > 0 && projected > limit;
    const pct = limit > 0 ? Math.min(100, (projected / limit) * 100) : 0;
    return { limit, balance, projected, over, pct, remaining: limit - projected };
  }, [selectedClient, preview.saleTotal]);

  function pickProduct(id: string) {
    const prod = (products ?? []).find((p: any) => p.id === id);
    setForm((f: any) => ({ ...f, productId: id, ...(prod ? { costPricePerUnit: prod.costPrice, salePricePerUnit: prod.salePrice, factoryId: prod.factoryId } : {}) }));
  }

  function pickClient(id: string) {
    const cl = (clients ?? []).find((c: any) => c.id === id);
    setForm((f: any) => ({ ...f, clientId: id, agentId: f.agentId || (cl?.agentId ?? '') }));
  }

  const valid = !!form.clientId && !!form.productId && (Number(form.quantity) || 0) > 0;

  function submit(stay: boolean) {
    if (!valid) { toast('Mijoz, mahsulot va miqdorni to‘ldiring', 'error'); return; }
    create.mutate({ ...form }, {
      onSuccess: () => {
        qc.invalidateQueries();
        toast('Buyurtma yaratildi');
        if (stay) setForm({ ...empty, date: form.date, agentId: form.agentId });
        else nav('/orders');
      },
      onError: (e: any) => toast(e?.response?.data?.message || 'Xatolik yuz berdi', 'error'),
    });
  }

  const serverError = (create.error as any)?.response?.data?.message as string | undefined;

  return (
    <div>
      <PageHeader
        title="Yangi buyurtma"
        subtitle="Agent → mijoz → zavod → mahsulot → moshina zanjiri bo‘yicha buyurtma rasmiylashtiring"
        breadcrumb={['Savdo', 'Buyurtmalar', 'Yangi']}
        action={<Button variant="outline" onClick={() => nav('/orders')}><ArrowLeft size={16} /> Buyurtmalar</Button>}
      />

      <form onSubmit={(e) => { e.preventDefault(); submit(false); }} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ---- left: form ---- */}
        <div className="space-y-5 lg:col-span-2">
          <Section icon={<ClipboardList size={18} />} title="Asosiy ma'lumot" subtitle="Sana, agent, mijoz va zavod" delay={0.02}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Sana" required>
                <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required />
              </Field>
              <Field label="Agent" hint="Bo‘sh qoldirsangiz — mijozning agenti">
                <Select value={form.agentId} onChange={(e) => set('agentId', e.target.value)}>
                  <option value="">—</option>
                  {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
              <Field label="Mijoz" required>
                <Select value={form.clientId} onChange={(e) => pickClient(e.target.value)} required>
                  <option value="">— tanlang —</option>
                  {(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Zavod" required>
                <Select value={form.factoryId} onChange={(e) => { set('factoryId', e.target.value); set('productId', ''); }} required>
                  <option value="">— tanlang —</option>
                  {(factories ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
              </Field>
            </div>
          </Section>

          <Section icon={<Package size={18} />} title="Mahsulot va yetkazish" subtitle="Mahsulot narxi avtomatik to‘ladi" delay={0.06}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Mahsulot" required hint={form.factoryId ? undefined : 'Avval zavodni tanlang'}>
                <Select value={form.productId} onChange={(e) => pickProduct(e.target.value)} required disabled={!form.factoryId}>
                  <option value="">— tanlang —</option>
                  {factoryProducts.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Moshina" hint="Yuklashdan oldin biriktirsangiz bo‘ladi">
                <Select value={form.vehicleId} onChange={(e) => set('vehicleId', e.target.value)}>
                  <option value="">—</option>
                  {(vehicles ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Miqdor (m³)" required>
                  <Input type="number" step="0.01" min="0" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} placeholder="0.00" />
                </Field>
              </div>
            </div>
          </Section>

          <Section icon={<Wallet size={18} />} title="Narx va xarajat" subtitle="Bir m³ uchun narxlar" delay={0.1}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Kirim narxi (m³)"><MoneyInput value={form.costPricePerUnit} onChange={(v) => set('costPricePerUnit', v)} /></Field>
              <Field label="Sotuv narxi (m³)"><MoneyInput value={form.salePricePerUnit} onChange={(v) => set('salePricePerUnit', v)} /></Field>
              <Field label="Transport haqi"><MoneyInput value={form.transportFee} onChange={(v) => set('transportFee', v)} /></Field>
            </div>
          </Section>

          <Section icon={<FileText size={18} />} title="Izoh" subtitle="Ixtiyoriy" delay={0.14}>
            <Textarea value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Qo‘shimcha izoh (ixtiyoriy)" />
          </Section>
        </div>

        {/* ---- right: sticky summary ---- */}
        <div className="lg:col-span-1">
          <div className="space-y-5 lg:sticky lg:top-6">
            <Card delay={0.08} className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <h3 className="text-sm font-bold tracking-tight text-content">Buyurtma xulosasi</h3>
                <Badge tone="neutral" dot>Yangi</Badge>
              </div>

              {/* selected chain */}
              <div className="grid grid-cols-1 gap-3 border-b border-line px-5 py-4 sm:grid-cols-2 lg:grid-cols-1">
                <ChainRow icon={<UserCog size={15} />} label="Agent" value={selectedAgent?.name} />
                <ChainRow icon={<Users size={15} />} label="Mijoz" value={selectedClient?.name} />
                <ChainRow icon={<Factory size={15} />} label="Zavod" value={selectedFactory?.name} />
                <ChainRow icon={<Package size={15} />} label="Mahsulot" value={selectedProduct?.name} tone="amber" />
                <ChainRow icon={<Truck size={15} />} label="Moshina" value={selectedVehicle?.name} />
              </div>

              {/* numbers */}
              <div className="px-5 py-4">
                <SummaryRow label="Miqdor" value={`${fmtNum(preview.q, 2)} m³`} />
                <SummaryRow label="Kirim summa" value={fmtUZS(preview.costTotal)} />
                <SummaryRow label="Sotuv summa" value={fmtUZS(preview.saleTotal)} strong />
                <SummaryRow label="Transport" value={fmtUZS(preview.transport)} />

                <div className="mt-3 grad-hero relative overflow-hidden rounded-xl border border-white/10 p-4 text-white shadow-primary">
                  <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/15 blur-2xl" />
                  <div className="relative flex items-center justify-between">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/80"><TrendingUp size={13} /> Sof foyda</p>
                      <p className="mt-1 text-2xl font-extrabold tabular-nums">{fmtUZS(preview.profit)}</p>
                    </div>
                    <div className="rounded-lg bg-white/15 px-2.5 py-1 text-right ring-1 ring-white/20">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">Marja</p>
                      <p className="text-sm font-bold tabular-nums">{preview.margin.toFixed(1)}%</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* credit limit */}
              {selectedClient && credit.limit > 0 && (
                <div className="border-t border-line px-5 py-4">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-semibold text-muted">Kredit limiti</span>
                    <span className={cn('font-bold tabular-nums', credit.over ? 'text-red-500' : 'text-muted')}>
                      {fmtUZS(credit.projected)} / {fmtUZS(credit.limit)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-subtle">
                    <div
                      className={cn('h-full rounded-full transition-all', credit.over ? 'bg-red-500' : credit.pct > 80 ? 'bg-accent-500' : 'bg-emerald-500')}
                      style={{ width: `${Math.max(4, credit.pct)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
                    <span>Joriy qarz: <b className="text-muted">{fmtUZS(credit.balance)}</b></span>
                    {!credit.over && <span>Qoldiq: <b className="text-emerald-600 dark:text-emerald-400">{fmtUZS(credit.remaining)}</b></span>}
                  </div>
                  {credit.over && (
                    <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 ring-1 ring-inset ring-red-500/20 dark:text-red-400">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <span>Kredit limiti oshib ketadi — server buyurtmani rad etishi mumkin.</span>
                    </div>
                  )}
                </div>
              )}

              {/* server error */}
              {serverError && (
                <div className="border-t border-line px-5 pt-4">
                  <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 ring-1 ring-inset ring-red-500/20 dark:text-red-400">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <span>{serverError}</span>
                  </div>
                </div>
              )}

              {/* actions */}
              <div className="space-y-2 px-5 py-4">
                <Button type="submit" className="w-full" loading={create.isPending} disabled={!valid}>
                  <Save size={16} /> Buyurtmani saqlash
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="subtle" onClick={() => submit(true)} disabled={!valid || create.isPending}>
                    <Plus size={15} /> Saqlab, yana
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => nav('/orders')}>Bekor qilish</Button>
                </div>
              </div>
            </Card>

            <p className="px-1 text-center text-[11px] leading-relaxed text-faint">
              Buyurtma <b className="text-muted">Yangi</b> holatida yaratiladi. Moshina keyinroq, yuklash bosqichida ham biriktirilishi mumkin.
            </p>
          </div>
        </div>
      </form>
    </div>
  );
}
