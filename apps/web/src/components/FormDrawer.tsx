// FormDrawer — the ONE create/edit surface. Every "add / edit a record" flow uses
// this instead of a Modal (project rule: forms live in a right-side drawer, never a
// centered modal). Anatomy: sticky title header → scrollable body (the <Form>) →
// sticky footer (left extra slot + Bekor qilish / Saqlash). Ctrl/Cmd+Enter submits.
// Purely presentational: it owns no form state — the caller wires <Form onFinish>.
import { useEffect, type ReactNode } from 'react';
import { Button, Drawer, Flex } from 'antd';

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
  /** drawer width (default 520) */
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
  // Ctrl/Cmd+Enter saves from anywhere inside the drawer (03 §8 forms contract).
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

  const footer = hideFooter ? null : (
    <Flex align="center" justify="space-between" gap={12}>
      <div>{footerExtra}</div>
      <Flex align="center" gap={8}>
        <Button onClick={onClose}>{cancelText}</Button>
        {onSubmit ? (
          <Button type="primary" danger={danger} loading={submitting} disabled={disabled} onClick={onSubmit}>
            {submitText}
          </Button>
        ) : null}
      </Flex>
    </Flex>
  );

  return (
    <Drawer
      open={open}
      title={title}
      onClose={onClose}
      extra={extra}
      footer={footer}
      destroyOnHidden={destroyOnClose}
      afterOpenChange={afterOpenChange}
      className="sb-form-drawer"
      // antd v6 deprecated the numeric `width` prop; set the panel width via the
      // semantic `wrapper` slot instead (no console warning, arbitrary px).
      styles={{ wrapper: { width }, body: { paddingTop: 18 }, footer: { padding: '12px 20px' } }}
    >
      {children}
    </Drawer>
  );
}
