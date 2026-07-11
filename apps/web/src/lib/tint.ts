// Pure display helpers for the money/indicator atoms (04 §2, §4.8). No money math.

/**
 * 12%-alpha tint fills (02 §2.4: chip fills = 12% alpha of the ink over the
 * surface, text at full-strength ink). `hex` is an AntD token color; both
 * themes feed the theme-correct hex, so the result is theme-aware.
 */
export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex; // already rgb()/named — pass through
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
