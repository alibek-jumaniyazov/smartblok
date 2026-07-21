// components/LangSwitcher.tsx — til almashtirgich (globus + qisqa kod, dropdown).
// TopBar va Login sahifasida ishlatiladi. Tanlov localStorage'da saqlanadi.
import { Button, Dropdown, Tooltip, type MenuProps } from 'antd';
import { CheckOutlined, GlobalOutlined } from '@ant-design/icons';
import { LANGS, type LangCode } from '../lib/i18n';
import { useIsPhone, useIsTouch, TOUCH_MIN } from '../lib/responsive';
import { useLang } from './LangContext';

export interface LangSwitcherProps {
  /** qorong'i sirt uchun (login) — matn oq bo'ladi */
  dark?: boolean;
  placement?: 'bottomRight' | 'topRight' | 'bottomLeft' | 'topLeft';
}

export function LangSwitcher({ dark, placement = 'bottomRight' }: LangSwitcherProps) {
  const { lang, setLang, t } = useLang();
  const isPhone = useIsPhone();
  const isTouch = useIsTouch();
  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0];

  const items: MenuProps['items'] = LANGS.map((l) => ({
    key: l.code,
    label: (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 12,
          justifyContent: 'space-between',
          // R5 — 156px pol 320px ekranda menyuni ekrandan chiqarib yuborardi;
          // telefonda element ota-menyu kengligini oladi.
          minWidth: isPhone ? 0 : 156,
          width: isPhone ? '100%' : undefined,
          minHeight: isPhone ? TOUCH_MIN : undefined,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span
            style={{ fontSize: 11, fontWeight: 700, opacity: 0.55, width: 22, textAlign: 'center', flex: '0 0 auto' }}
          >
            {l.short}
          </span>
          {l.native}
        </span>
        {l.code === lang ? <CheckOutlined style={{ color: 'var(--ant-color-primary)', flex: '0 0 auto' }} /> : null}
      </span>
    ),
  }));

  const trigger = (
    <Button
      type="text"
      shape="round"
      aria-label={t('Tilni tanlang')}
      icon={<GlobalOutlined />}
      style={dark ? { color: '#eaf0f9' } : undefined}
    >
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.02em' }}>{current.short}</span>
    </Button>
  );

  return (
    <Dropdown
      trigger={['click']}
      placement={placement}
      menu={{ items, selectedKeys: [lang], onClick: ({ key }) => setLang(key as LangCode) }}
    >
      {/* teginishda tooltip yopishib qoladi va menyu ustiga chiqadi — tugmaning
          o'zida `aria-label` bor, shuning uchun u yerda tooltip render qilinmaydi */}
      {isTouch ? trigger : <Tooltip title={t('Til')}>{trigger}</Tooltip>}
    </Dropdown>
  );
}
