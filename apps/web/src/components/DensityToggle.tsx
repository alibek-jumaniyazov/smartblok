// DensityToggle (04 §4.8, 02 §6) — the 36 → 44px row-height toggle for power
// registers (Orders, Payments, Kassa, Reestr, Debts). Writes body[data-density]
// (design.css keys `body[data-density='keng'] td { padding-block: 12px }` off it)
// and persists per user+route in localStorage under the passed storageKey
// (`sb_density:<userId>:<route>`). The attribute is cleared on unmount so a
// register's density never leaks onto a page that has no toggle.
import { useEffect, useState } from 'react';
import { Segmented } from 'antd';

type Density = 'zich' | 'keng';

export interface DensityToggleProps {
  /** persistence key, e.g. `sb_density:${userId}:${route}`. */
  storageKey: string;
  size?: 'small' | 'middle' | 'large';
}

export function DensityToggle({ storageKey, size = 'small' }: DensityToggleProps) {
  const [density, setDensity] = useState<Density>(
    () => (localStorage.getItem(storageKey) === 'keng' ? 'keng' : 'zich'),
  );

  // Re-read when the key changes (route change reuses the mounted control).
  useEffect(() => {
    setDensity(localStorage.getItem(storageKey) === 'keng' ? 'keng' : 'zich');
  }, [storageKey]);

  // Apply to <body>; clear only on unmount.
  useEffect(() => {
    document.body.dataset.density = density;
  }, [density]);
  useEffect(
    () => () => {
      delete document.body.dataset.density;
    },
    [],
  );

  const change = (value: Density) => {
    setDensity(value);
    localStorage.setItem(storageKey, value);
  };

  return (
    <Segmented<Density>
      size={size}
      value={density}
      onChange={change}
      aria-label="Jadval zichligi"
      options={[
        { label: 'Zich', value: 'zich' },
        { label: 'Keng', value: 'keng' },
      ]}
    />
  );
}
