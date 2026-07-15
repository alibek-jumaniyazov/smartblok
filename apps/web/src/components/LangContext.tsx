// components/LangContext.tsx — til konteksti (ThemeContext bilan bir xil naqsh).
import { createContext, useContext } from 'react';
import type { LangCode, TFn } from '../lib/i18n';

export interface LangCtxValue {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  /** t('O'zbekcha manba matn', { param }) → tanlangan tildagi matn */
  t: TFn;
}

export const LangCtx = createContext<LangCtxValue>({
  lang: 'uz',
  setLang: () => {},
  t: (s) => s,
});

export const useLang = () => useContext(LangCtx);
/** Faqat tarjima funksiyasi kerak bo'lganda. */
export const useT = (): TFn => useContext(LangCtx).t;
