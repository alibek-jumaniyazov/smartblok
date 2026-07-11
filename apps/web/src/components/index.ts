// Component barrel. Append your exports — do not rewrite other agents' lines.

// Status & feedback components (04 §4.2, §4.6, §2.5, §2.6, §4.8, §3.6)
export { StatusChip } from './StatusChip';
export type { StatusChipProps } from './StatusChip';

export { EmptyState, ErrorState } from './EmptyState';
export type { EmptyStateProps, ErrorStateProps } from './EmptyState';

export { LedgerImpactPreview } from './LedgerImpactPreview';
export type { LedgerImpactPreviewProps, ImpactFact, ImpactTone } from './LedgerImpactPreview';

export { ReasonModal } from './ReasonModal';
export type { ReasonModalProps } from './ReasonModal';

export { DensityToggle } from './DensityToggle';
export type { DensityToggleProps } from './DensityToggle';

export { totalsRow } from './TotalsRow';
export type { TotalsRowOptions, TotalsCell } from './TotalsRow';

export { DateRangeControl } from './DateRangeControl';
export type { DateRangeControlProps, DateRange } from './DateRangeControl';

// Money & indicator atoms (04 §2.1, §2.2, §2.7, §2.8, §2.9, §2.10, §4.8)
export { MoneyCell } from './MoneyCell';
export type { MoneyCellProps, MoneyVariant } from './MoneyCell';

export { BalanceTag } from './BalanceTag';
export type { BalanceTagProps, PartyType } from './BalanceTag';

export { PalletChip } from './PalletChip';
export type { PalletChipProps } from './PalletChip';

export { CreditGauge } from './CreditGauge';
export type { CreditGaugeProps } from './CreditGauge';

export { CapacityMeter } from './CapacityMeter';
export type { CapacityMeterProps } from './CapacityMeter';

export { MoneyInput } from './MoneyInput';
export type { MoneyInputProps } from './MoneyInput';

export { KbdHint, DeltaTag, Sparkline, OverdueChip } from './SmallAtoms';
export type { KbdHintProps, DeltaTagProps, SparklineProps, OverdueChipProps } from './SmallAtoms';

// List system: filters, saved views, the one table, unified pickers (04 §1.3–1.5, §2.11)
export { FilterBar } from './FilterBar';
export type { FilterBarProps, FilterField, FilterFieldType, FilterAggregate } from './FilterBar';

export { SavedViews } from './SavedViews';
export type { SavedView, SavedViewsProps } from './SavedViews';

export { DataTable } from './DataTable';
export type { DataTableProps, SbColumn, QueryLike, ColumnPreset } from './DataTable';

export { PartySelect, CashboxSelect, LegalEntitySelect } from './PartySelect';
export type {
  PartySelectProps,
  PartySelectType,
  CashboxSelectProps,
  LegalEntitySelectProps,
} from './PartySelect';

// Shell system: live state badge + page identity block (04 §4.5, §1.2)
export { LiveBadge } from './LiveBadge';
export type { LiveBadgeProps } from './LiveBadge';

export { PageHeader } from './PageHeader';
export type {
  PageHeaderProps,
  PageHeaderCrumb,
  PageHeaderAction,
  PageHeaderTab,
} from './PageHeader';

export { CommandPalette } from './CommandPalette';
export type { CommandPaletteProps } from './CommandPalette';
