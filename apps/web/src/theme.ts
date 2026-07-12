// theme.ts — SmartBlok themes. "Azure Bright" identifikatsiyasi: yorug', havodor
// korporativ til + royal-ko'k (#2563EB) brend + osmon aksent (#38BDF8). Semantik
// pul ranglari (yashil=kirim/foyda, qizil=qarz, amber=biz qarzdormiz, orange=
// xarajat) brenddan alohida qoladi. Ranglar design.css dagi --sb-* tokenlar bilan mos.
import { theme as antdTheme, type ThemeConfig } from 'antd';

const font =
  "'Inter Variable', 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif";

const shared = {
  fontFamily: font,
  fontSize: 14,
  fontSizeSM: 13, // tables
  fontSizeHeading3: 20, // page titles
  lineHeight: 1.5715,
  borderRadius: 10,
  borderRadiusLG: 14,
  borderRadiusSM: 8,
  controlHeight: 36,
  controlHeightSM: 28,
  motionDurationFast: '0.12s',
  motionDurationMid: '0.18s',
  motionDurationSlow: '0.24s',
  motionEaseInOut: 'cubic-bezier(0.2, 0, 0, 1)',
};

export const lightTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    ...shared,
    colorPrimary: '#2563EB', colorInfo: '#2563EB', colorLink: '#2563EB',
    colorSuccess: '#16A34A', colorWarning: '#D97706', colorError: '#DC2626',
    colorBgLayout: '#F4F7FB', colorBgContainer: '#FFFFFF',
    colorBorder: '#E6EBF3', colorBorderSecondary: '#EEF2F8',
    colorText: '#0F172A', colorTextSecondary: '#55617A', colorTextTertiary: '#94A3B8',
    colorFillTertiary: '#F4F7FB',
    boxShadow: '0 1px 3px rgba(30,58,138,.06), 0 1px 2px rgba(30,58,138,.04)',
    boxShadowSecondary: '0 10px 30px rgba(30,58,138,.10)',
  },
  components: {
    Layout: { headerBg: '#FFFFFF', headerHeight: 52, bodyBg: '#F4F7FB' },
    Menu: {
      itemBg: 'transparent', itemHeight: 38, itemBorderRadius: 10,
      itemSelectedBg: 'rgba(37,99,235,.10)', itemSelectedColor: '#2563EB',
      itemHoverColor: '#2563EB',
      groupTitleFontSize: 11,
    },
    Table: {
      headerBg: '#F8FAFC', headerColor: '#5B6675',
      cellPaddingBlockSM: 12, cellPaddingInlineSM: 14,
      rowHoverBg: '#F6F8FB', fontSizeSM: 14,
      headerSplitColor: 'transparent',
      borderColor: '#EFF2F6',
    },
    Card:   { borderRadiusLG: 14, paddingLG: 18 },
    Drawer: { paddingLG: 20 },
    Modal:  { borderRadiusLG: 14 },
    Tag:    { borderRadiusSM: 6, defaultBg: '#F4F6FA' },
    Tabs:   { horizontalItemPadding: '10px 12px' },
    Segmented: { itemSelectedBg: '#FFFFFF' },
    Statistic: { contentFontSize: 22 },
    Button: { fontWeight: 500 },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    ...shared,
    colorPrimary: '#3B82F6', colorInfo: '#3B82F6', colorLink: '#60A5FA',
    colorSuccess: '#4ADE80', colorWarning: '#FBBF24', colorError: '#F87171',
    // navy surfaces echoing the login/landing glass — richer than flat graphite
    colorBgLayout: '#0A0F1C', colorBgContainer: '#131C30', colorBgElevated: '#1A2540',
    colorBorder: '#26324A', colorBorderSecondary: '#1D2942',
    colorText: '#E6EBF2', colorTextSecondary: '#9AA7B8', colorTextTertiary: '#6B7A90',
    colorFillTertiary: '#0E1626',
    boxShadow: 'none',
    boxShadowSecondary: '0 8px 28px rgba(0,0,0,.45)',
  },
  components: {
    Layout: { headerBg: '#101a2e', headerHeight: 52, bodyBg: '#0A0F1C' },
    Menu: {
      itemBg: 'transparent', itemHeight: 38, itemBorderRadius: 10,
      itemSelectedBg: 'rgba(59,130,246,.18)', itemSelectedColor: '#60A5FA',
      itemHoverColor: '#60A5FA',
      groupTitleFontSize: 11,
    },
    Table: {
      headerBg: '#0F1728', headerColor: '#9AA7B8',
      cellPaddingBlockSM: 12, cellPaddingInlineSM: 14,
      rowHoverBg: '#1A2540', fontSizeSM: 14,
      headerSplitColor: 'transparent',
      borderColor: '#1D2942',
    },
    Card:   { borderRadiusLG: 14, paddingLG: 18 },
    Drawer: { paddingLG: 20 },
    Modal:  { borderRadiusLG: 14 },
    Tag:    { borderRadiusSM: 6 },
    Tabs:   { horizontalItemPadding: '10px 12px' },
    Statistic: { contentFontSize: 22 },
    Button: { fontWeight: 500 },
  },
};

export type ThemeMode = 'light' | 'dark';

export function initialThemeMode(): ThemeMode {
  const saved = localStorage.getItem('sb_theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
