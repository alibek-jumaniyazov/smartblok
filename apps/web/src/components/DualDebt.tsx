import { Typography, theme } from 'antd';
import { fmtMoney, fmtNum, num } from '../lib/format';
import type { DualDebtFields } from '../lib/types';
import { BalanceTag } from './BalanceTag';
import { useT } from './LangContext';

/** The API uses positive debt on both sides; the existing factory chip uses the opposite sign. */
export function debtTagBalance(value: string | number, party: 'client' | 'factory'): string {
  const text = String(value);
  return party === 'client' ? text : text.startsWith('-') ? text.slice(1) : `-${text}`;
}

export function DebtValue({ value, party, compact = true }: {
  value?: string | number; party: 'client' | 'factory'; compact?: boolean;
}) {
  return value == null ? <Typography.Text type="secondary">—</Typography.Text>
    : <BalanceTag balance={debtTagBalance(value, party)} partyType={party} compact={compact} />;
}

export function PalletValuation({ data }: { data: DualDebtFields }) {
  const t = useT();
  if (data.palletDebtQuantity == null || data.palletUnitPrice == null || data.palletDebtAmount == null) return null;
  return <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'normal' }}>
    {t('Paddon qiymati')}: {fmtNum(data.palletDebtQuantity)} {t('dona')} × {fmtMoney(data.palletUnitPrice)} = {fmtMoney(data.palletDebtAmount)} {t("so'm")}
  </Typography.Text>;
}

/** Both current balances stay visible on desktop and narrow screens, with no financial arithmetic in the UI. */
export function DualDebtPanel({ data, party }: { data: DualDebtFields; party: 'client' | 'factory' }) {
  const t = useT();
  const { token } = theme.useToken();
  if (data.debtWithoutPallets == null || data.debtWithPallets == null) return null;
  return <section className="sb-table-card" aria-label={t('Paddon bilan va paddonsiz hisob')} style={{ padding: 16, marginBottom: 16 }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 10 }}>
      <div>
        <div style={{ color: token.colorTextSecondary, marginBottom: 6 }}>{t('Paddonsiz balans')}</div>
        <DebtValue value={data.debtWithoutPallets} party={party} compact={false} />
      </div>
      <div>
        <div style={{ color: token.colorTextSecondary, marginBottom: 6 }}>{t('Paddon bilan balans')}</div>
        <DebtValue value={data.debtWithPallets} party={party} compact={false} />
      </div>
    </div>
    <PalletValuation data={data} />
    <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '6px 0 0' }}>
      {t('Paddon bilan balans = paddonsiz balans + qaytarilmagan paddon qiymati. Paddon joriy sozlamadagi narxda baholanadi.')}
    </Typography.Paragraph>
    {num(data.factoryReturnExpenseCredit) !== 0 && <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '6px 0 0' }}>
      {t('Paddon qaytarish xarajati zavod hisobidan chegirildi')}: {fmtMoney(data.factoryReturnExpenseCredit)} {t("so'm")}.
    </Typography.Paragraph>}
  </section>;
}
