import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, ShoppingCart, Wallet, Factory, X } from 'lucide-react';
import { endpoints } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';
import { cn } from '../lib/utils';

export default function ImportPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(true);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  function pick(f: File | null) {
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name)) { toast('Faqat Excel (.xlsx) fayl', 'error'); return; }
    setFile(f); setResult(null);
  }

  async function run() {
    if (!file) return;
    setLoading(true); setResult(null);
    try {
      const res = await endpoints.importExcel(file, replace);
      setResult(res);
      qc.invalidateQueries();
      toast('Import muvaffaqiyatli yakunlandi');
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Import xatosi', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Excel import"
        subtitle="Gazoblok hisob-kitob faylini yuklab, bazani to'ldiring"
        breadcrumb={['Tizim', 'Excel import']}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            {/* dropzone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] ?? null); }}
              onClick={() => inputRef.current?.click()}
              className={cn('flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors',
                drag ? 'border-primary bg-primary/5' : 'border-line hover:border-primary/50 hover:bg-hover')}
            >
              <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/12 text-primary">
                <UploadCloud size={28} />
              </div>
              <p className="mt-4 font-semibold text-content">Excel faylni bu yerga tashlang</p>
              <p className="mt-1 text-sm text-muted">yoki bosing va tanlang (.xlsx)</p>
            </div>

            {file && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="mt-4 flex items-center gap-3 rounded-lg border border-line bg-subtle p-3">
                <FileSpreadsheet size={22} className="text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-content">{file.name}</p>
                  <p className="text-xs text-faint">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button onClick={() => setFile(null)} className="text-faint hover:text-content"><X size={16} /></button>
              </motion.div>
            )}

            <label className="mt-4 flex items-start gap-2.5 rounded-lg border border-line p-3">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[color:var(--primary)]" />
              <span className="text-sm">
                <span className="font-medium text-content">Mavjud ma'lumotni almashtirish (0 dan)</span>
                <span className="mt-0.5 block text-xs text-muted">Sotuv, to'lov, mijoz va zavod to'lovlari o'chirilib, fayldagi bilan qayta yoziladi. Foydalanuvchi va kassa saqlanadi.</span>
              </span>
            </label>

            <div className="mt-4 flex justify-end">
              <Button onClick={run} disabled={!file || loading}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                {loading ? 'Import qilinmoqda...' : 'Import qilish'}
              </Button>
            </div>
          </Card>

          {result && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
              <Card>
                <div className="mb-4 flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={20} /> <h3 className="font-semibold">Import yakunlandi</h3>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { icon: ShoppingCart, label: 'Sotuvlar', v: result.imported.sales, tone: 'text-brand-600' },
                    { icon: Wallet, label: "To'lovlar", v: result.imported.payments, tone: 'text-emerald-600' },
                    { icon: Factory, label: 'Zavod to\'lovlari', v: result.imported.factoryPayments, tone: 'text-sky-600' },
                    { icon: AlertTriangle, label: "O'tkazib yuborildi", v: result.imported.skipped, tone: 'text-amber-600' },
                  ].map((x) => (
                    <div key={x.label} className="rounded-lg border border-line bg-subtle p-3 text-center">
                      <x.icon size={18} className={cn('mx-auto', x.tone)} />
                      <p className="mt-1 text-2xl font-bold tabular-nums text-content">{x.v}</p>
                      <p className="text-xs text-muted">{x.label}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-faint">Aniqlangan varaqlar: {result.sheets?.slice(0, 6).join(', ')}{result.sheets?.length > 6 ? '…' : ''}</p>
              </Card>
            </motion.div>
          )}
        </div>

        {/* instructions */}
        <Card>
          <h3 className="mb-3 font-semibold text-content">Qanday ishlaydi?</h3>
          <ol className="space-y-3 text-sm text-muted">
            {[
              'Gazoblok Hisob (.xlsx) faylini tanlang',
              "Товар varag'i → Sotuvlar",
              "Оплата varag'i → To'lovlar",
              "Оплата Завод → Zavod to'lovlari",
              'Agent, mijoz, zavod va o\'lchamlar avtomatik yaratiladi',
              'Import qiling — barcha ma\'lumot saytda paydo bo\'ladi',
            ].map((t, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/12 text-[11px] font-bold text-primary">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            "Almashtirish" yoqilgan bo'lsa, eski tranzaksiyalar o'chiriladi. Avval zaxira oling.
          </div>
        </Card>
      </div>
    </div>
  );
}
