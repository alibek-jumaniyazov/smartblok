import { createContext, useContext } from 'react';
import type { ThemeMode } from '../theme';

export const ThemeCtx = createContext<{ mode: ThemeMode; toggle: () => void }>({
  mode: 'light',
  toggle: () => {},
});

export const useThemeMode = () => useContext(ThemeCtx);
