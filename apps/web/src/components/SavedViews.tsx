// SavedViews (04 §1.4) — per-user named filter presets per list. A view is the
// current URL query string (+ optional column preset / density metadata),
// persisted in localStorage under sb_views:<userId>:<route>. Built-ins are passed
// in per route; `V` cycles; a dirty indicator appears when the live filters drift
// from the active view. Self-contained: it reads and writes the URL directly.
// Telefonda (mobile-responsive-spec R3/R5/R15/R16): menyu satrining 180px
// qat'iy poli olib tashlanadi (320px ekranda ochilma ekrandan chiqib ketardi),
// «o'chirish» belgisi 28px teginish maydonini oladi (manfiy marginsiz — quti
// yorliq matni bilan ustma-ust tushmasin) va tasdiq so'raydi, saqlash modali
// esa markazda ochiladi — klaviatura ko'tarilganda tugmalar ko'rinib tursin.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App, Button, Dropdown, Flex, Input, Modal, theme } from 'antd';
import type { MenuProps } from 'antd';
import { CheckOutlined, DeleteOutlined, DownOutlined, EyeOutlined } from '@ant-design/icons';
import { useAuth } from '../auth/AuthContext';
import { modalWidth, popupMaxWidth, useIsPhone } from '../lib/responsive';
import { useT } from './LangContext';

export interface SavedView {
  id: string;
  label: string;
  /** normalized query string (no leading '?', excludes page/peek/view). */
  query: string;
  /** captured metadata; application is left to the register (DataTable owns density). */
  density?: 'zich' | 'keng';
  columnPreset?: string;
  builtin?: boolean;
  /** needs client-side derivation — carries a window on the drill page (03 §6). */
  starred?: boolean;
}

export interface SavedViewsProps {
  /** route key for the storage namespace (sb_views:<userId>:<routeKey>). */
  routeKey: string;
  /** built-in views for this route (03 §6). */
  builtins?: SavedView[];
}

/** query keys that never belong to a saved view. */
const DROP = new Set(['page', 'peek', 'view']);

function normalize(sp: URLSearchParams): string {
  const entries = Array.from(sp.entries()).filter(([k, v]) => !DROP.has(k) && v !== '');
  entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const out = new URLSearchParams();
  for (const [k, v] of entries) out.append(k, v);
  return out.toString();
}

function loadUserViews(key: string): SavedView[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
}

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function SavedViews({ routeKey, builtins = [] }: SavedViewsProps) {
  const { token } = theme.useToken();
  const { modal } = App.useApp();
  const t = useT();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const isPhone = useIsPhone();

  const storageKey = `sb_views:${user?.id ?? 'anon'}:${routeKey}`;
  const [userViews, setUserViews] = useState<SavedView[]>(() => loadUserViews(storageKey));
  useEffect(() => setUserViews(loadUserViews(storageKey)), [storageKey]);

  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');

  const all = useMemo(() => [...builtins, ...userViews], [builtins, userViews]);
  const current = normalize(params);
  const activeViewId = params.get('view') || undefined;
  const activeView = all.find((v) => v.id === activeViewId) ?? all.find((v) => v.query === current);
  const dirty = activeView ? activeView.query !== current : false;

  const persist = (next: SavedView[]) => {
    setUserViews(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const applyView = (v: SavedView) => {
    const next = new URLSearchParams(v.query);
    next.set('view', v.id);
    setParams(next);
  };

  const saveCurrent = () => {
    const label = name.trim();
    if (!label) return;
    const id = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const v: SavedView = { id, label, query: current };
    persist([...userViews, v]);
    setSaveOpen(false);
    setName('');
    applyView(v);
  };

  const updateActive = () => {
    if (!activeView || activeView.builtin) return;
    persist(userViews.map((v) => (v.id === activeView.id ? { ...v, query: current } : v)));
  };

  const deleteView = (id: string) => {
    persist(userViews.filter((v) => v.id !== id));
    if (activeViewId === id) {
      const p = new URLSearchParams(params);
      p.delete('view');
      setParams(p);
    }
  };

  // Telefonda o'chirish TASDIQLANADI: menyu satrining o'z tegishi «shu
  // ko'rinishni qo'llash», o'chirish esa qaytarib bo'lmaydigan amal — 2-3px
  // xato tegish saqlangan ko'rinishni butunlay yo'q qilardi. Desktop xulqi
  // o'zgarmaydi: u yerda sichqoncha aniq va o'chirish darhol bajariladi.
  const confirmDelete = (v: SavedView) => {
    if (!isPhone) {
      deleteView(v.id);
      return;
    }
    modal.confirm({
      title: t("Ko'rinishni o'chirish"),
      content: t("«{name}» ko'rinishi o'chiriladi.", { name: t(v.label) }),
      okText: t("O'chirish"),
      okButtonProps: { danger: true },
      cancelText: t('Bekor qilish'),
      // R16: markazda — futer klaviatura/notch ostida qolib ketmasin
      centered: true,
      onOk: () => deleteView(v.id),
    });
  };

  // V cycles through the whole view list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== 'v' && e.key !== 'V') return;
      if (all.length === 0) return;
      e.preventDefault();
      const idx = all.findIndex((v) => v.id === activeView?.id);
      applyView(all[(idx + 1) % all.length]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, activeView]);

  const viewLabel = (v: SavedView, deletable: boolean) => (
    <Flex align="center" justify="space-between" gap={12} style={{ minWidth: isPhone ? 0 : 180 }}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {activeView?.id === v.id ? (
          <CheckOutlined style={{ marginInlineEnd: 6, color: token.colorPrimary }} />
        ) : null}
        {t(v.label)}
        {v.starred ? <span style={{ color: token.colorTextTertiary }}> *</span> : null}
      </span>
      {deletable ? (
        <DeleteOutlined
          aria-label={t("O'chirish")}
          style={{
            color: token.colorTextTertiary,
            flex: '0 0 auto',
            // yalang'och 10px glif o'rniga 30x30 teginish maydoni (spec §2.5).
            // Manfiy margin YO'Q: u qutini yorliq matni ustiga cho'zib, «qo'llash»
            // tegish maydoni bilan ustma-ust tushirardi.
            ...(isPhone ? { padding: 8 } : null),
          }}
          onClick={(e) => {
            e.stopPropagation();
            confirmDelete(v);
          }}
        />
      ) : null}
    </Flex>
  );

  const items: MenuProps['items'] = [];
  if (builtins.length) {
    items.push({
      type: 'group',
      label: t("Tayyor ko'rinishlar"),
      children: builtins.map((v) => ({ key: v.id, label: viewLabel(v, false) })),
    });
  }
  if (userViews.length) {
    items.push({
      type: 'group',
      label: t("Mening ko'rinishlarim"),
      children: userViews.map((v) => ({ key: v.id, label: viewLabel(v, true) })),
    });
  }
  items.push({ type: 'divider' });
  if (activeView && !activeView.builtin && dirty) {
    items.push({ key: '__update', label: t("Ko'rinishni yangilash") });
  }
  items.push({ key: '__save', label: t("Joriy ko'rinishni saqlash…") });

  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === '__save') {
      setName('');
      setSaveOpen(true);
      return;
    }
    if (key === '__update') {
      updateActive();
      return;
    }
    const v = all.find((x) => x.id === key);
    if (v) applyView(v);
  };

  return (
    <>
      <Dropdown
        menu={{ items, onClick: onMenuClick }}
        trigger={['click']}
        styles={isPhone ? { root: { maxWidth: popupMaxWidth() } } : undefined}
      >
        <Button size="small" icon={<EyeOutlined />}>
          <span
            style={{
              maxWidth: isPhone ? 120 : 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t(activeView?.label ?? "Ko'rinishlar")}
          </span>
          {dirty ? (
            <span
              aria-label={t("saqlanmagan o'zgarishlar")}
              style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: 999,
                background: token.colorWarning,
                marginInlineStart: 2,
              }}
            />
          ) : null}
          <DownOutlined style={{ fontSize: 10 }} />
        </Button>
      </Dropdown>
      <Modal
        open={saveOpen}
        title={t("Joriy ko'rinishni saqlash")}
        okText={t('Saqlash')}
        cancelText={t('Bekor qilish')}
        onOk={saveCurrent}
        okButtonProps={{ disabled: !name.trim() }}
        onCancel={() => setSaveOpen(false)}
        width={modalWidth(520)}
        centered={isPhone}
        destroyOnHidden
      >
        <Input
          autoFocus={!isPhone}
          placeholder={t("Ko'rinish nomi")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={saveCurrent}
          maxLength={40}
        />
      </Modal>
    </>
  );
}
