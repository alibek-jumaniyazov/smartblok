// SmartBlok logo — a running-bond wall of aerated-concrete blocks.
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="sb-logo-g" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="11" fill="url(#sb-logo-g)" />
      {/* row 1 */}
      <rect x="8" y="12" width="15" height="7" rx="1.6" fill="#fff" fillOpacity="0.95" />
      <rect x="25" y="12" width="15" height="7" rx="1.6" fill="#fff" fillOpacity="0.95" />
      {/* row 2 (offset — running bond) */}
      <rect x="8" y="20.5" width="6.5" height="7" rx="1.6" fill="#fff" fillOpacity="0.78" />
      <rect x="16.5" y="20.5" width="15" height="7" rx="1.6" fill="#fff" fillOpacity="0.78" />
      <rect x="33.5" y="20.5" width="6.5" height="7" rx="1.6" fill="#fff" fillOpacity="0.78" />
      {/* row 3 */}
      <rect x="8" y="29" width="15" height="7" rx="1.6" fill="#fff" fillOpacity="0.95" />
      <rect x="25" y="29" width="15" height="7" rx="1.6" fill="#fff" fillOpacity="0.95" />
    </svg>
  );
}
