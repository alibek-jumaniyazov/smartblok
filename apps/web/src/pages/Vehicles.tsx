import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Form, Input, InputNumber, Select, Space, Switch, theme } from 'antd';
import type { InputRef } from 'antd';
import { EditOutlined, PlusOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtNum } from '../lib/format';
import {
  BalanceTag,
  DataTable,
  FormDrawer,
  StatusChip,
  TableCard,
  type SbColumn,
} from '../components';
import { PageHeader } from '../components/PageHeader';
import { useT } from '../components/LangContext';
import { useAuth } from '../auth/AuthContext';
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

export default function Vehicles() {
  const { message, modal } = App.useApp();
  const t = useT();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canEdit = hasRole('ADMIN', 'ACCOUNTANT');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form] = Form.useForm<VehicleFormValues>();

  const { token } = theme.useToken();
  const uf = useUrlFilters(['search', 'active']);
  const urlSearch = uf.get('search');
  const search = urlSearch.trim().toLowerCase();
  const activeFilter = uf.get('active');

  // Qidiruv lokal — Enter/«Qidirish» bosilганда URL'ga yoziladi (Mijozlar bilan bir xil).
  const [searchInput, setSearchInput] = useState(urlSearch);
  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);
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
    queryKey: ['vehicles'],
    queryFn: () => endpoints.vehicles(),
  });
  const rows = useMemo(() => {
    const all = asItems(listQ.data);
    return all.filter((v) => {
      if (activeFilter === 'true' && !v.active) return false;
      if (activeFilter === 'false' && v.active) return false;
      if (search) {
        const hay = [v.name, v.plate ?? '', v.driver ?? ''].join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [listQ.data, search, activeFilter]);

  const save = useMutation({
    mutationFn: (vals: VehicleFormValues) =>
      editing ? endpoints.updateVehicle(editing.id, vals) : endpoints.createVehicle(vals),
    onSuccess: () => {
      message.success(editing ? t('Moshina yangilandi') : t('Moshina yaratildi'));
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      setModalOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
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
      name: row.name,
      plate: row.plate ?? '',
      driver: row.driver ?? '',
      phone: row.phone ?? '',
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
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
                {row.active && (
                  <Button size="small" danger icon={<StopOutlined />} onClick={() => confirmDeactivate(row)} />
                )}
              </Space>
            ),
          },
        ] as SbColumn<Vehicle>[])
      : []),
  ];

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
      <div className="sb-table-card" style={{ padding: '14px 16px', marginBottom: 16 }}>
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
            style={{ width: 260 }}
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
            style={{ minWidth: 160 }}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>
            {t('Qidirish')}
          </Button>
          <Button onClick={clearFilters} disabled={!anyFilter}>
            {t('Tozalash')}
          </Button>
          <span className="num" style={{ marginInlineStart: 'auto', color: token.colorTextSecondary, fontSize: 13 }}>
            {fmtNum(rows.length)} {t('ta')}
          </span>
        </div>
      </div>

      <TableCard>
        <DataTable<Vehicle>
          rowKey="id"
          columns={columns}
          query={{
            data: rows,
            isLoading: listQ.isLoading,
            isFetching: listQ.isFetching,
            isError: listQ.isError,
            error: listQ.error,
            refetch: listQ.refetch,
          }}
          emptyText="Hozircha moshina yo'q"
          scroll={{ x: 'max-content' }}
        />
      </TableCard>

      <FormDrawer
        title={editing ? t('Moshinani tahrirlash') : t('Yangi moshina')}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={() => form.validateFields().then((vals) => save.mutate(vals))}
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
