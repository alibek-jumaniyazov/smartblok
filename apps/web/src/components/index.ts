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

// Standard surfaces: the one create/edit drawer + the one table container.
export { FormDrawer } from './FormDrawer';
export type { FormDrawerProps } from './FormDrawer';

export { TableCard } from './TableCard';
export type { TableCardProps } from './TableCard';

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

export { CancelOrderModal } from './CancelOrderModal';
export type { CancelOrderModalProps } from './CancelOrderModal';

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
export type {
  DataTableProps,
  SbColumn,
  QueryLike,
  ColumnPreset,
  MobileRole,
  MobileCardModel,
} from './DataTable';

export { TransactionsJournal } from './TransactionsJournal';
export type { TransactionsJournalProps } from './TransactionsJournal';

export { PartySelect, CashboxSelect } from './PartySelect';
export type {
  PartySelectProps,
  PartySelectType,
  CashboxSelectProps,
} from './PartySelect';

// Shell system: live state badge + page identity block (04 §4.5, §1.2)
export { LiveBadge } from './LiveBadge';
export type { LiveBadgeProps } from './LiveBadge';

export { MobileTabBar } from './MobileTabBar';
export type { MobileTabBarProps } from './MobileTabBar';

export { PageHeader } from './PageHeader';
export type {
  PageHeaderProps,
  PageHeaderCrumb,
  PageHeaderAction,
  PageHeaderTab,
} from './PageHeader';

export { CommandPalette } from './CommandPalette';
export type { CommandPaletteProps } from './CommandPalette';

// Money spine: kind-first payment entry drawer (04 §3.3, money.md §3)
export { PaymentComposer } from './PaymentComposer';
export type { PaymentComposerProps, ComposerPresetParty } from './PaymentComposer';

// Party money surfaces: the flagship balance hero + statement (04 §2.3, §2.4)
export { PartyBalanceHeader } from './PartyBalanceHeader';
export type {
  PartyBalanceHeaderProps,
  PartyHeaderParty,
  PartyHeaderAction,
  PartyHeaderCounters,
} from './PartyBalanceHeader';

export { PartyStatement } from './PartyStatement';
export type { PartyStatementProps } from './PartyStatement';

// Allocation workbench: the settlement drawer over its context (04 §3.2, hero §A)
export { SettleDrawer, AllocationEditor } from './SettleDrawer';
export type { SettleDrawerProps, AllocationInput } from './SettleDrawer';

// Master-detail dock + the payment-document renderer (04 §1.6, money.md §2)
export { PeekPanel } from './PeekPanel';
export type { PeekPanelProps } from './PeekPanel';

export { PaymentPeek } from './PaymentPeek';
export type { PaymentPeekProps } from './PaymentPeek';

// Cockpit engine: KPI display + worklist queues (04 §4.1, §3.4; 03 §6)
export { StatCard, KpiBand } from './StatCard';
export type { StatCardProps, StatCardDelta, KpiBandProps, KpiSecondaryStat } from './StatCard';

export { WorklistCard, InboxRail } from './WorklistCard';
export type { WorklistCardProps, InboxRailProps } from './WorklistCard';

// Responsive primitivlari (mobile-responsive-spec §1.4, §2.1) shu barreldan
// RE-EXPORT QILINMAYDI. Yagona kanonik import yo'li — `../lib/responsive`
// (§5.2: bitta yo'l). Bu yerga takroriy eshik qo'yilsa, ikkita sanksiyalangan
// import yo'li paydo bo'lardi.
