import { useEffect, useRef, useState } from 'react';
import { App, Button, Form, Input, InputNumber, Select, Space, Switch, theme } from 'antd';
import type { InputRef } from 'antd';
import { EditOutlined, PlusOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtNum } from '../lib/format';
import {
  BalanceTag,
  DataTable,
  FormDrawer,
  StatusChip,
  TableCard,
  type MobileCardModel,
  type SbColumn,
} from '../components';
import { PageHeader } from '../components/PageHeader';
import { useT } from '../components/LangContext';
import { useAuth } from '../auth/AuthContext';
import { useIsPhone } from '../lib/responsive';
import { useUrlFilters } from '../lib/useUrlFilters';
import type { StatusMeta } from '../lib/status-maps';
import type { Vehicle } from '../lib/types';

/** Faol / Nofaol active flag — success ink for live, neutral ink for archived. */
const ACTIVE_META: Record<'active' | 'inactive', StatusMeta> = {
  active: { label: 'Faol', light: '#1A7F37', dark: '#6CC495' },
  inactive: { label: 'Nofaol', light: '#64748B', dark: '#94A3B8' },
};

interface VehicleFormValues {
  name: string;
  plate?: string;
  driver?: string;
  phone?: string;
  capacityPallets?: number;
  active?: boolean;
}

/** Serverga ketadigan shakl: bo'sh matn `null` bo'ladi (maydonni tozalash uchun). */
type VehicleSavePayload = Omit<VehicleFormValues, 'plate' | 'driver' | 'phone'> & {
  plate: string | null;
  driver: string | null;
  phone: string | null;
};

/** '' va '   ' — davlat raqami emas; serverga aniq `null` yuboriladi. */
const blank = (s?: string): string | null => (s ?? '').trim() || null;

/** 409 VEHICLE_PLATE_TAKEN javobi — qaysi moshina raqamni band qilganini aytadi. */
interface PlateTakenError {
  code?: string;
  message?: string;
  vehicleId?: string;
  vehicleName?: string;
  vehicleActive?: boolean;
}

export default function Vehicles() {
  const { message, modal } = App.useApp();
  const t = useT();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const isPhone = useIsPhone();
  const canEdit = hasRole('ADMIN', 'ACCOUNTANT');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form] = Form.useForm<VehicleFormValues>();

  const { token } = theme.useToken();
  const uf = useUrlFilters(['search', 'active']);
  // Paging/qidiruv SERVERDA (Mijozlar sahifasi bilan bir xil). Ilgari butun ro'yxat
  // olinardi deb faraz qilingan edi, aslida server 50 tadan kesardi va qidiruv faqat
  // o'sha 50 ta ustidan ishlardi — importdan kelgan moshinalar «yo'qolib» qolgandi.
  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;
  const urlSearch = uf.get('search');
  const search = urlSearch.trim(); // .toLowerCase() EMAS — server `contains, insensitive` qiladi
  const activeFilter = uf.get('active');
  const active = activeFilter === 'true' ? true : activeFilter === 'false' ? false : undefined;

  // Qidiruv lokal — Enter/«Qidirish» bosilганда URL'ga yoziladi (Mijozlar bilan bir xil).
  const [searchInput, setSearchInput] = useState(urlSearch);
  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);
  // useUrlFilters.set()/clear() `page` ni O'ZI o'chiradi (page-neutral bo'lmagan har
  // qanday filtr o'zgarganda) — shuning uchun bu yerda page ni qo'lda tiklash shart emas
  const applySearch = () => uf.set({ search: searchInput.trim() || null });
  const clearFilters = () => {
    setSearchInput('');
    uf.clear(['search', 'active']);
  };
  const anyFilter = !!search || !!activeFilter;

  // '/' — qidiruv maydoniga fokus (boshqa list page'lardagi konventsiya)
  const searchRef = useRef<InputRef>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key !== '/') return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const listQ = useQuery({
    queryKey: ['vehicles', 'list', page, pageSize, search, activeFilter],
    queryFn: () => endpoints.vehicles({ page, pageSize, search: search || undefined, active }),
    // sahifa/qidiruv o'zgarganda eski qatorlar ekranda qoladi — aks holda jadval skeletonga
    // tushib, hisoblagich bir lahza «0 ta» bo'lib chaqnaydi (DataTable'ning isFetching
    // chizig'i yangilanayotganini allaqachon ko'rsatadi)
    placeholderData: keepPreviousData,
  });
  // hisoblagich SERVER jamisidan — sahifadagi qatorlar sonidan emas (u yolg'on ko'rsatardi)
  const total = Array.isArray(listQ.data) ? asItems(listQ.data).length : (listQ.data?.total ?? 0);

  const save = useMutation({
    mutationFn: (vals: VehicleSavePayload) =>
      editing ? endpoints.updateVehicle(editing.id, vals) : endpoints.createVehicle(vals),
    onSuccess: () => {
      message.success(editing ? t('Moshina yangilandi') : t('Moshina yaratildi'));
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      setModalOpen(false);
    },
    // Davlat raqami band bo'lsa — boshi berk ko'cha EMAS: qaysi moshina band qilganini
    // aytamiz va o'sha moshinani ochish / nofaol bo'lsa qayta faollashtirish taklif qilamiz.
    onError: (e, vars) => {
      const d = (e as { response?: { data?: PlateTakenError } })?.response?.data;
      if (d?.code !== 'VEHICLE_PLATE_TAKEN' || !d.vehicleId) {
        message.error(apiError(e));
        return;
      }
      modal.confirm({
        title: t('Bu davlat raqami band'),
        content: d.message,
        okText: d.vehicleActive ? t('Oʻsha moshinani ochish') : t('Qayta faollashtirish'),
        cancelText: t('Bekor qilish'),
        centered: isPhone,
        onOk: async () => {
          const v = (await endpoints.vehicle(d.vehicleId!)) as Vehicle;
          // Mavjud moshina O'Z ma'lumoti bilan ochiladi. Kiritilgan nom/sig'im bilan
          // ustidan yozilmaydi: bu yerda «yangi moshina» formasining standart qiymatlari
          // (masalan sig'im 19) real moshinaning sozlamasini jimgina buzib yuborardi.
          // Faqat BO'SH shofyor/telefon to'ldiriladi — hech qachon ustidan yozilmaydi.
          // «Faol» yoqilgan holda ochiladi: bitta «Saqlash» nofaolni qaytaradi.
          openEdit({
            ...v,
            driver: v.driver ?? vars.driver,
            phone: v.phone ?? vars.phone,
            active: true,
          });
        },
      });
    },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => endpoints.deleteVehicle(id),
    onSuccess: () => {
      message.success(t('Moshina nofaol qilindi'));
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ capacityPallets: 19 });
    setModalOpen(true);
  };
  const openEdit = (row: Vehicle) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      // `?? undefined`, `?? ''` EMAS: bo'sh satr serverga yuborilsa, u davlat raqami
      // ustunига '' bo'lib yozilardi va keyingi raqamsiz moshina «allaqachon mavjud»
      // xatosiga urilardi (unique indeksda '' — NULL emas, haqiqiy qiymat).
      name: row.name,
      plate: row.plate ?? undefined,
      driver: row.driver ?? undefined,
      phone: row.phone ?? undefined,
      capacityPallets: row.capacityPallets,
      active: row.active,
    });
    setModalOpen(true);
  };

  const confirmDeactivate = (row: Vehicle) => {
    modal.confirm({
      title: t('Moshinani nofaol qilish'),
      content: t('"{name}" nofaol qilinadi. Tarix saqlanadi, o\'chirilmaydi.', { name: row.name }),
      okText: t('Nofaol qilish'),
      okButtonProps: { danger: true },
      cancelText: t('Bekor qilish'),
      // telefonda markazlashtiriladi — aks holda uzun matn futerni surib yuboradi
      // va tasdiqlash tugmasi ko'rinmay qoladi (spec R16)
      centered: isPhone,
      onOk: () => deactivate.mutateAsync(row.id),
    });
  };

  const columns: SbColumn<Vehicle>[] = [
    { title: 'Nomi', dataIndex: 'name', key: 'name', ellipsis: true, width: 200 },
    { title: 'Davlat raqami', dataIndex: 'plate', key: 'plate', ellipsis: true, width: 150, render: (v: string | null) => v || '—' },
    { title: 'Shofyor', dataIndex: 'driver', key: 'driver', ellipsis: true, width: 170, render: (v: string | null) => v || '—' },
    { title: 'Telefon', dataIndex: 'phone', key: 'phone', ellipsis: true, width: 150, render: (v: string | null) => v || '—' },
    {
      title: "Sig'imi (paddon)",
      dataIndex: 'capacityPallets',
      key: 'capacityPallets',
      align: 'right',
      className: 'num',
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Balans',
      dataIndex: 'balance',
      key: 'balance',
      align: 'right',
      className: 'num',
      render: (v: string | undefined) => <BalanceTag balance={v ?? '0'} partyType="vehicle" />,
    },
    {
      title: 'Holat',
      dataIndex: 'active',
      key: 'active',
      render: (v: boolean) => {
        const m = v ? ACTIVE_META.active : ACTIVE_META.inactive;
        return <StatusChip meta={{ ...m, label: t(m.label) }} />;
      },
    },
    ...(canEdit
      ? ([
          {
            title: 'Amallar',
            key: 'actions',
            width: 140,
            render: (_: unknown, row: Vehicle) => (
              <Space>
                {/* ikonka-tugmalar uchun aria-label (R13) — ko'rinishi o'zgarmaydi */}
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  aria-label={t('Tahrirlash')}
                  onClick={() => openEdit(row)}
                />
                {row.active && (
                  <Button
                    size="small"
                    danger
                    icon={<StopOutlined />}
                    aria-label={t('Nofaol qilish')}
                    onClick={() => confirmDeactivate(row)}
                  />
                )}
              </Space>
            ),
          },
        ] as SbColumn<Vehicle>[])
      : []),
  ];

  // Telefon kartasi (spec §2.2.2): sarlavha = nomi, o'ngda YAGONA pul figurasi
  // (balans). Shofyor / telefon / sig'im — yorliqli qatorlar; qator ichidagi
  // ikonka-tugmalar barmoq uchun juda kichik, shuning uchun amallar karta
  // futerida yorliqli chiqadi (§2.2.4). Telefon `tel:` havolasi (R14).
  const vehicleCard = (v: Vehicle): MobileCardModel => {
    const m = v.active ? ACTIVE_META.active : ACTIVE_META.inactive;
    const lines: NonNullable<MobileCardModel['lines']> = [];
    if (v.driver) lines.push({ label: 'Shofyor', value: v.driver });
    if (v.phone) lines.push({ label: 'Telefon', value: <a href={`tel:${v.phone}`}>{v.phone}</a> });
    lines.push({
      label: "Sig'imi (paddon)",
      value: <span className="num">{fmtNum(v.capacityPallets)}</span>,
    });

    return {
      title: v.name,
      subtitle: v.plate || undefined,
      value: <BalanceTag balance={v.balance ?? '0'} partyType="vehicle" compact />,
      meta: <StatusChip meta={{ ...m, label: t(m.label) }} />,
      lines,
      actions: canEdit ? (
        <>
          <Button icon={<EditOutlined />} onClick={() => openEdit(v)}>
            {t('Tahrirlash')}
          </Button>
          {v.active && (
            <Button danger icon={<StopOutlined />} onClick={() => confirmDeactivate(v)}>
              {t('Nofaol qilish')}
            </Button>
          )}
        </>
      ) : undefined,
    };
  };

  return (
    <div>
      <PageHeader
        title="Moshinalar"
        subtitle="Moshinalar ro'yxati — sig'imi, balans va shofyor ma'lumotlari"
        accent
        actions={
          canEdit
            ? [{ key: 'new', label: 'Yangi moshina', primary: true, icon: <PlusOutlined />, onClick: openCreate }]
            : []
        }
      />

      {/* Filtrlar — buissnes_crm uslubida alohida karta: qidiruv + holat + amallar */}
      <div
        className="sb-table-card"
        style={{ padding: isPhone ? '10px 12px' : '14px 16px', marginBottom: 16 }}
      >
        <div className="sb-filterbar">
          <Input
            ref={searchRef}
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder={t('Moshina nomi yoki raqami')}
            value={searchInput}
            onChange={(e) => {
              const v = e.target.value;
              setSearchInput(v);
              if (v === '') uf.set({ search: null });
            }}
            onPressEnter={applySearch}
            style={{ width: isPhone ? '100%' : 260, minWidth: isPhone ? 0 : undefined }}
          />
          <Select
            allowClear
            placeholder={t('Holat')}
            value={activeFilter || undefined}
            onChange={(v?: string) => uf.set({ active: v || null })}
            options={[
              { label: t('Faol'), value: 'true' },
              { label: t('Nofaol'), value: 'false' },
            ]}
            style={{ width: isPhone ? '100%' : undefined, minWidth: isPhone ? 0 : 160 }}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>
            {t('Qidirish')}
          </Button>
          <Button onClick={clearFilters} disabled={!anyFilter}>
            {t('Tozalash')}
          </Button>
          {/* telefonda `margin-inline-start: auto` yo'q — hisoblagich o'z qatorida */}
          <span
            className="num"
            style={{
              marginInlineStart: isPhone ? 0 : 'auto',
              width: isPhone ? '100%' : undefined,
              color: token.colorTextSecondary,
              fontSize: 13,
            }}
          >
            {fmtNum(total)} {t('ta')}
          </span>
        </div>
      </div>

      <TableCard>
        <DataTable<Vehicle>
          rowKey="id"
          columns={columns}
          // Paged konvertini to'g'ridan-to'g'ri uzatamiz — DataTable sahifalagichni
          // server jamisidan quradi (Mijozlar sahifasidagi kabi)
          query={listQ}
          emptyText="Hozircha moshina yo'q"
          scroll={{ x: 'max-content' }}
          mobileCard={vehicleCard}
        />
      </TableCard>

      <FormDrawer
        title={editing ? t('Moshinani tahrirlash') : t('Yangi moshina')}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={() =>
          form.validateFields().then((vals) =>
            save.mutate({
              ...vals,
              name: vals.name.trim(),
              plate: blank(vals.plate),
              driver: blank(vals.driver),
              phone: blank(vals.phone),
            }),
          )
        }
        submitting={save.isPending}
        width={440}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('Nomi')} rules={[{ required: true, message: t('Nomi majburiy') }, { max: 200 }]}>
            <Input placeholder={t('masalan Howo 1')} />
          </Form.Item>
          <Form.Item name="plate" label={t('Davlat raqami')} rules={[{ max: 50 }]}>
            <Input placeholder={t('masalan 01 A 123 BC')} />
          </Form.Item>
          <Form.Item name="driver" label={t('Shofyor')} rules={[{ max: 200 }]}>
            <Input placeholder={t('Shofyor ismi')} />
          </Form.Item>
          <Form.Item name="phone" label={t('Telefon')} rules={[{ max: 50 }]}>
            <Input placeholder="+998 ..." />
          </Form.Item>
          <Form.Item
            name="capacityPallets"
            label={t("Sig'imi (paddon)")}
            extra={t("Bitta furaga sig'adigan paddonlar soni (standart 19)")}
            rules={[{ required: true, message: t("Sig'imi majburiy") }]}
          >
            <InputNumber min={1} max={40} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          {editing && (
            <Form.Item name="active" label={t('Faol')} valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </FormDrawer>
    </div>
  );
}
