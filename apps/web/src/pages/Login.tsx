import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LogIn, TrendingUp, Factory, Wallet, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Input } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { LogoMark } from '../components/Logo';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try { await login(username.trim(), password); nav('/'); }
    catch { setError('Login yoki parol xato'); }
    finally { setLoading(false); }
  };

  return (
    <div className="app-canvas flex min-h-screen">
      <div className="grad-hero relative hidden w-1/2 overflow-hidden lg:flex">
        <div className="pointer-events-none absolute -left-20 -top-20 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-0 h-96 w-96 rounded-full bg-accent-500/25 blur-3xl" />
        <div className="pointer-events-none absolute right-10 top-1/3 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative z-10 flex flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <LogoMark size={44} />
            <span className="text-xl font-extrabold tracking-tight">SmartBlok</span>
          </div>
          <div>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight">Gazoblok biznesini<br />bitta tizimda boshqaring</h1>
            <p className="mt-4 max-w-md text-white/80">Sotuv, to'lov, kassa, mijoz qarzlari, zavod bilan hisob-kitob va ko'p-zavodli tannarx optimizatsiyasi — hammasi bir joyda.</p>
            <div className="mt-8 grid grid-cols-2 gap-4">
              {[
                { icon: TrendingUp, t: 'Sotuv va foyda' },
                { icon: Wallet, t: 'Kassa va to\'lovlar' },
                { icon: Factory, t: 'Zavod tannarxi' },
                { icon: ShieldCheck, t: 'Rollar va nazorat' },
              ].map((f) => (
                <div key={f.t} className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/15 backdrop-blur">
                  <f.icon size={18} /> <span className="text-sm font-medium">{f.t}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-white/50">© 2026 SmartBlok · Xorazm</p>
        </div>
      </div>

      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><LogoMark size={48} /></div>
          <h2 className="text-2xl font-bold tracking-tight text-content">Tizimga kirish</h2>
          <p className="mt-1 text-sm text-muted">Foydalanuvchi nomi va parolingizni kiriting</p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Foydalanuvchi nomi</label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="masalan: admin" autoComplete="username" required />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Parol</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
            </div>
            {error && <p className="text-sm font-medium text-red-500">{error}</p>}
            <Button type="submit" className="w-full" loading={loading}><LogIn size={16} /> Kirish</Button>
          </form>

        </motion.div>
      </div>
    </div>
  );
}
