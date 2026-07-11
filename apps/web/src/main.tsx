import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import dayjs from 'dayjs';
import '@fontsource-variable/inter';
import { AuthProvider } from './auth/AuthContext';
import { ThemeCtx } from './components/ThemeContext';
import { darkTheme, initialThemeMode, lightTheme, type ThemeMode } from './theme';
import { dayjsUzLatn, uzLatn } from './lib/uz-latn';
import App from './App';
import './index.css';
import './design.css';

// Registers the hand-built uz-latn locale and sets it as the global default.
dayjs.locale(dayjsUzLatn);

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 } },
});

function Root() {
  const [mode, setMode] = useState<ThemeMode>(initialThemeMode);
  const ctx = useMemo(
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

  // design.css [data-theme] custom properties key off the root element.
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  return (
    <ThemeCtx.Provider value={ctx}>
      <ConfigProvider theme={mode === 'dark' ? darkTheme : lightTheme} locale={uzLatn}>
        <AntApp>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </AuthProvider>
          </QueryClientProvider>
        </AntApp>
      </ConfigProvider>
    </ThemeCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
