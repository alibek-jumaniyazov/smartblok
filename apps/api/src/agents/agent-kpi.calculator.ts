import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { D, ZERO } from '../common/money';

export const AGENT_KPI_SETTING_KEY = 'agentKpi';

export interface AgentKpiSettings {
  taxPerM3: string;
  /** Fraction, not percentage: 1/3 means a third of profit after the volume tax. */
  agentShare: string;
}

const THIRD = D(1).div(3);
export const DEFAULT_AGENT_KPI_SETTINGS: AgentKpiSettings = {
  taxPerM3: '10000',
  agentShare: THIRD.toString(),
};

/** One setting is shared by imports, the report, and the administrative editor. */
export function parseAgentKpiSettings(input: unknown): AgentKpiSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException("KPI sozlamalari noto'g'ri");
  }
  const values = input as Record<string, unknown>;
  function number(key: keyof AgentKpiSettings): Prisma.Decimal {
    const value = values[key];
    if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value.trim()))) {
      throw new BadRequestException(`${key} son bo'lishi kerak`);
    }
    let result: Prisma.Decimal;
    try { result = D(value); } catch { throw new BadRequestException(`${key} son bo'lishi kerak`); }
    if (!result.isFinite() || result.isNegative()) {
      throw new BadRequestException(`${key} manfiy bo'lmagan son bo'lishi kerak`);
    }
    return result;
  }
  const tax = number('taxPerM3');
  let share = number('agentShare');
  if (tax.decimalPlaces() > 6 || tax.greaterThan('999999999999')) {
    throw new BadRequestException('taxPerM3: ko\u2018pi bilan 6 kasr xonasi va 999999999999 so\u2018m');
  }
  if (share.greaterThan(1) || share.decimalPlaces() > 20) {
    throw new BadRequestException('agentShare 0 dan 1 gacha bo\u2018lishi kerak (ko\u2018pi bilan 20 kasr xonasi)');
  }
  // Excel's binary 0.3333333333333333 is the workbook's explicitly labelled 1/3.
  // Preserve that rational share instead of magnifying the binary approximation.
  if (share.minus(THIRD).abs().lte('0.0000000000000001')) share = THIRD;
  // Keep canonical settings in plain decimal notation: Decimal.toString() emits
  // exponents for tiny valid shares, which this same public parser rejects.
  return { taxPerM3: tax.toFixed(), agentShare: share.toFixed() };
}

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
  settings: AgentKpiSettings & { companyShare: string };
  availableMonths: string[];
  monthly: { from: string; to: string; rows: AgentKpiRow[]; totals: AgentKpiMetrics };
  lifetime: { from: string | null; to: string | null; rows: AgentKpiRow[]; totals: AgentKpiMetrics };
  daily: { rows: AgentKpiDay[]; totals: AgentKpiMetrics };
}

export interface AgentKpiAggregate {
  agentId: string | null;
  date: string;
  ordersCount: number;
  quantityM3: Prisma.Decimal.Value;
  profit: Prisma.Decimal.Value;
}

export interface AgentKpiIdentity { id: string; name: string; sortNo: number | null }

/**
 * Workbook KPI = (SUM(P-J-S) - SUM(H)*tax/m³) * agent share.
 * It is a performance figure, independent of payments, wallets, or salaries.
 * Do not round each shipment's tax/share: Excel calculates them after SUMIFS.
 * Decimal strings keep full precision until a UI/export display applies its format.
 */
export function calculateAgentKpi(
  quantity: Prisma.Decimal.Value,
  profit: Prisma.Decimal.Value,
  settings: AgentKpiSettings,
  ordersCount = 0,
): AgentKpiMetrics {
  const qty = D(quantity);
  const gross = D(profit);
  const tax = qty.times(settings.taxPerM3);
  const net = gross.minus(tax);
  const share = net.times(settings.agentShare);
  return {
    ordersCount, quantityM3: qty.toString(), profit: gross.toString(),
    taxAmount: tax.toString(), netProfit: net.toString(), agentKpi: share.toString(),
    companyProfit: net.minus(share).toString(),
  };
}

/** Valid calendar month; do not let JS turn month 13 into next year's January. */
export function assertAgentKpiMonth(month: string): void {
  if (!/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) {
    throw new BadRequestException('month formati YYYY-MM bo\u2018lishi kerak (1900\u20132199)');
  }
}

export function buildAgentKpiReport(
  month: string,
  settings: AgentKpiSettings,
  agents: AgentKpiIdentity[],
  aggregates: AgentKpiAggregate[],
  agentId: string | null = null,
): AgentKpiReport {
  assertAgentKpiMonth(month);
  const records = agentId ? aggregates.filter((r) => r.agentId === agentId) : aggregates;
  const ids = agents.filter((a) => !agentId || a.id === agentId);
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  const inMonth = records.filter((r) => r.date.startsWith(`${month}-`));
  function totals(rows: AgentKpiAggregate[]): AgentKpiMetrics {
    let qty = ZERO, profit = ZERO, count = 0;
    for (const r of rows) { qty = qty.plus(r.quantityM3); profit = profit.plus(r.profit); count += r.ordersCount; }
    return calculateAgentKpi(qty, profit, settings, count);
  }
  function agentRows(rows: AgentKpiAggregate[]): AgentKpiRow[] {
    const grouped = new Map<string | null, AgentKpiAggregate[]>();
    for (const r of rows) {
      const group = grouped.get(r.agentId) ?? [];
      group.push(r); grouped.set(r.agentId, group);
    }
    const result = ids.map((a) => ({
      agentId: a.id, agentName: a.name, sortNo: a.sortNo, ...totals(grouped.get(a.id) ?? []),
    })) as AgentKpiRow[];
    // A missing assignment must stay visible; otherwise the daily and agent tables disagree.
    if (grouped.has(null)) result.push({ agentId: null, agentName: 'Biriktirilmagan', sortNo: null, ...totals(grouped.get(null)!) });
    return result;
  }
  const dates = records.map((r) => r.date).sort();
  const dailyRows: AgentKpiDay[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    dailyRows.push({ date, ...totals(inMonth.filter((r) => r.date === date)) });
  }
  const monthTotals = totals(inMonth);
  return {
    month, agentId,
    settings: { ...settings, companyShare: D(1).minus(settings.agentShare).toString() },
    availableMonths: [...new Set([month, ...dates.map((date) => date.slice(0, 7))])].sort().reverse(),
    monthly: { from: `${month}-01`, to: `${month}-${daysInMonth}`, rows: agentRows(inMonth), totals: monthTotals },
    lifetime: { from: dates[0] ?? null, to: dates.at(-1) ?? null, rows: agentRows(records), totals: totals(records) },
    daily: { rows: dailyRows, totals: { ...monthTotals } },
  };
}
