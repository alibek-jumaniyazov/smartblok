import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import type { Locale } from 'antd/es/locale';
import enUS from 'antd/locale/en_US';
import ruRU from 'antd/locale/ru_RU';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import 'dayjs/locale/en';
import '@fontsource-variable/inter';
import { AuthProvider } from './auth/AuthContext';
import { ThemeCtx } from './components/ThemeContext';
import { LangCtx } from './components/LangContext';
import { darkTheme, initialThemeMode, lightTheme, type ThemeMode } from './theme';
import { dayjsUzLatn, uzLatn } from './lib/uz-latn';
import { dayjsUzCyrl, uzCyrl } from './lib/uz-cyrl';
import { initialLang, makeT, setCurrentLang, type LangCode } from './lib/i18n';
import App from './App';
import './index.css';
import './design.css';

// Register the hand-built o'zbek dayjs locales (latin + cyrillic); ru/en come from
// dayjs' own locale files (imported above). The active one is set per language.
dayjs.locale(dayjsUzLatn);
dayjs.locale(dayjsUzCyrl);

const ANTD_LOCALES: Record<LangCode, Locale> = {
  uz: uzLatn,
  'uz-cyrl': uzCyrl,
  ru: ruRU,
  en: enUS,
};
const DAYJS_NAMES: Record<LangCode, string> = {
  uz: 'uz-latn',
  'uz-cyrl': 'uz-cyrl',
  ru: 'ru',
  en: 'en',
};

// Set the initial dayjs locale (after registering, current would be the last
// registered = uz-cyrl; pin it to the persisted choice).
dayjs.locale(DAYJS_NAMES[initialLang()]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 } },
});

function Root() {
  const [mode, setMode] = useState<ThemeMode>(initialThemeMode);
  const [lang, setLangState] = useState<LangCode>(initialLang);

  // keep the module-global current language in sync so non-hook consumers
  // (lib/status-maps enum getters) resolve the right locale synchronously.
  setCurrentLang(lang);

  const themeCtx = useMemo(
    () => ({
      mode,
      toggle: () =>
        setMode((m) => {
          const next = m === 'dark' ? 'light' : 'dark';
          localStorage.setItem('sb_theme', next);
          return next;
        }),
    }),
    [mode],
  );

  const langCtx = useMemo(
    () => ({
      lang,
      setLang: (l: LangCode) => {
        try {
          localStorage.setItem('sb_lang', l);
        } catch {
          /* storage yo'q */
        }
        setCurrentLang(l);
        setLangState(l);
      },
      t: makeT(lang),
    }),
    [lang],
  );

  // design.css [data-theme] custom properties key off the root element.
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  // reflect the active language on <html lang> + switch the dayjs global locale.
  useEffect(() => {
    document.documentElement.lang = lang === 'uz-cyrl' ? 'uz-Cyrl' : lang;
    dayjs.locale(DAYJS_NAMES[lang]);
  }, [lang]);

  return (
    <ThemeCtx.Provider value={themeCtx}>
      <LangCtx.Provider value={langCtx}>
        <ConfigProvider theme={mode === 'dark' ? darkTheme : lightTheme} locale={ANTD_LOCALES[lang]}>
          <AntApp>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <BrowserRouter>
                  {/* remount the app subtree on language change so every component
                      (incl. status-map label getters) re-reads the new locale.
                      BrowserRouter stays mounted, so the URL is preserved. */}
                  <App key={lang} />
                </BrowserRouter>
              </AuthProvider>
            </QueryClientProvider>
          </AntApp>
        </ConfigProvider>
      </LangCtx.Provider>
    </ThemeCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
