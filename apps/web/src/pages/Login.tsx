import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Boxes, LogIn } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Input } from '../components/ui/Field';
import { Button } from '../components/ui/Button';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('admin@smartblok.uz');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      nav('/');
    } catch {
      setError('Email yoki parol xato');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-100 p-4 dark:bg-ink-950">
      <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-sky-500/10 blur-3xl" />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-ink-200 bg-white p-8 shadow-xl dark:border-ink-800 dark:bg-ink-900"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-500 text-ink-900">
            <Boxes size={26} />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight">SmartBlok</h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Gazoblok CRM/ERP tizimiga kirish</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Parol" required />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            <LogIn size={16} /> {loading ? 'Kirilmoqda...' : 'Kirish'}
          </Button>
        </form>
        <div className="mt-5 rounded-xl bg-ink-50 p-3 text-xs text-ink-500 dark:bg-ink-950 dark:text-ink-400">
          <p className="font-semibold">Demo kirish:</p>
          <p>admin@smartblok.uz / admin123 (Admin)</p>
          <p>hisob@smartblok.uz / hisob123 (Buxgalter)</p>
          <p>jamol@smartblok.uz / agent123 (Agent)</p>
        </div>
      </motion.div>
    </div>
  );
}
