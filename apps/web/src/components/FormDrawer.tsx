// FormDrawer — the ONE create/edit surface. Every "add / edit a record" flow uses
// this instead of a Modal (project rule: forms live in a right-side drawer, never a
// centered modal). Anatomy: sticky title header → scrollable body (the <Form>) →
// sticky footer (left extra slot + Bekor qilish / Saqlash). Ctrl/Cmd+Enter submits.
// Purely presentational: it owns no form state — the caller wires <Form onFinish>.
//   I18N: submit/cancel yorliqlari (default yoki caller bergani) t() orqali tarjima.
//
//   MOBIL (mobile-responsive-spec §2.3): telefonda drawer PASTKI VARAQQA aylanadi
//   (placement="bottom", 92dvh). 100vw ga qisilgan o'ng drawer'da niqob ko'rinmaydi
//   — u «chiqish yo'li yo'q sahifa» kabi o'qiladi va maskClosable amalda o'lik
//   bo'ladi. Futer tugmalari `block` bo'lib ustma-ust joylashadi (uzun o'zbekcha
//   yorliqlar kesilmasin) va safe-area insetidan yuqorida turadi. Chaqiruvchi
//   FAQAT desktop kengligini beradi — telefon kengligini bermaydi.
//
//   KLAVIATURA (spec §6 «asosiy zarar vertikal»): pastki varaq LAYOUT viewport'ning
//   tagiga bog'langan, iOS Safari esa ekran klaviaturasi uchun layout viewport'ni
//   qisqartirmaydi — natijada maydon fokusda bo'lganda futer («Saqlash») klaviatura
//   ostida qolar va foydalanuvchi HAR BIR maydondan keyin klaviaturani yopishga
//   majbur bo'lardi. visualViewport bilan o'lchangan inset varaqni ko'tarib turadi.
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Drawer, Flex } from 'antd';
import { drawerWidth, useIsPhone } from '../lib/responsive';
import { useT } from './LangContext';

/**
 * Ekran klaviaturasi egallagan balandlik (px) — ChatDock.tsx dagi bilan bir xil
 * o'lchov. iOS'da klaviatura ochilganda `visualViewport` qisqaradi, `innerHeight`
 * (layout viewport) esa o'zgarmaydi — farqi klaviatura balandligi. Android
 * «resize» rejimida farq ~0. 80px ostidagi farq e'tiborsiz: u brauzer manzil
 * satrining yig'ilishi, klaviatura emas.
 *
 * TODO(Foundation): ChatDock/PaymentComposer/SettleDrawer bilan birga
 * `lib/responsive.ts` ga ko'chirilsin — u fayl bu agentga tegishli emas.
 */
function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!enabled || !vv) {
      setInset(0);
      return;
    }
    const update = () => {
      const hidden = window.innerHeight - (vv.height + vv.offsetTop);
      setInset(hidden > 80 ? Math.round(hidden) : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [enabled]);

  return inset;
}

export interface FormDrawerProps {
  open: boolean;
  /** header title */
  title: ReactNode;
  onClose: () => void;
  /** footer «Saqlash» + Ctrl+Enter — usually `() => form.submit()` */
  onSubmit?: () => void;
  /** spinner + disabled state on the primary button while the mutation runs */
  submitting?: boolean;
  /** primary button label (default «Saqlash») */
  submitText?: string;
  /** cancel button label (default «Bekor qilish») */
  cancelText?: string;
  /** DESKTOP drawer width (default 520). Telefonda e'tiborga olinmaydi. */
  width?: number | string;
  /** primary action is destructive (red) */
  danger?: boolean;
  /** disable the primary button (e.g. invalid form) */
  disabled?: boolean;
  /** left-aligned footer slot (e.g. a delete/secondary action) */
  footerExtra?: ReactNode;
  /** header top-right slot (e.g. status chip) */
  extra?: ReactNode;
  /** hide the default footer entirely (caller renders its own inside children) */
  hideFooter?: boolean;
  /** unmount children when closed so forms reset cleanly (default true) */
  destroyOnClose?: boolean;
  /** fires with the drawer's open state after the transition (focus first field, etc.) */
  afterOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/** FormDrawer — standard create/edit drawer (replaces create/edit Modals). */
export function FormDrawer({
  open,
  title,
  onClose,
  onSubmit,
  submitting = false,
  submitText = 'Saqlash',
  cancelText = 'Bekor qilish',
  width = 520,
  danger = false,
  disabled = false,
  footerExtra,
  extra,
  hideFooter = false,
  destroyOnClose = true,
  afterOpenChange,
  children,
}: FormDrawerProps) {
  const t = useT();
  const isPhone = useIsPhone();
  // faqat telefonda va faqat varaq ochiq bo'lganda o'lchanadi
  const kbInset = useKeyboardInset(isPhone && open);

  // Ctrl/Cmd+Enter saves from anywhere inside the drawer (03 §8 forms contract).
  // Telefonda ham qoladi (Bluetooth klaviatura) — faqat maslahat matni yashiriladi.
  useEffect(() => {
    if (!open || !onSubmit) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!submitting && !disabled) onSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onSubmit, submitting, disabled]);

  const submitBtn = onSubmit ? (
    <Button
      type="primary"
      danger={danger}
      loading={submitting}
      disabled={disabled}
      block={isPhone}
      onClick={onSubmit}
    >
      {t(submitText)}
    </Button>
  ) : null;

  const footer = hideFooter ? null : isPhone ? (
    // telefonda: asosiy amal tepada, ikkalasi ham to'liq kenglikda
    <Flex vertical gap={8}>
      {submitBtn}
      <Button block onClick={onClose}>
        {t(cancelText)}
      </Button>
      {footerExtra ? <div>{footerExtra}</div> : null}
    </Flex>
  ) : (
    <Flex align="center" justify="space-between" gap={12}>
      <div>{footerExtra}</div>
      <Flex align="center" gap={8}>
        <Button onClick={onClose}>{t(cancelText)}</Button>
        {submitBtn}
      </Flex>
    </Flex>
  );

  return (
    <Drawer
      open={open}
      title={title}
      onClose={onClose}
      placement={isPhone ? 'bottom' : 'right'}
      extra={extra}
      footer={footer}
      destroyOnHidden={destroyOnClose}
      afterOpenChange={afterOpenChange}
      className={isPhone ? 'sb-form-drawer sb-form-drawer--sheet' : 'sb-form-drawer'}
      // antd v6 deprecated the numeric `width`/`height` props; the panel geometry
      // is set via the semantic `wrapper` slot instead (no console warning).
      // Raqamli `width` hech qachon xom chiqmaydi — drawerWidth() dan o'tadi.
      styles={{
        wrapper: isPhone
          ? {
              width: '100%',
              // klaviatura ochiq bo'lsa varaq uning USTIGA ko'chadi: `bottom`
              // futerni ko'rinadigan qiladi, balandlik cheklovi esa varaq tepasi
              // ekrandan chiqib ketmasligini kafolatlaydi.
              height: kbInset > 0 ? `min(92dvh, calc(100dvh - ${kbInset}px))` : '92dvh',
              ...(kbInset > 0 ? { bottom: kbInset } : null),
            }
          : { width: typeof width === 'number' ? drawerWidth(width) : width },
        body: isPhone ? { padding: '14px 12px' } : { paddingTop: 18 },
        footer: { padding: isPhone ? '12px 12px calc(12px + var(--sb-safe-b))' : '12px 20px' },
      }}
    >
      {children}
    </Drawer>
  );
}
