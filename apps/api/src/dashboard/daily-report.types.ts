/** Shared server result: dashboard and Excel consume the same calculated cells. */
export interface DailyReportRow {
  key: string;
  label: string;
  unit: 'money' | 'quantity';
  section: 'settlement' | 'pallets' | 'factoryMargin' | 'salesMargin' | 'result';
  tone: 'green' | 'blue' | 'peach' | 'yellow' | 'plain' | 'total';
  values: string[];
  total: string;
  totalMode: 'sum' | 'opening' | 'closing';
}

export interface DailyReport {
  from: string;
  to: string;
  generatedAt: string;
  palletUnitPrice: string;
  days: string[];
  rows: DailyReportRow[];
  warnings: string[];
  notes: string[];
  provisionalOrderCount: number;
}
