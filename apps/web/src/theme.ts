import { theme as antdTheme, type ThemeConfig } from 'antd';

// Brand: restrained steel blue over neutral surfaces — enterprise, not flashy.
const brand = '#2E6584';

export const lightTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: brand,
    colorInfo: brand,
    borderRadius: 6,
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif",
    colorBgLayout: '#f4f5f7',
  },
  components: {
    Layout: { siderBg: '#16222c', triggerBg: '#0f1820' },
    Menu: { darkItemBg: '#16222c', darkSubMenuItemBg: '#0f1820' },
    Table: { headerBg: '#fafafa' },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: '#5b93b3',
    colorInfo: '#5b93b3',
    borderRadius: 6,
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif",
  },
  components: {
    Layout: { siderBg: '#101418', triggerBg: '#0b0e11' },
    Menu: { darkItemBg: '#101418', darkSubMenuItemBg: '#0b0e11' },
  },
};

export type ThemeMode = 'light' | 'dark';

export function initialThemeMode(): ThemeMode {
  const saved = localStorage.getItem('sb_theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
