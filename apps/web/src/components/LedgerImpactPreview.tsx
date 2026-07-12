// LedgerImpactPreview (04 §2.5) — the highest-value error prevention in the app.
// A bullet list of exactly what will post/reverse, in ledger language, shown
// before every commit. Data comes from the already-loaded record (allocations,
// ledger entries) — never a new endpoint; the caller builds the fact strings.
// Tone tints only the marker (semantic money palette, 02 §2.4); the text stays
// full-strength so the consequence is always readable in grayscale.
import type { ReactNode } from 'react';
import { theme } from 'antd';

export type ImpactTone = 'danger' | 'warning' | 'neutral' | 'success';

export interface ImpactFact {
  text: string;
  tone?: ImpactTone;
}

export interface LedgerImpactPreviewProps {
  facts: ImpactFact[];
  /** optional overline label above the list (e.g. «Natija»). */
  title?: string;
}

export function LedgerImpactPreview({ facts, title }: LedgerImpactPreviewProps) {
  const { token } = theme.useToken();
  if (!facts.length) return null;

  const toneColor = (tone: ImpactTone | undefined): string => {
    switch (tone) {
      case 'danger':
        return token.colorError;
      case 'warning':
        return token.colorWarning;
      case 'success':
        return token.colorSuccess;
      default:
        return token.colorTextSecondary;
    }
  };

  return (
    <div
      style={{
        background: token.colorFillTertiary,
        borderRadius: token.borderRadiusLG,
        padding: '12px 14px',
      }}
    >
      {title ? (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: token.colorTextSecondary,
            marginBottom: 8,
          }}
        >
          {title}
        </div>
      ) : null}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {facts.map((fact, i) => (
          <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span
              aria-hidden
              style={{
                flex: '0 0 auto',
                width: 6,
                height: 6,
                borderRadius: 999,
                marginTop: 6,
                background: toneColor(fact.tone),
              }}
            />
            <span style={{ color: token.colorText, fontSize: 13, lineHeight: '20px' }}>
              {fact.text as ReactNode}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
