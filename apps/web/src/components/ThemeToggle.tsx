import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { motion } from 'framer-motion';

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('sb_theme', dark ? 'dark' : 'light');
  }, [dark]);
  return (
    <button
      onClick={() => setDark((d) => !d)}
      className="rounded-md p-2 text-muted hover:bg-hover hover:text-content"
      aria-label="Rejim"
    >
      <motion.span key={dark ? 'd' : 'l'} initial={{ rotate: -30, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} className="block">
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </motion.span>
    </button>
  );
}
