// ReasonModal (04 §2.6) — THE single destructive-confirm surface. Replaces the
// closure-variable `modal.confirm` anti-pattern. Controlled: open / onConfirm /
// onClose. Anatomy: danger title stating the irreversible fact → optional
// LedgerImpactPreview → required reason TextArea (inline ≥3 chars) → danger
// confirm labeled with the verb, disabled until valid, never default-focused
// (02 §10) → submitting keeps its verb → server error rendered inline verbatim.
// The import-rollback variant adds a typed-word guard (e.g. «ROLLBACK»).
// Telefonda (mobile-responsive-spec R3/R15/R16): modal markazda ochiladi va
// autoFocus o'chadi — bu ikkisi birga bo'lmasa iOS klaviaturasi mount paytida
// ko'tarilib, «Tasdiqlash / Orqaga» tugmalarini ekrandan chiqarib yuborardi,
// ya'ni qaytarib bo'lmaydigan amalni ko'r-ko'rona tasdiqlashga majburlardi.
// Footer tugmalari esa 50/50 bo'linadi (uzun o'zbekcha fe'llar kesilmasin).
import { useEffect, useState } from 'react';
import { Input, Modal, theme } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { apiError } from '../lib/api';
import { LedgerImpactPreview, type ImpactFact } from './LedgerImpactPreview';
import { modalWidth, useIsPhone } from '../lib/responsive';
import { useT } from './LangContext';

export interface ReasonModalProps {
  open: boolean;
  /** danger title stating the irreversible fact. */
  title: string;
  /** the verb on the confirm button, e.g. «Bekor qilish», «Storno». */
  confirmLabel: string;
  onConfirm: (reason: string) => void | Promise<void>;
  onClose: () => void;
  /** optional consequence list (LedgerImpactPreview). */
  facts?: ImpactFact[];
  /** external submitting control (e.g. a react-query mutation's isPending). */
  submitting?: boolean;
  /** external server error to display inline (verbatim). */
  error?: unknown;
  /** typed-word guard — the confirm stays disabled until the word matches exactly. */
  confirmWord?: string;
  /** TextArea placeholder. */
  placeholder?: string;
  /** minimum reason length (default 3). */
  minReasonLength?: number;
}

export function ReasonModal({
  open,
  title,
  confirmLabel,
  onConfirm,
  onClose,
  facts,
  submitting,
  error,
  confirmWord,
  placeholder = 'Sababni yozing…',
  minReasonLength = 3,
}: ReasonModalProps) {
  const { token } = theme.useToken();
  const t = useT();
  const isPhone = useIsPhone();
  const [reason, setReason] = useState('');
  const [word, setWord] = useState('');
  const [touched, setTouched] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [localErr, setLocalErr] = useState<unknown>(null);

  // Reset on each open (ReasonModal itself stays mounted between uses).
  useEffect(() => {
    if (open) {
      setReason('');
      setWord('');
      setTouched(false);
      setLocalErr(null);
      setLocalBusy(false);
    }
  }, [open]);

  const reasonValid = reason.trim().length >= minReasonLength;
  const wordValid = !confirmWord || word === confirmWord;
  const valid = reasonValid && wordValid;
  const busy = submitting === true || localBusy;
  const shownError = error ?? localErr;

  const submit = async () => {
    if (!valid) {
      setTouched(true);
      return;
    }
    setLocalErr(null);
    try {
      setLocalBusy(true);
      await onConfirm(reason.trim());
    } catch (e) {
      setLocalErr(e);
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <span
          style={{
            color: token.colorError,
            display: 'inline-flex',
            // uzun sarlavha telefonda ikki qatorga o'ralganda belgi tepada tursin
            alignItems: isPhone ? 'flex-start' : 'center',
            gap: 8,
          }}
        >
          {/* belgi hech qachon siqilmasin — o'ralgan sarlavha uni ezib qo'yardi */}
          <ExclamationCircleOutlined style={{ flex: '0 0 auto', marginTop: isPhone ? 3 : 0 }} />
          {title}
        </span>
      }
      onOk={submit}
      onCancel={busy ? undefined : onClose}
      okText={t(confirmLabel)}
      cancelText={t('Orqaga')}
      okButtonProps={{
        danger: true,
        disabled: !valid,
        loading: busy,
        style: isPhone ? { flex: '1 1 0', marginInlineStart: 0 } : undefined,
      }}
      cancelButtonProps={{ disabled: busy, style: isPhone ? { flex: '1 1 0' } : undefined }}
      styles={isPhone ? { footer: { display: 'flex', gap: 8 } } : undefined}
      maskClosable={!busy}
      keyboard={!busy}
      width={modalWidth(480)}
      centered={isPhone}
      destroyOnHidden
    >
      <div style={{ display: 'grid', gap: 12, marginTop: 4 }}>
        {facts && facts.length > 0 ? <LedgerImpactPreview facts={facts} /> : null}

        <div>
          <Input.TextArea
            autoFocus={!isPhone}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={t(placeholder)}
            autoSize={{ minRows: isPhone ? 2 : 3, maxRows: isPhone ? 5 : 8 }}
            status={touched && !reasonValid ? 'error' : undefined}
            disabled={busy}
          />
          {touched && !reasonValid ? (
            <div style={{ color: token.colorError, fontSize: 12, marginTop: 4 }}>
              {t('Sabab kiritilishi shart (kamida {n} belgi).', { n: minReasonLength })}
            </div>
          ) : null}
        </div>

        {confirmWord ? (
          <div>
            <div style={{ fontSize: 13, color: token.colorTextSecondary, marginBottom: 6 }}>
              {t('Tasdiqlash uchun «{word}» deb yozing:', { word: confirmWord })}
            </div>
            <Input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={confirmWord}
              status={touched && !wordValid ? 'error' : undefined}
              disabled={busy}
            />
          </div>
        ) : null}

        {shownError ? (
          <div style={{ color: token.colorError, fontSize: 13, whiteSpace: 'pre-wrap' }}>
            {apiError(shownError)}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
