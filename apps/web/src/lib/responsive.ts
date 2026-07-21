// responsive.ts (mobile-responsive-spec §1.4, §2.1) — breakpointlarning YAGONA
// manbasi. Boshqa hech qaysi fayl media-query satrida yoki kenglik solishtiruvida
// 575/576/767/768/991/992 raqamini saqlamaydi: hammasi shu yerdan import qilinadi.
//
// Nega AntD `Grid.useBreakpoint()` emas: u BIRINCHI renderda `{}` qaytaradi, ya'ni
// `!screens.md` desktopda ham bir lahza `true` bo'ladi — mobil layout "yonib"
// ketadi, jadval/grafiklar qayta mount bo'ladi. Bu yerdagi hooklar matchMedia +
// useSyncExternalStore ustiga qurilgan, shuning uchun render #1 dayoq to'g'ri.
//
// `.98` qoidasi: CSS max-width so'rovlari 767.98 / 991.98 (butun 767/991 emas) —
// aks holda kasrli viewport kengliklarida (Android non-integer DPR, brauzer zoom,
// devtools emulyatsiyasi) JS `(min-width: 768px)` bilan desinxronlashadi.
import { useCallback, useSyncExternalStore } from 'react';

/** AntD xom breakpointlari — faqat shu yerda raqam sifatida yashaydi. */
export const BP = { xs: 0, sm: 576, md: 768, lg: 992, xl: 1200, xxl: 1600 } as const;
export type Bp = keyof typeof BP;

/** «phone» ning inklyuziv yuqori chegarasi. */
export const PHONE_MAX = 767.98;
/** «tablet» ning inklyuziv yuqori chegarasi. */
export const TABLET_MAX = 991.98;

export const QUERY_PHONE = '(max-width: 767.98px)';
export const QUERY_TABLET = '(min-width: 768px) and (max-width: 991.98px)';
export const QUERY_DESKTOP = '(min-width: 992px)';
/** qo'pol ko'rsatkich / hover yo'q — hover-only affordanslarni almashtirish uchun. */
export const QUERY_TOUCH = '(hover: none), (pointer: coarse)';

/** --sb-topbar-h bilan sinxron (design.css). */
export const TOPBAR_H = 48;
/** --sb-tabbar-h bilan sinxron (design.css). */
export const TABBAR_H = 56;
/** --sb-touch bilan sinxron (design.css). */
export const TOUCH_MIN = 44;

// ── matchMedia ombori ────────────────────────────────────────────────────────
// MediaQueryList har renderda qayta yaratilmasin: getSnapshot har renderda
// chaqiriladi, shuning uchun so'rov satri bo'yicha keshlanadi.
const mqlCache = new Map<string, MediaQueryList>();

function getMql(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  let mql = mqlCache.get(query);
  if (!mql) {
    mql = window.matchMedia(query);
    mqlCache.set(query, mql);
  }
  return mql;
}

/**
 * Generic matchMedia obunasi. BIRINCHI renderda ham to'g'ri qiymat qaytaradi.
 * SSR / matchMedia yo'q muhitda `false` (desktop-first) beradi.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = getMql(query);
      if (!mql) return () => {};
      // Safari < 14 da addEventListener yo'q — eski addListener'ga tushamiz.
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
      }
      const legacy = mql as unknown as {
        addListener(cb: () => void): void;
        removeListener(cb: () => void): void;
      };
      legacy.addListener(onChange);
      return () => legacy.removeListener(onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => getMql(query)?.matches ?? false, [query]);
  // server snapshot — desktop-first standart (mobil layout hech qachon "yonmaydi")
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** width < 768 — «phone» (§1.1). */
export function useIsPhone(): boolean {
  return useMediaQuery(QUERY_PHONE);
}

/** 768 <= width < 992 — «tablet». */
export function useIsTablet(): boolean {
  return useMediaQuery(QUERY_TABLET);
}

/** width >= 992 — muzlatilgan sirt. */
export function useIsDesktop(): boolean {
  return useMediaQuery(QUERY_DESKTOP);
}

/** Nomlangan AntD breakpointidan yuqori (yoki teng) bo'lsa true. */
export function useBreakpointUp(bp: Bp): boolean {
  return useMediaQuery(`(min-width: ${BP[bp]}px)`);
}

/** Qo'pol ko'rsatkich / hover yo'q — hover-only affordanslarni almashtirish uchun. */
export function useIsTouch(): boolean {
  return useMediaQuery(QUERY_TOUCH);
}

/** Drawer paneli kengligi, 320px da ham xavfsiz. drawerWidth(520) → "min(520px, 100vw)" */
export function drawerWidth(desktopPx: number): string {
  return `min(${desktopPx}px, 100vw)`;
}

/** Modal kengligi, 320px da ham xavfsiz. modalWidth(560) → "min(560px, calc(100vw - 24px))" */
export function modalWidth(desktopPx: number): string {
  return `min(${desktopPx}px, calc(100vw - 24px))`;
}

/** Portal orqali chiqadigan panellar (Select / Picker / Popover) uchun shift. */
export function popupMaxWidth(): string {
  return 'calc(100vw - 24px)';
}
