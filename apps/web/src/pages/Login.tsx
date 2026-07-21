import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, App, Button, ConfigProvider, Form, Input } from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckCircleFilled,
  EyeInvisibleOutlined,
  EyeTwoTone,
  LockOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAuth } from '../auth/AuthContext';
import { apiError } from '../lib/api';
import { useIsPhone } from '../lib/responsive';
import { darkTheme } from '../theme';
import { useT } from '../components/LangContext';
import { LangSwitcher } from '../components/LangSwitcher';

interface LoginForm {
  username: string;
  password: string;
}

// O'zbek lotin manba matnlari (i18n kalitlari) — render'da t() bilan tarjima qilinadi.
const FEATURES = [
  'Buyurtma → zavod → yetkazish → to‘lov — bitta zanjirda',
  'Mijoz, agent va zavod qarzlari — har doim aniq qoldiq',
  'Kassa, bank va bonus hamyonlar — jonli balans',
  'Rollar bo‘yicha kirish · to‘liq audit · real vaqtli yangilanish',
];

/** SmartBlok wordmark glyph — three stacked aerated-concrete blocks. */
function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <rect x="3" y="13" width="11" height="7" rx="2" fill="#fff" opacity="0.55" />
      <rect x="10" y="8.5" width="11" height="7" rx="2" fill="#fff" opacity="0.82" />
      <rect x="6.5" y="4" width="11" height="7" rx="2" fill="#fff" />
    </svg>
  );
}

export default function Login() {
  const { login, loading, token: authToken } = useAuth();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const t = useT();
  const isPhone = useIsPhone();
  const [form] = Form.useForm<LoginForm>();
  const [error, setError] = useState<string | null>(null);
  const [capsOn, setCapsOn] = useState(false);
  const pwRef = useRef<import('antd').InputRef>(null);

  // already authenticated → straight to the dashboard
  useEffect(() => {
    if (authToken) navigate('/app', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  const onFinish = async (values: LoginForm) => {
    setError(null);
    try {
      await login(values.username.trim(), values.password);
      navigate('/app', { replace: true });
    } catch (err) {
      const msg = apiError(err);
      setError(msg);
      message.error(msg);
      pwRef.current?.focus();
    }
  };

  const onCaps = (e: React.KeyboardEvent) => {
    const on = e.getModifierState?.('CapsLock');
    if (typeof on === 'boolean') setCapsOn(on);
  };

  const labelStyle = { color: '#c7d3e6', fontWeight: 600, fontSize: 13.5 } as const;
  const inputStyle = { borderRadius: 12, height: 52 } as const;

  return (
    <ConfigProvider theme={darkTheme}>
      {/* telefonda sahifa va karta paddinglari qisqaradi — 320px'da ham matn siqilmasin */}
      <div className="sb-login" style={isPhone ? { padding: '20px 12px' } : undefined}>
        {/* seamless sahifa-darajasidagi suzuvchi glow orblar */}
        <span className="sb-login__glow sb-login__glow--1" aria-hidden />
        <span className="sb-login__glow sb-login__glow--2" aria-hidden />
        <span className="sb-login__glow sb-login__glow--3" aria-hidden />

        <div className="sb-login__wrap">
          {/* ── Left: brand ─────────────────────────────────────────── */}
          <aside className="sb-login__brand sb-login__in sb-login__in--1">
            <div className="sb-login__brand-inner">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 40 }}>
                <span
                  className="sb-login__logo"
                  style={{
                    width: 56, height: 56, borderRadius: 16, display: 'grid', placeItems: 'center',
                    background: 'linear-gradient(135deg, #38bdf8, #2563eb)',
                    boxShadow: '0 12px 30px -6px rgba(37,99,235,0.6)',
                  }}
                >
                  <LogoMark size={28} />
                </span>
                <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' }}>SmartBlok</span>
              </div>

              <h1 style={{ fontSize: 'clamp(30px, 3.4vw, 42px)', fontWeight: 800, letterSpacing: '-1.2px', lineHeight: 1.12, margin: '0 0 18px' }}>
                {t('Gazoblok biznesini')}<br />
                <span className="sb-login__grad">{t('bitta oynadan boshqaring')}</span>
              </h1>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16.5, lineHeight: 1.6, margin: '0 0 38px', maxWidth: 420 }}>
                {t('Savdo, qarz, kassa va yetkazib berish — barchasi bir joyda, aniq va real vaqtda.')}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {FEATURES.map((f) => (
                  <div key={f} className="sb-login__feat" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <CheckCircleFilled style={{ color: '#7cc0ff', fontSize: 19, marginTop: 1, flex: '0 0 auto' }} />
                    <span style={{ color: 'rgba(255,255,255,0.82)', fontSize: 15, lineHeight: 1.5 }}>{t(f)}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          {/* ── Right: form card ────────────────────────────────────── */}
          <main className="sb-login__form">
            <span className="sb-login__card-glow" aria-hidden />
            <div className="sb-login__form-inner sb-login__in sb-login__in--2" style={isPhone ? { padding: 20 } : undefined}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  flexWrap: 'wrap', gap: 10, marginBottom: isPhone ? 20 : 26,
                }}
              >
                <Link to="/" className="sb-demo-chip" style={{ textDecoration: 'none', minHeight: isPhone ? 44 : undefined }}>
                  <ArrowLeftOutlined /> {t('Bosh sahifa')}
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <LangSwitcher dark placement="bottomRight" />
                  <span
                    className="sb-login__mobile-logo"
                    style={{
                      width: 46, height: 46, borderRadius: 13,
                      background: 'linear-gradient(135deg, #38bdf8, #2563eb)',
                      boxShadow: '0 10px 24px -6px rgba(37,99,235,0.6)',
                    }}
                  >
                    <LogoMark size={23} />
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: isPhone ? 20 : 28 }}>
                <h2 style={{ color: '#f4f8fe', fontWeight: 800, fontSize: isPhone ? 23 : 28, letterSpacing: '-0.6px', margin: '0 0 7px' }}>
                  {t('Tizimga kirish')}
                </h2>
                <p style={{ color: 'rgba(234,240,249,0.6)', fontSize: isPhone ? 14 : 15, margin: 0 }}>
                  {t('Davom etish uchun login va parolingizni kiriting')}
                </p>
              </div>

              {error ? (
                <Alert type="error" showIcon closable message={error} onClose={() => setError(null)} style={{ borderRadius: 12, marginBottom: 18 }} />
              ) : null}

              <Form<LoginForm> form={form} layout="vertical" size="large" requiredMark={false} onFinish={onFinish}>
                <Form.Item name="username" label={<span style={labelStyle}>{t('Login')}</span>} rules={[{ required: true, message: t('Loginni kiriting') }]}>
                  {/* R15 — telefonda autoFocus iOS klaviaturasini ko'taradi va tugmani yopadi */}
                  <Input prefix={<UserOutlined style={{ color: '#8ea3c2' }} />} autoComplete="username" autoFocus={!isPhone} style={inputStyle} />
                </Form.Item>

                <Form.Item
                  name="password"
                  label={<span style={labelStyle}>{t('Parol')}</span>}
                  rules={[{ required: true, message: t('Parolni kiriting') }]}
                  style={{ marginBottom: capsOn ? 4 : undefined }}
                >
                  <Input.Password
                    ref={pwRef}
                    prefix={<LockOutlined style={{ color: '#8ea3c2' }} />}
                    autoComplete="current-password"
                    onKeyUp={onCaps}
                    onKeyDown={onCaps}
                    iconRender={(v) => (v ? <EyeTwoTone twoToneColor="#3b82f6" /> : <EyeInvisibleOutlined />)}
                    style={inputStyle}
                  />
                </Form.Item>

                {capsOn ? (
                  <div style={{ color: '#fbbf24', fontSize: 12.5, marginBottom: 14, fontWeight: 500 }}>{t('⚠ Caps Lock yoqilgan')}</div>
                ) : null}

                <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
                  <Button
                    type="primary"
                    htmlType="submit"
                    block
                    loading={loading}
                    iconPosition="end"
                    icon={<ArrowRightOutlined />}
                    style={{
                      height: 54, borderRadius: 12, fontSize: 15.5, fontWeight: 700, border: 'none',
                      background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                      boxShadow: '0 12px 28px -6px rgba(37,99,235,0.55)',
                    }}
                  >
                    {t('Kirish')}
                  </Button>
                </Form.Item>
              </Form>

              <div style={{ marginTop: isPhone ? 22 : 30, color: 'rgba(234,240,249,0.42)', fontSize: 12.5 }}>
                © {new Date().getFullYear()} SmartBlok · {t('Gazoblok diller tizimi')}
              </div>
            </div>
          </main>
        </div>
      </div>
    </ConfigProvider>
  );
}
