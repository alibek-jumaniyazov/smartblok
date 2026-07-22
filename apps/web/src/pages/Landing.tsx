import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../components/LangContext';
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  BankOutlined,
  BarChartOutlined,
  CarOutlined,
  CloseOutlined,
  ContainerOutlined,
  CrownOutlined,
  DollarOutlined,
  FileSearchOutlined,
  GiftOutlined,
  IdcardOutlined,
  InstagramOutlined,
  LockOutlined,
  MailOutlined,
  MenuOutlined,
  PhoneOutlined,
  SendOutlined,
  SafetyOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  SwapOutlined,
  SyncOutlined,
  TeamOutlined,
  ThunderboltFilled,
  UnorderedListOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import './landing.css';

const BRAND = 'SmartBlok';

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── data ─────────────────────────────────────────────────────────────────────
const MODULES: { ic: ReactNode; title: string; desc: string }[] = [
  { ic: <ShoppingCartOutlined />, title: 'Buyurtmalar', desc: "Buyurtma yaratilgan payti yakunlanadi — qarz, tannarx va bonus o'sha zahoti yoziladi. To'langan va to'lanmaganlar alohida tab." },
  { ic: <TeamOutlined />, title: 'Mijozlar', desc: 'Balans, kredit limiti, akt-sverka va to‘lov tarixi — bitta kartada.' },
  { ic: <IdcardOutlined />, title: 'Agentlar', desc: 'Sotuvchilar, qarz limiti, oylik reyting va sof foyda hisobi.' },
  { ic: <DollarOutlined />, title: "To‘lovlar", desc: 'Kirim/chiqim reestri, avanslarni buyurtmalarga taqsimlash.' },
  { ic: <WalletOutlined />, title: 'Qarzlar', desc: 'Kim kimga qarzdor — eng muddati o‘tganidan boshlab yig‘ish.' },
  { ic: <BankOutlined />, title: 'Kassa', desc: 'Naqd, bank, Click, terminal — har bir kassaning jonli balansi.' },
  { ic: <ShopOutlined />, title: 'Zavodlar', desc: 'Yetkazib beruvchilar bilan hisob-kitob va tannarx nazorati.' },
  { ic: <AppstoreOutlined />, title: 'Mahsulotlar', desc: 'Narx darajalari (naqd/o‘tkazma/sotuv) va zavod tannarxi.' },
  { ic: <GiftOutlined />, title: 'Bonus hamyonlar', desc: 'Zavod bonuslari hisobi, yechish va qarzdan yopish.' },
  { ic: <ContainerOutlined />, title: 'Paddonlar', desc: 'Mijoz va zavoddagi paddon qoldig‘i, qaytarish jurnali.' },
  { ic: <CarOutlined />, title: 'Moshinalar', desc: 'Transport, sig‘im, shofyor qarzi va yo‘nalishlar.' },
  { ic: <BarChartOutlined />, title: 'Trend va hisobot', desc: 'Savdo, tushum va foyda trendlari — Toshkent taqvimi bo‘yicha.' },
];

const NODES: { ic: ReactNode; label: string; sub: string; c: string }[] = [
  { ic: <ShopOutlined />, label: 'Zavod', sub: 'Yetkazib beruvchi', c: '#7c3aed' },
  { ic: <CrownOutlined />, label: 'Diller', sub: 'Siz — markaz', c: '#2563eb' },
  { ic: <TeamOutlined />, label: 'Agent', sub: 'Sotuvchi', c: '#0891b2' },
  { ic: <UserOutlined />, label: 'Mijoz', sub: 'Xaridor', c: '#16a34a' },
];

const LEVELS: { n: number; c: string; title: string; desc: string }[] = [
  { n: 1, c: '#16a34a', title: 'Mijoz qarzi', desc: 'Mijoz sotuv narxida qarzdor. Bir mijozning avansi boshqasining qarzini yopmaydi.' },
  { n: 2, c: '#7c3aed', title: 'Zavodga qarz', desc: 'Diller zavod narxida qarzdor — real chiqqan hajm bo‘yicha aniqlanadi.' },
  { n: 3, c: '#d97706', title: 'Transport', desc: 'Shofyor xizmati alohida track — savdo zanjiriga aralashmaydi.' },
];

const WORKFLOW: { label: string; c: string }[] = [
  { label: 'Yangi', c: '#64748b' },
  { label: 'Tasdiqlangan', c: '#2563eb' },
  { label: 'Yuklanmoqda', c: '#9a6700' },
  { label: 'Yetkazilmoqda', c: '#c2410c' },
  { label: 'Yetkazildi', c: '#0d9488' },
  { label: 'Yakunlandi', c: '#16a34a' },
];

const ROLES: { ic: ReactNode; name: string; desc: string }[] = [
  { ic: <CrownOutlined />, name: 'Administrator', desc: 'To‘liq nazorat: sozlamalar, foydalanuvchilar, barcha modullar.' },
  { ic: <BankOutlined />, name: 'Buxgalter', desc: 'Moliya, qarzlar, kassa va zavodlar bilan hisob-kitob.' },
  { ic: <TeamOutlined />, name: 'Agent', desc: 'O‘z mijozlari, buyurtmalari va qarz limiti — telefonga moslashgan.' },
  { ic: <WalletOutlined />, name: 'Kassir', desc: 'Kassa terminali: to‘lov qabul qilish va rasmiylashtirish.' },
];

const SECURITY: { ic: ReactNode; title: string; desc: string }[] = [
  { ic: <LockOutlined />, title: 'Ledger asosida', desc: 'Balans hech qachon saqlanmaydi — har doim yozuvlar yig‘indisidan. O‘zgartirib bo‘lmaydi.' },
  { ic: <FileSearchOutlined />, title: 'To‘liq audit', desc: 'Har bir amal kim, qachon, nima o‘zgartirganini yozib boradi.' },
  { ic: <SafetyOutlined />, title: 'Rollar bo‘yicha kirish', desc: 'Har kim faqat o‘ziga tegishlisini ko‘radi. Agent zavod tannarxini ko‘rmaydi.' },
  { ic: <SwapOutlined />, title: 'Ikki valyuta', desc: 'UZS va USD — kurs bilan, hech qachon aralashtirilmaydi.' },
];

// navbar havolalari — desktop qatorida ham, telefon varag'ida ham shu ro'yxat ishlatiladi
const NAV_LINKS: { id: string; label: string }[] = [
  { id: 'modules', label: 'Modullar' },
  { id: 'chain', label: 'Qarz zanjiri' },
  { id: 'workflow', label: 'Ish jarayoni' },
  { id: 'security', label: 'Xavfsizlik' },
];

const STATS: { n: number; suffix: string; label: string }[] = [
  { n: 12, suffix: '', label: 'Modul' },
  { n: 4, suffix: '', label: 'Rol' },
  { n: 6, suffix: '', label: 'Status' },
  { n: 2, suffix: '', label: 'Valyuta' },
];

// ── count-up ──────────────────────────────────────────────────────────────────
function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [val, setVal] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReduced()) { setVal(to); return; }
    let raf = 0;
    let started = false;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !started) {
          started = true;
          const dur = 1100;
          const t0 = performance.now();
          const tick = (now: number) => {
            const p = Math.min(1, (now - t0) / dur);
            const eased = 1 - Math.pow(1 - p, 3);
            setVal(Math.round(eased * to));
            if (p < 1) raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to]);
  return <span ref={ref} className="lp-stat__num">{val}{suffix}</span>;
}

// ── mini area sparkline (light) ──────────────────────────────────────────────
function MiniSpark({ data, color }: { data: number[]; color: string }) {
  const W = 120, H = 30, P = 2;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const pts = data.map((d, i) => {
    const x = P + (i / (data.length - 1)) * (W - P * 2);
    const y = P + (1 - (d - min) / range) * (H - P * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W - P} ${H - P} L${P} ${H - P} Z`;
  const id = `ms${color.replace('#', '')}`;
  return (
    <svg className="lp-kpi__spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.22" /><stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── demo chart (light) ────────────────────────────────────────────────────────
function DemoChart() {
  const W = 440, H = 120, P = 6;
  const inc = [38, 41, 36, 52, 48, 60, 57, 69, 64, 78, 72, 88];
  const exp = [22, 24, 20, 28, 26, 31, 29, 34, 30, 38, 33, 41];
  const max = 100;
  const pts = (arr: number[]) => arr.map((val2, i) => {
    const x = P + (i / (arr.length - 1)) * (W - P * 2);
    const y = H - P - (val2 / max) * (H - P * 2);
    return [x, y] as const;
  });
  const line = (p: readonly (readonly [number, number])[]) => p.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = (p: readonly (readonly [number, number])[]) => `${line(p)} L${W - P} ${H - P} L${P} ${H - P} Z`;
  const pi = pts(inc), pe = pts(exp);
  return (
    <svg className="lp-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="lpInc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity="0.34" /><stop offset="100%" stopColor="#3b82f6" stopOpacity="0" /></linearGradient>
        <linearGradient id="lpExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity="0.22" /><stop offset="100%" stopColor="#34d399" stopOpacity="0" /></linearGradient>
      </defs>
      <path d={area(pi)} fill="url(#lpInc)" />
      <path d={line(pi)} fill="none" stroke="#3b82f6" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={area(pe)} fill="url(#lpExp)" />
      <path d={line(pe)} fill="none" stroke="#34d399" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export default function Landing() {
  const navigate = useNavigate();
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  // telefon navigatsiyasi: havolalar burger orqali ochiladigan varaqqa yig'iladi
  const [menuOpen, setMenuOpen] = useState(false);
  const login = () => navigate('/login');

  // custom magnetic cursor (dot + lagging ring) — pointer devices only
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const root = rootRef.current, dot = dotRef.current, ring = ringRef.current;
    if (!fine || prefersReduced() || !root || !dot || !ring) return;
    root.classList.add('lp-cursor-on');
    let mx = window.innerWidth / 2, my = window.innerHeight / 2, rx = mx, ry = my, raf = 0;
    const onMove = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = `translate3d(${mx}px, ${my}px, 0) translate(-50%, -50%)`;
      const t = e.target;
      const hov = t instanceof Element && t.closest('button, a, .lp-card, .lp-node, .lp-role, .lp-sec__item, .lp-stat');
      ring.classList.toggle('is-hover', !!hov);
    };
    const onDown = () => ring.classList.add('is-down');
    const onUp = () => ring.classList.remove('is-down');
    const loop = () => {
      rx += (mx - rx) * 0.18; ry += (my - ry) * 0.18;
      ring.style.transform = `translate3d(${rx.toFixed(1)}px, ${ry.toFixed(1)}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    return () => {
      root.classList.remove('lp-cursor-on');
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // hero mockup cursor-tilt
  const onHeroMove = useCallback((e: React.MouseEvent) => {
    const el = tiltRef.current;
    if (!el || prefersReduced()) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
    const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
    el.style.setProperty('--ty', `${clamp(dx * 9, -6, 6).toFixed(2)}deg`);
    el.style.setProperty('--tx', `${clamp(-dy * 9, -6, 6).toFixed(2)}deg`);
  }, []);
  const onHeroLeave = useCallback(() => {
    const el = tiltRef.current;
    if (el) { el.style.setProperty('--tx', '0deg'); el.style.setProperty('--ty', '0deg'); }
  }, []);

  // magnetic buttons + card spotlight
  const magOn = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (prefersReduced()) return;
    const el = e.currentTarget, r = el.getBoundingClientRect();
    el.style.transform = `translate(${((e.clientX - r.left - r.width / 2) * 0.2).toFixed(1)}px, ${((e.clientY - r.top - r.height / 2) * 0.35).toFixed(1)}px)`;
  }, []);
  const magOff = useCallback((e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.transform = ''; }, []);
  const onCard = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget, r = el.getBoundingClientRect();
    el.style.setProperty('--cx', `${e.clientX - r.left}px`);
    el.style.setProperty('--cy', `${e.clientY - r.top}px`);
  }, []);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const sc = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        rootRef.current?.style.setProperty('--lp-scroll', max > 0 ? (sc / max).toFixed(3) : '0');
        setScrolled(sc > 24);
        raf = 0;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (prefersReduced()) {
      root.querySelectorAll('.lp-reveal').forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
      }),
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    root.querySelectorAll('.lp-reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const go = (id: string) => () => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' });
  };

  // Esc menyuni yopadi — har bir to'liq ekranli sirtda ko'rinadigan chiqish yo'li bo'lishi kerak
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const scrollTop = useCallback(() => window.scrollTo({ top: 0, behavior: prefersReduced() ? 'auto' : 'smooth' }), []);

  const Mark = (
    <span className="lp-logo__mark">
      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="13" width="11" height="7" rx="2" fill="#fff" opacity="0.55" />
        <rect x="10" y="8.5" width="11" height="7" rx="2" fill="#fff" opacity="0.82" />
        <rect x="6.5" y="4" width="11" height="7" rx="2" fill="#fff" />
      </svg>
    </span>
  );

  return (
    <div className="lp" ref={rootRef}>
      <div className="lp-progress" />
      <div className="lp-cursor lp-cursor--dot" ref={dotRef} aria-hidden />
      <div className="lp-cursor lp-cursor--ring" ref={ringRef} aria-hidden />
      <div className="lp-bgwrap" aria-hidden>
        <span className="lp-wash" />
        <span className="lp-orb lp-orb--1" />
        <span className="lp-orb lp-orb--2" />
        <span className="lp-orb lp-orb--3" />
        <span className="lp-dots" />
      </div>

      {/* Navbar */}
      <header className={`lp-nav${scrolled ? ' lp-nav--scrolled' : ''}`}>
        <div className="lp-container lp-nav__inner">
          <button className="lp-logo" onClick={scrollTop}>{Mark}<span className="lp-logo__name">{BRAND}</span></button>
          <nav className="lp-nav__links">
            {NAV_LINKS.map((l) => (
              <button className="lp-nav__link" key={l.id} onClick={go(l.id)}>{t(l.label)}</button>
            ))}
          </nav>
          <div className="lp-nav__actions">
            <button className="lp-btn lp-btn--primary lp-btn--sm" onClick={login}>{t('Kirish')} <ArrowRightOutlined /></button>
            {/* burger faqat telefonda ko'rinadi (landing.css) — havolalar yo'qolib qolmasin */}
            <button
              className="lp-nav__burger"
              type="button"
              aria-label={t('Menyu')}
              aria-expanded={menuOpen}
              aria-controls="lp-nav-sheet"
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <CloseOutlined /> : <MenuOutlined />}
            </button>
          </div>
        </div>
        <div className={`lp-nav__sheet${menuOpen ? ' is-open' : ''}`} id="lp-nav-sheet">
          <div className="lp-container">
            {NAV_LINKS.map((l) => (
              <button className="lp-nav__sheetlink" key={l.id} onClick={go(l.id)}>{t(l.label)}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="lp-main" id="top">
        {/* Hero */}
        <section className="lp-hero" onMouseMove={onHeroMove} onMouseLeave={onHeroLeave}>
          <div className="lp-container">
            <div className="lp-hero__inner">
              <span className="lp-badge lp-reveal"><span className="lp-badge__dot" /> {t('Gazoblok diller uchun ERP')}</span>
              <h1 className="lp-hero__title lp-reveal" data-delay="1">
                {t('Gazoblok savdosini')}<br />
                <span className="lp-grad-text">{t('bitta tizimda boshqaring')}</span>
              </h1>
              <p className="lp-hero__sub lp-reveal" data-delay="2">
                {t('Buyurtmadan to‘lovgacha bo‘lgan butun zanjir — savdo, qarz, kassa va yetkazib berish. Har bir so‘m aniq, har bir raqam bosiladigan eshik.')}
              </p>
              <div className="lp-hero__cta lp-reveal" data-delay="3">
                <button className="lp-btn lp-btn--primary lp-btn--lg" onClick={login} onMouseMove={magOn} onMouseLeave={magOff}>{t('Tizimga kirish')} <ArrowRightOutlined /></button>
                <button className="lp-btn lp-btn--ghost lp-btn--lg" onClick={go('modules')}><UnorderedListOutlined /> {t('Modullarni ko‘rish')}</button>
              </div>
              <div className="lp-hero__trust lp-reveal" data-delay="4">
                <span><WalletOutlined /> {t('Qarz zanjiri')}</span>
                <span><SwapOutlined /> UZS · USD</span>
                <span><SafetyOutlined /> {t('Rollar bo‘yicha')}</span>
                <span><SyncOutlined /> {t('Real vaqt')}</span>
              </div>
            </div>

            {/* product mockup */}
            <div className="lp-shot-wrap lp-reveal" data-delay="2">
              <span className="lp-shot-glow" aria-hidden />
              <div className="lp-shot-tilt" ref={tiltRef}>
              <div className="lp-shot">
                <div className="lp-shot__bar">
                  <span className="lp-shot__dots"><i style={{ background: '#f87171' }} /><i style={{ background: '#fbbf24' }} /><i style={{ background: '#34d399' }} /></span>
                  <span className="lp-shot__title">{t('Ish stoli — SmartBlok')}</span>
                  <span className="lp-shot__tag">{t('Demo')}</span>
                </div>
                <div className="lp-shot__body">
                  <div className="lp-shot__kpis">
                    {[
                      { l: 'Oy savdosi', v: '625.7M', d: '+12.4%', up: true, spark: [30, 34, 31, 40, 44, 52, 60], c: '#3b82f6' },
                      { l: 'Yig‘ilgan to‘lov', v: '791.9M', d: '+17.0%', up: true, spark: [20, 28, 26, 38, 44, 58, 70], c: '#34d399' },
                      { l: 'Mijozlar qarzi', v: '229.1M', d: '−3.2%', up: true, spark: null, c: '#2563eb' },
                      { l: 'Kassa balansi', v: '81.9M', d: '+5.1%', up: true, spark: null, c: '#2563eb' },
                    ].map((k) => (
                      <div className="lp-kpi" key={k.l}>
                        <div className="lp-kpi__label">{t(k.l)}</div>
                        <div className="lp-kpi__val">{k.v}</div>
                        <div className={`lp-kpi__delta ${k.up ? 'lp-up' : 'lp-down'}`}>{k.d}</div>
                        {k.spark ? <MiniSpark data={k.spark} color={k.c} /> : null}
                      </div>
                    ))}
                  </div>
                  <div className="lp-shot__row">
                    <div className="lp-panel">
                      <div className="lp-panel__h">
                        <span>{t('Savdo va tushum')}</span>
                        <span style={{ display: 'flex', gap: 12 }}>
                          <span style={{ color: '#3b82f6' }}>{t('● Savdo')}</span>
                          <span style={{ color: '#34d399' }}>{t('● Tushum')}</span>
                        </span>
                      </div>
                      <DemoChart />
                    </div>
                    <div className="lp-panel">
                      {/* Status doskasi 2026-07-22 da mahsulotdan olib tashlandi (buyurtma
                          yaratilganda yakunlanadi) — bu panel endi haqiqatda bor narsani,
                          «Buyurtmalar» sahifasining to'lov holati bo'linishini ko'rsatadi. */}
                      <div className="lp-panel__h"><span>{t("Buyurtmalar — to'lov holati")}</span></div>
                      <div className="lp-bars">
                        {[
                          { s: "To'langan", c: '#16a34a', n: 12, w: 0.92 },
                          { s: "Qisman to'langan", c: '#9a6700', n: 5, w: 0.42 },
                          { s: "To'lanmagan", c: '#c2410c', n: 8, w: 0.64 },
                        ].map((b) => (
                          <div className="lp-barrow" key={b.s}>
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(b.s)}</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="lp-bartrack">
                                <span className="lp-barfill" style={{ width: `${b.w * 100}%`, background: `linear-gradient(90deg, ${b.c}99, ${b.c})` }} />
                              </span>
                              <b style={{ color: 'var(--lp-ink-2)', fontVariantNumeric: 'tabular-nums', minWidth: 14, textAlign: 'right' }}>{b.n}</b>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="lp-section" style={{ paddingTop: 8 }}>
          <div className="lp-container">
            <div className="lp-stats lp-reveal">
              {STATS.map((s) => (
                <div className="lp-stat" key={s.label}>
                  <Counter to={s.n} suffix={s.suffix} />
                  <div className="lp-stat__label">{t(s.label)}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Modules */}
        <section className="lp-section lp-center" id="modules">
          <div className="lp-container">
            <span className="lp-eyebrow lp-reveal">{t('Modullar')}</span>
            <h2 className="lp-h2 lp-reveal" data-delay="1">{t('Kerakli hamma narsa — ortiqchasiz')}</h2>
            <p className="lp-lead lp-reveal" data-delay="2">{t('Gazoblok biznesining har bir bo‘limi bitta tizimda. Soxta modul yo‘q — faqat kunlik ishga keragi.')}</p>
            <div className="lp-grid-cards" style={{ marginTop: 44, textAlign: 'left' }}>
              {MODULES.map((m, i) => (
                <article key={m.title} className="lp-card lp-module lp-reveal" data-delay={String((i % 4) + 1)} onMouseMove={onCard}>
                  <div className="lp-module__icon">{m.ic}</div>
                  <h3 className="lp-module__title">{t(m.title)}</h3>
                  <p className="lp-module__desc">{t(m.desc)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Chain */}
        <section className="lp-section lp-center" id="chain" style={{ background: 'var(--lp-bg-tint)' }}>
          <div className="lp-container">
            <span className="lp-eyebrow lp-reveal">{t('Asosiy farq')}</span>
            <h2 className="lp-h2 lp-reveal" data-delay="1">{t('Qarz zanjiri — har doim aniq qoldiq')}</h2>
            <p className="lp-lead lp-reveal" data-delay="2">{BRAND} {t('markazida uch tomonlama qarz hisobi turadi. Kim kimga, qancha qarzdor — hech qachon chalkashmaydi.')}</p>

            <div className="lp-chain__flow lp-reveal" data-delay="2" style={{ marginTop: 44 }}>
              {NODES.map((n, i) => (
                <div key={n.label} style={{ display: 'contents' }}>
                  <div className="lp-node">
                    <div className="lp-node__icon" style={{ background: `${n.c}1a`, border: `1px solid ${n.c}40`, color: n.c }}>{n.ic}</div>
                    <div className="lp-node__label">{t(n.label)}</div>
                    <div className="lp-node__sub">{t(n.sub)}</div>
                  </div>
                  {i < NODES.length - 1 && (
                    <div className="lp-arrow" aria-hidden>
                      <svg viewBox="0 0 56 22" preserveAspectRatio="none">
                        <defs><linearGradient id="lpflow" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#38bdf8" /><stop offset="100%" stopColor="#2563eb" /></linearGradient></defs>
                        <path className="lp-arrow__dash" d="M2 11 H54" />
                        <path d="M48 5 L54 11 L48 17" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="lp-levels" style={{ textAlign: 'left' }}>
              {LEVELS.map((l, i) => (
                <div className="lp-level lp-reveal" data-delay={String(i + 1)} key={l.n}>
                  <span className="lp-level__tag" style={{ background: `${l.c}14`, color: l.c, border: `1px solid ${l.c}3a` }}>{l.n}-{t('daraja')}</span>
                  <h4 className="lp-level__title">{t(l.title)}</h4>
                  <p className="lp-level__desc">{t(l.desc)}</p>
                </div>
              ))}
            </div>

            <div className="lp-chain__note lp-reveal" style={{ textAlign: 'left' }}>
              <ThunderboltFilled />
              <span>{t('Buyurtma real hajm bilan zavoddan chiqqanda, uch daraja ham avtomatik qayta hisoblanadi — qo‘lda tuzatish shart emas.')}</span>
            </div>
          </div>
        </section>

        {/* Workflow */}
        <section className="lp-section lp-center" id="workflow">
          <div className="lp-container">
            <span className="lp-eyebrow lp-reveal">{t('Ish jarayoni')}</span>
            <h2 className="lp-h2 lp-reveal" data-delay="1">{t('Buyurtma yo‘li — boshidan oxirigacha')}</h2>
            <p className="lp-lead lp-reveal" data-delay="2">{t('Har bir buyurtma aniq bosqichlardan o‘tadi. Doskada qaysi buyurtma qayerdaligi bir qarashda ko‘rinadi.')}</p>
            <div className="lp-flow" style={{ marginTop: 44, textAlign: 'left' }}>
              {WORKFLOW.map((s, i) => (
                <div className="lp-step lp-reveal" data-delay={String(i + 1)} key={s.label}>
                  <div className="lp-step__n" style={{ background: s.c }}>{i + 1}</div>
                  <div className="lp-step__dot" style={{ background: s.c, boxShadow: `0 0 8px ${s.c}` }} />
                  <div className="lp-step__label">{t(s.label)}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Roles */}
        <section className="lp-section lp-center" style={{ background: 'var(--lp-bg-tint)' }}>
          <div className="lp-container">
            <span className="lp-eyebrow lp-reveal">{t('Rollar')}</span>
            <h2 className="lp-h2 lp-reveal" data-delay="1">{t('Har kim o‘z ishida')}</h2>
            <p className="lp-lead lp-reveal" data-delay="2">{t('To‘rt rol — har biri o‘ziga kerakli ko‘rinish va ruxsat bilan. Ortiqcha narsa ko‘rinmaydi.')}</p>
            <div className="lp-roles" style={{ marginTop: 44, textAlign: 'left' }}>
              {ROLES.map((r, i) => (
                <div className="lp-role lp-reveal" data-delay={String((i % 4) + 1)} key={r.name}>
                  <span className="lp-role__badge">{r.ic}</span>
                  <div>
                    <div className="lp-role__name">{t(r.name)}</div>
                    <div className="lp-role__desc">{t(r.desc)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Security */}
        <section className="lp-section" id="security">
          <div className="lp-container lp-split">
            <div className="lp-reveal">
              <span className="lp-eyebrow">{t('Ishonch va xavfsizlik')}</span>
              <h2 className="lp-h2">{t('Har bir so‘m — hisobdor')}</h2>
              <p className="lp-lead">{t('Pul harakati o‘chirilmaydigan ledgerga yoziladi, balans esa doim yozuvlardan hisoblanadi. Ishonchli, tekshiriladigan, adashmaydigan.')}</p>
              <div className="lp-hero__cta" style={{ justifyContent: 'flex-start', marginTop: 26 }}>
                <button className="lp-btn lp-btn--primary" onClick={login}>{t('Tizimga kirish')} <ArrowRightOutlined /></button>
              </div>
            </div>
            <div className="lp-sec-list">
              {SECURITY.map((s, i) => (
                <div className="lp-sec__item lp-reveal" data-delay={String((i % 4) + 1)} key={s.title}>
                  <span className="lp-sec__ic">{s.ic}</span>
                  <div>
                    <div className="lp-sec__title">{t(s.title)}</div>
                    <div className="lp-sec__desc">{t(s.desc)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="lp-section" style={{ paddingTop: 0 }}>
          <div className="lp-container">
            <div className="lp-cta-band lp-reveal">
              <h2 className="lp-cta-band__title">{t('Gazoblok biznesingizni tartibga soling')}</h2>
              <p className="lp-cta-band__sub">{t('Bugundan boshlab har bir buyurtma, to‘lov va qarz — bitta tizimda, aniq va nazorat ostida.')}</p>
              <button className="lp-btn lp-btn--lg lp-btn--onblue" onClick={login} onMouseMove={magOn} onMouseLeave={magOff}>{t('Tizimga kirish')} <ArrowRightOutlined /></button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer__top">
            <div>
              <div className="lp-logo">{Mark}<span className="lp-logo__name">{BRAND}</span></div>
              <p className="lp-footer__tag">{t('Gazoblok dillerlari uchun to‘liq ERP — savdo, qarz, kassa va yetkazib berish bitta joyda.')}</p>
            </div>
            <div className="lp-footer__cols">
              <div>
                <div className="lp-footer__coltitle">{t('Mahsulot')}</div>
                <button className="lp-footer__link" onClick={go('modules')}>{t('Modullar')}</button>
                <button className="lp-footer__link" onClick={go('chain')}>{t('Qarz zanjiri')}</button>
                <button className="lp-footer__link" onClick={go('workflow')}>{t('Ish jarayoni')}</button>
                <button className="lp-footer__link" onClick={go('security')}>{t('Xavfsizlik')}</button>
              </div>
              <div>
                <div className="lp-footer__coltitle">{t('Kirish')}</div>
                <button className="lp-footer__link" onClick={login}>{t('Tizimga kirish')}</button>
              </div>
              <div>
                <div className="lp-footer__coltitle">{t('Aloqa')}</div>
                <a className="lp-footer__link" href="https://t.me/avilab_uz" target="_blank" rel="noopener noreferrer"><SendOutlined /> Telegram</a>
                <a className="lp-footer__link" href="tel:+998958500880" rel="noopener noreferrer"><PhoneOutlined /> +998 95 850 08 80</a>
                <a className="lp-footer__link" href="mailto:avilab.com@gmail.com" rel="noopener noreferrer"><MailOutlined /> avilab.com@gmail.com</a>
                <a className="lp-footer__link" href="https://www.instagram.com/avilab.uz" target="_blank" rel="noopener noreferrer"><InstagramOutlined /> Instagram</a>
              </div>
            </div>
          </div>
          <div className="lp-footer__bottom">
            <span>© {new Date().getFullYear()} {BRAND} · {t('Gazoblok diller tizimi')}</span>
            <span>
              {t('Ishlab chiquvchi')}:{' '}
              <a className="lp-footer__credit" href="https://avilab.uz" target="_blank" rel="noopener noreferrer">AviLab</a>
              {' '}· {MODULES.length} {t('modul')} · UZS/USD
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
