// «Balansni nazorat qilish» — an owner off-book balance correction for a client or factory.
// Posts a single OFFBOOK_ADJUSTMENT ledger row (POST /:party/:id/adjust-balance): it moves
// THIS party's balance and shows in their statement («amallar»), but is deliberately kept OUT
// of the dashboard company totals and the transactions journal (it touches no kassa). ADMIN
// only — the caller renders the button on that role, the backend enforces it.
import { useEffect, useState } from 'react';
import { App, Input, Modal, Segmented, Typography, theme } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiError, endpoints } from '../lib/api';
import { num } from '../lib/format';
import { BalanceTag } from './BalanceTag';
import { MoneyInput } from './MoneyInput';
import { useT } from './LangContext';

export interface BalanceControlModalProps {
  open: boolean;
  onClose: () => void;
  party: 'client' | 'factory';
  partyId: string;
  partyName?: string;
  /**
   * The signed balance this modal edits: for a CLIENT the ledger balance (>0 ⇒ qarz), for a
   * FACTORY the PAYABLE figure the hero shows (<0 ⇒ qarzimiz). The posted delta lands on the
   * same figure, so the preview is exact.
   */
  balance: number;
}

type Dir = 'add' | 'sub';

export function BalanceControlModal({ open, onClose, party, partyId, partyName, balance }: BalanceControlModalProps) {
  const { token } = theme.useToken();
  const t = useT();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [dir, setDir] = useState<Dir>('add');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setDir('add');
      setAmount('');
      setNote('');
    }
  }, [open]);

  const value = num(amount);
  // Signed ledger delta to POST — same sign convention as the edited figure.
  //  CLIENT : «Qarzini oshirish» ⇒ +value (owes us more);  «kamaytirish» ⇒ −value (credit).
  //  FACTORY: «Qarzimizni oshirish» ⇒ −value (payable more negative);  «kamaytirish» ⇒ +value.
  const ledgerDelta =
    party === 'client' ? (dir === 'add' ? value : -value) : dir === 'add' ? -value : value;
  const newBalance = balance + ledgerDelta;

  const dirOptions =
    party === 'client'
      ? [
          { value: 'add', label: t('Qarzini oshirish') },
          { value: 'sub', label: t('Qarzini kamaytirish') },
        ]
      : [
          { value: 'add', label: t('Qarzimizni oshirish') },
          { value: 'sub', label: t('Qarzimizni kamaytirish') },
        ];

  const mut = useMutation({
    mutationFn: () =>
      party === 'client'
        ? endpoints.adjustClientBalance(partyId, { amount: ledgerDelta, note: note.trim() || undefined })
        : endpoints.adjustFactoryBalance(partyId, { amount: ledgerDelta, note: note.trim() || undefined }),
    onSuccess: () => {
      message.success(t('Balans tuzatildi'));
      for (const key of ['clients', 'factories', 'debts'])
        qc.invalidateQueries({ queryKey: [key] });
      onClose();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const canSubmit = value > 0 && !mut.isPending;

  return (
    <Modal
      open={open}
      onCancel={mut.isPending ? undefined : onClose}
      title={t('Balansni nazorat qilish')}
      okText={t('Tuzatishni saqlash')}
      cancelText={t('Bekor')}
      okButtonProps={{ disabled: !canSubmit, loading: mut.isPending }}
      onOk={() => canSubmit && mut.mutate()}
      destroyOnHidden
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
        {partyName ? (
          <Typography.Text strong style={{ fontSize: 15 }}>
            {partyName}
          </Typography.Text>
        ) : null}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '10px 12px',
            borderRadius: token.borderRadiusLG,
            background: token.colorFillTertiary,
          }}
        >
          <Typography.Text type="secondary">{t('Joriy balans')}</Typography.Text>
          <BalanceTag balance={String(balance)} partyType={party} />
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{t("O'zgartirish")}</div>
          <Segmented
            block
            options={dirOptions}
            value={dir}
            onChange={(v) => setDir(v as Dir)}
          />
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{t('Summa')}</div>
          <MoneyInput value={amount} onChange={setAmount} />
        </div>

        {value > 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '10px 12px',
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Typography.Text type="secondary">{t('Yangi balans')}</Typography.Text>
            <BalanceTag balance={String(newBalance)} partyType={party} />
          </div>
        ) : null}

        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{t('Izoh')}</div>
          <Input.TextArea
            rows={2}
            maxLength={1000}
            value={note}
            placeholder={t('Nima uchun tuzatildi (ixtiyoriy)')}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t(
            "Bu tuzatish faqat shu {party} balansi va uning amallar ro'yxatida ko'rinadi — dashboard va tranzaksiyalarga chiqmaydi, kassaga tegmaydi.",
            { party: party === 'client' ? t('mijoz') : t('zavod') },
          )}
        </Typography.Text>
      </div>
    </Modal>
  );
}
