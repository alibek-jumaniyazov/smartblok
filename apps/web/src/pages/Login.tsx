import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LogIn, TrendingUp, Factory, Wallet, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Input } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { LogoMark } from '../components/Logo';

const demos = [
  { username: 'admin', pass: 'admin123', role: 'Administrator' },
  { username: 'hisob', pass: 'hisob123', role: 'Buxgalter' },
  { username: 'jamol', pass: 'agent123', role: 'Agent' },
  { username: 'kassa', pass: 'kassa123', role: 'Kassir' },
];

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
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
    <div className="flex min-h-screen bg-app">
      <div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 lg:flex">
        <div className="pointer-events-none absolute -left-20 -top-20 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-0 h-96 w-96 rounded-full bg-accent-500/20 blur-3xl" />
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
                <div key={f.t} className="flex items-center gap-3 rounded-lg bg-white/10 px-4 py-3 backdrop-blur">
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
              <label className="mb-1.5 block text-xs font-medium text-muted">Foydalanuvchi nomi</label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="masalan: admin" autoComplete="username" required />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Parol</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" loading={loading}><LogIn size={16} /> Kirish</Button>
          </form>

          <div className="mt-6 rounded-lg border border-line bg-subtle p-3">
            <p className="mb-2 text-xs font-semibold text-muted">Demo hisoblar (bosing):</p>
            <div className="grid grid-cols-2 gap-1.5">
              {demos.map((d) => (
                <button key={d.username} onClick={() => { setUsername(d.username); setPassword(d.pass); }}
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-left text-[11px] hover:border-primary">
                  <span className="block font-semibold text-content">{d.role}</span>
                  <span className="text-faint">{d.username} / {d.pass}</span>
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
