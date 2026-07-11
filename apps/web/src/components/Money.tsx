import { Typography } from 'antd';
import { fmtMoney, num } from '../lib/format';

/**
 * Money display atom: grouped digits, tabular numerals, semantic coloring.
 * signed: positive = green (asset / they owe us), negative = red.
 */
export function Money({
  value,
  signed = false,
  suffix = '',
  strong = false,
}: {
  value: string | number | null | undefined;
  signed?: boolean;
  suffix?: string;
  strong?: boolean;
}) {
  const v = num(value);
  const type = !signed || v === 0 ? undefined : v > 0 ? 'success' : 'danger';
  return (
    <Typography.Text type={type} strong={strong} style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {fmtMoney(value)}
      {suffix ? ` ${suffix}` : ''}
    </Typography.Text>
  );
}
