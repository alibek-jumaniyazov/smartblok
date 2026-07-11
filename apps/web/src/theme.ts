// theme.ts — SmartBlok canonical themes (02-design-language.md §11, verbatim).
// Font family: @fontsource-variable/inter registers 'Inter Variable' (not 'Inter var').
import { theme as antdTheme, type ThemeConfig } from 'antd';

const font =
  "'Inter Variable', 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif";

const shared = {
  fontFamily: font,
  fontSize: 14,
  fontSizeSM: 13, // tables
  fontSizeHeading3: 20, // page titles
  lineHeight: 1.5715,
  borderRadius: 8,
  borderRadiusLG: 10,
  borderRadiusSM: 6,
  controlHeight: 32,
  controlHeightSM: 26,
  motionDurationFast: '0.12s',
  motionDurationMid: '0.18s',
  motionDurationSlow: '0.24s',
  motionEaseInOut: 'cubic-bezier(0.2, 0, 0, 1)',
};

export const lightTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    ...shared,
    colorPrimary: '#26617F', colorInfo: '#26617F', colorLink: '#26617F',
    colorSuccess: '#1A7F37', colorWarning: '#9A6700', colorError: '#C2413B',
    colorBgLayout: '#F6F7F9', colorBgContainer: '#FFFFFF',
    colorBorder: '#E3E7EC', colorBorderSecondary: '#EDF0F3',
    colorText: '#1B2530', colorTextSecondary: '#5B6774', colorTextTertiary: '#8A94A0',
    colorFillTertiary: '#F3F5F7',
    boxShadow: '0 1px 2px rgba(15,23,32,.06)',
    boxShadowSecondary: '0 8px 24px rgba(15,23,32,.10)',
  },
  components: {
    Layout: { siderBg: '#F1F3F6', headerBg: '#FFFFFF', headerHeight: 48 },
    Menu: {
      itemBg: 'transparent', itemHeight: 34, itemBorderRadius: 8,
      itemSelectedBg: '#E8F0F5', itemSelectedColor: '#26617F',
      groupTitleFontSize: 11,
    },
    Table: {
      headerBg: '#F3F5F7', headerColor: '#5B6774',
      cellPaddingBlockSM: 8, cellPaddingInlineSM: 12,
      rowHoverBg: '#F6F8FA', fontSizeSM: 13,
      headerSplitColor: 'transparent',
    },
    Card:   { borderRadiusLG: 10, paddingLG: 16 },
    Drawer: { paddingLG: 20 },
    Modal:  { borderRadiusLG: 10 },
    Tag:    { borderRadiusSM: 6, defaultBg: '#F3F5F7' },
    Tabs:   { horizontalItemPadding: '10px 12px' },
    Segmented: { itemSelectedBg: '#FFFFFF' },
    Statistic: { contentFontSize: 20 },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    ...shared,
    colorPrimary: '#7FB0CC', colorInfo: '#7FB0CC', colorLink: '#7FB0CC',
    colorSuccess: '#6CC495', colorWarning: '#D9A94A', colorError: '#E8827C',
    colorBgLayout: '#0E1216', colorBgContainer: '#161C22', colorBgElevated: '#1C242C',
    colorBorder: '#2A333C', colorBorderSecondary: '#222A32',
    colorText: '#E6EBF0', colorTextSecondary: '#9AA7B4', colorTextTertiary: '#6C7885',
    colorFillTertiary: '#10151A',
    boxShadow: 'none',
    boxShadowSecondary: '0 8px 24px rgba(0,0,0,.45)',
  },
  components: {
    Layout: { siderBg: '#12171D', headerBg: '#161C22', headerHeight: 48 },
    Menu: {
      itemBg: 'transparent', itemHeight: 34, itemBorderRadius: 8,
      itemSelectedBg: '#1B2E3A', itemSelectedColor: '#7FB0CC',
      groupTitleFontSize: 11,
    },
    Table: {
      headerBg: '#10151A', headerColor: '#9AA7B4',
      cellPaddingBlockSM: 8, cellPaddingInlineSM: 12,
      rowHoverBg: '#1B222A', fontSizeSM: 13,
      headerSplitColor: 'transparent',
    },
    Card:   { borderRadiusLG: 10, paddingLG: 16 },
    Drawer: { paddingLG: 20 },
    Modal:  { borderRadiusLG: 10 },
    Tag:    { borderRadiusSM: 6 },
    Tabs:   { horizontalItemPadding: '10px 12px' },
    Statistic: { contentFontSize: 20 },
  },
};

export type ThemeMode = 'light' | 'dark';

export function initialThemeMode(): ThemeMode {
  const saved = localStorage.getItem('sb_theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
