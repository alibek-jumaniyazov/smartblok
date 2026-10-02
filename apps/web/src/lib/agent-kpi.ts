/** Move the decimal point without introducing binary floating-point rounding. */
function shiftDecimal(value: string, places: number): string {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d*)?$/.test(text)) throw new Error('Invalid KPI percentage');
  const [whole, fraction = ''] = text.split('.');
  const digits = whole + fraction;
  const point = whole.length + places;
  const shifted = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length ? digits + '0'.repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [integer, decimal = ''] = shifted.split('.');
  const normalized = integer.replace(/^0+(?=\d)/, '');
  const tail = decimal.replace(/0+$/, '');
  return tail ? `${normalized}.${tail}` : normalized;
}

export const kpiShareToPercent = (share: string): string => shiftDecimal(share, 2);
export const kpiPercentToShare = (percent: string): string => shiftDecimal(percent, -2);

export interface AgentKpiMetrics {
  ordersCount: number;
  quantityM3: string;
  profit: string;
  taxAmount: string;
  netProfit: string;
  agentKpi: string;
  companyProfit: string;
}
export interface AgentKpiRow extends AgentKpiMetrics {
  agentId: string | null;
  agentName: string;
  sortNo: number | null;
}
export interface AgentKpiDay extends AgentKpiMetrics { date: string }
export interface AgentKpiReport {
  month: string;
  agentId: string | null;
  settings: { taxPerM3: string; agentShare: string; companyShare: string };
  availableMonths: string[];
  monthly: { from: string; to: string; rows: AgentKpiRow[]; totals: AgentKpiMetrics };
  lifetime: { from: string | null; to: string | null; rows: AgentKpiRow[]; totals: AgentKpiMetrics };
  daily: { rows: AgentKpiDay[]; totals: AgentKpiMetrics };
}
