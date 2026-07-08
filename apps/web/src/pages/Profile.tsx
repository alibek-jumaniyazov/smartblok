import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { User, KeyRound, Save } from 'lucide-react';
import { endpoints } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toaster';

const roleLabel: Record<string, string> = { ADMIN: 'Administrator', ACCOUNTANT: 'Buxgalter', AGENT: 'Agent', CASHIER: 'Kassir' };
const roleTone: Record<string, any> = { ADMIN: 'violet', ACCOUNTANT: 'blue', AGENT: 'teal', CASHIER: 'amber' };

export default function Profile() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [info, setInfo] = useState({ name: user?.name ?? '', username: user?.username ?? '', email: user?.email ?? '', phone: (user as any)?.phone ?? '' });
  const [pw, setPw] = useState({ password: '', confirm: '' });

  const saveInfo = useMutation({
    mutationFn: () => endpoints.updateProfile({ name: info.name, username: info.username, email: info.email, phone: info.phone }),
    onSuccess: async () => { await refresh(); toast('Profil yangilandi'); },
    onError: (e: any) => toast(e?.response?.data?.message || 'Xatolik', 'error'),
  });

  const savePw = useMutation({
    mutationFn: () => endpoints.updateProfile({ password: pw.password }),
    onSuccess: () => { setPw({ password: '', confirm: '' }); toast('Parol yangilandi'); },
    onError: () => toast('Xatolik', 'error'),
  });

  const set = (k: string, v: any) => setInfo((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <PageHeader title="Profil" subtitle="Shaxsiy ma'lumot va parolni boshqarish" breadcrumb={['Hisob', 'Profil']} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* summary card */}
        <Card>
          <div className="flex flex-col items-center text-center">
            <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-3xl font-bold text-white">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <p className="mt-3 text-lg font-bold text-content">{user?.name}</p>
            <p className="text-sm text-muted">@{user?.username}</p>
            <div className="mt-2"><Badge tone={roleTone[user?.role ?? ''] ?? 'neutral'} dot>{roleLabel[user?.role ?? ''] ?? user?.role}</Badge></div>
          </div>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardTitle><span className="flex items-center gap-2"><User size={17} /> Shaxsiy ma'lumot</span></CardTitle>
            <form onSubmit={(e) => { e.preventDefault(); saveInfo.mutate(); }} className="grid grid-cols-2 gap-3">
              <Field label="Ism" required><Input value={info.name} onChange={(e) => set('name', e.target.value)} required /></Field>
              <Field label="Foydalanuvchi nomi" required><Input value={info.username} onChange={(e) => set('username', e.target.value)} required /></Field>
              <Field label="Email (ixtiyoriy)"><Input type="email" value={info.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
              <Field label="Telefon"><Input value={info.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+998" /></Field>
              <div className="col-span-2 flex justify-end"><Button type="submit" loading={saveInfo.isPending}><Save size={15} /> Saqlash</Button></div>
            </form>
          </Card>

          <Card>
            <CardTitle><span className="flex items-center gap-2"><KeyRound size={17} /> Parolni o'zgartirish</span></CardTitle>
            <form onSubmit={(e) => { e.preventDefault(); if (pw.password !== pw.confirm) { toast('Parollar mos emas', 'error'); return; } if (pw.password.length < 4) { toast('Parol juda qisqa', 'error'); return; } savePw.mutate(); }} className="grid grid-cols-2 gap-3">
              <Field label="Yangi parol" required><Input type="password" value={pw.password} onChange={(e) => setPw((p) => ({ ...p, password: e.target.value }))} required /></Field>
              <Field label="Parolni tasdiqlang" required><Input type="password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} required /></Field>
              <div className="col-span-2 flex justify-end"><Button type="submit" variant="outline" loading={savePw.isPending}><KeyRound size={15} /> Parolni yangilash</Button></div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
