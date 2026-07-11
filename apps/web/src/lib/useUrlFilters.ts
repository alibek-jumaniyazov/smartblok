// THE URL-filter hook (03 §7): URLSearchParams is the single source of truth
// for register filters — no parallel useState, back/forward restores the exact
// param set, every KPI drill-down is just a link.
//
// Contract:
//   - values are strings; get() returns '' when absent
//   - set(patch): null/'' deletes a key; any change outside page/pageSize/peek
//     resets the page (the `page` param is removed ⇒ page 1)
//   - unknown params are always preserved (set/clear touch only named keys)
//   - no internal debounce — callers debounce their inputs (FilterBar: 300ms)
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/** params whose change must NOT reset pagination */
const PAGE_NEUTRAL = new Set(['page', 'pageSize', 'peek']);

export interface UrlFilters {
  /** every current param as a plain object (unknown params included) */
  params: Record<string, string>;
  /** current value or '' when absent */
  get(key: string): string;
  /**
   * Merge a patch into the URL. `null` or `''` removes the key.
   * Resets `page` unless the patch touches only page/pageSize/peek.
   * `replace: true` rewrites history in place (peek cursor moves, typing).
   */
  set(patch: Record<string, string | null>, opts?: { replace?: boolean }): void;
  /** Remove the given keys (default: the schema keys; else every param). Resets page. */
  clear(keys?: readonly string[]): void;
}

export function useUrlFilters(schema?: readonly string[]): UrlFilters {
  const [searchParams, setSearchParams] = useSearchParams();

  const params = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);

  const get = useCallback((key: string) => searchParams.get(key) ?? '', [searchParams]);

  const set = useCallback(
    (patch: Record<string, string | null>, opts?: { replace?: boolean }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          let touchesFilters = false;
          for (const [key, value] of Object.entries(patch)) {
            if (!PAGE_NEUTRAL.has(key)) touchesFilters = true;
            if (value == null || value === '') next.delete(key);
            else next.set(key, value);
          }
          if (touchesFilters) next.delete('page'); // back to page 1
          return next;
        },
        { replace: opts?.replace },
      );
    },
    [setSearchParams],
  );

  const clear = useCallback(
    (keys?: readonly string[]) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const toClear = keys ?? schema ?? Array.from(new Set(prev.keys()));
          for (const key of toClear) next.delete(key);
          next.delete('page');
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams, schema],
  );

  return useMemo(() => ({ params, get, set, clear }), [params, get, set, clear]);
}
