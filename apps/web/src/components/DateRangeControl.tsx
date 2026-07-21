// DateRangeControl (04 §3.6, 02 §7) — one period-control language everywhere.
// A single date-to-date RangePicker (no quick presets — the owner mandated
// date-to-date only). Controlled with YYYY-MM-DD strings and a single
// { from, to } onChange. The Tashkent-day basis is stated in the picker footer.
//
// TELEFON (mobile-responsive-spec §2.5): RangePicker ikki oylik panel chiqaradi
// (~636px). 320–414px ekranda ikkinchi sana AMALDA tanlanmaydi — panel qirqiladi,
// `body { overflow-x: hidden }` esa uni skroll qilish o'rniga yashiradi. Shuning
// uchun telefonda bitta RangePicker ikkita ustma-ust DatePicker'ga bo'linadi:
// har biri to'liq kenglikda, bitta oylik panel bilan. Tashqi shartnoma
// («ikkalasi ham tanlanmaguncha onChange kelmaydi») aynan saqlanadi.
import { useState } from 'react';
import { DatePicker, theme } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useIsPhone } from '../lib/responsive';
import { useT } from './LangContext';

const { RangePicker } = DatePicker;

const FMT = 'YYYY-MM-DD';
const DISPLAY = 'DD.MM.YYYY';

export interface DateRange {
  from?: string;
  to?: string;
}

export interface DateRangeControlProps {
  from?: string;
  to?: string;
  onChange: (range: DateRange) => void;
  size?: 'small' | 'middle' | 'large';
}

export function DateRangeControl({ from, to, onChange, size = 'small' }: DateRangeControlProps) {
  const isPhone = useIsPhone();
  return isPhone ? (
    <PhoneRange from={from} to={to} onChange={onChange} size={size} />
  ) : (
    <DesktopRange from={from} to={to} onChange={onChange} size={size} />
  );
}

/** «Toshkent kuni bo'yicha» — davr asosini aytadigan izoh (02 §7). */
function BasisNote() {
  const { token } = theme.useToken();
  const t = useT();
  return (
    <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{t("Toshkent kuni bo'yicha")}</span>
  );
}

function DesktopRange({ from, to, onChange, size }: DateRangeControlProps) {
  const t = useT();

  return (
    <RangePicker
      size={size}
      value={from && to ? [dayjs(from), dayjs(to)] : null}
      format={DISPLAY}
      allowClear
      placeholder={[t('Boshlanish'), t('Tugash')]}
      onChange={(vals) => {
        const start = vals?.[0];
        const end = vals?.[1];
        if (!start || !end) onChange({ from: undefined, to: undefined });
        else onChange({ from: start.format(FMT), to: end.format(FMT) });
      }}
      renderExtraFooter={() => <BasisNote />}
    />
  );
}

/**
 * Telefon varianti — ikkita mustaqil DatePicker.
 *
 * Yarim kiritilgan holat (faqat «Boshlanish» tanlangan) uchun mahalliy qoralama
 * kerak: to'liq bo'lmagan juftlikda tashqariga `{undefined, undefined}` ketadi,
 * ya'ni proplar bo'shab qoladi. `sig` — proplar KEYINGI qadamda qanday bo'lishini
 * oldindan yozib qo'yadi, shuning uchun qaytib kelgan bo'sh proplar qoralamani
 * o'chirmaydi; tashqaridan haqiqiy o'zgarish kelsa esa qoralama yangilanadi.
 */
function PhoneRange({ from, to, onChange, size }: DateRangeControlProps) {
  const t = useT();
  const sigOf = (a?: string, b?: string) => (a && b ? `${a}|${b}` : '|');

  const [draft, setDraft] = useState<{ sig: string; a: Dayjs | null; b: Dayjs | null }>(() => ({
    sig: sigOf(from, to),
    a: from ? dayjs(from) : null,
    b: to ? dayjs(to) : null,
  }));

  const propSig = sigOf(from, to);
  if (draft.sig !== propSig) {
    // proplar tashqaridan o'zgardi (filtr tozalandi, saqlangan ko'rinish yuklandi)
    setDraft({ sig: propSig, a: from ? dayjs(from) : null, b: to ? dayjs(to) : null });
  }

  const emit = (a: Dayjs | null, b: Dayjs | null) => {
    if (a && b) {
      const nextFrom = a.format(FMT);
      const nextTo = b.format(FMT);
      setDraft({ sig: `${nextFrom}|${nextTo}`, a, b });
      onChange({ from: nextFrom, to: nextTo });
      return;
    }
    setDraft({ sig: '|', a, b });
    onChange({ from: undefined, to: undefined });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', minWidth: 0 }}>
      <DatePicker
        size={size}
        value={draft.a}
        format={DISPLAY}
        allowClear
        // klaviatura panelni yopib qo'ymasin — sana faqat kalendardan tanlanadi
        inputReadOnly
        placeholder={t('Boshlanish')}
        disabledDate={(d) => (draft.b ? d.isAfter(draft.b, 'day') : false)}
        onChange={(v) => emit(v ?? null, draft.b)}
        style={{ width: '100%' }}
      />
      <DatePicker
        size={size}
        value={draft.b}
        format={DISPLAY}
        allowClear
        inputReadOnly
        placeholder={t('Tugash')}
        disabledDate={(d) => (draft.a ? d.isBefore(draft.a, 'day') : false)}
        onChange={(v) => emit(draft.a, v ?? null)}
        style={{ width: '100%' }}
      />
      <BasisNote />
    </div>
  );
}
