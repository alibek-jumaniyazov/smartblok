import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { AuthProvider } from './auth/AuthContext';
import { ThemeCtx } from './components/ThemeContext';
import { darkTheme, initialThemeMode, lightTheme, type ThemeMode } from './theme';
import App from './App';
import './index.css';

dayjs.locale('ru');

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

  return (
    <ThemeCtx.Provider value={ctx}>
      <ConfigProvider theme={mode === 'dark' ? darkTheme : lightTheme} locale={ruRU}>
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
