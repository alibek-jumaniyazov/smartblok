import { Typography } from 'antd';
import { fmtMoney, num } from '../lib/format';
import { useIsPhone } from '../lib/responsive';

/**
 * Money display atom: grouped digits, tabular numerals, semantic coloring.
 * signed: positive = green (asset / they owe us), negative = red.
 *
 * R17: birlik («so'm») raqamdan alohida, o'ralishi mumkin bo'lgan span.
 * Telefonda tashqi element o'raladi, raqamning o'zi hech qachon bo'linmaydi;
 * desktopda esa avvalgidek yaxlit bir satr.
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
  const isPhone = useIsPhone();
  const type = !signed || v === 0 ? undefined : v > 0 ? 'success' : 'danger';
  return (
    <Typography.Text
      type={type}
      strong={strong}
      style={{
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: isPhone && suffix ? 'normal' : 'nowrap',
      }}
    >
      <span style={{ whiteSpace: 'nowrap' }}>{fmtMoney(value)}</span>
      {suffix ? <span> {suffix}</span> : null}
    </Typography.Text>
  );
}
