import { useMemo, useState } from 'react';
import { App, Button, Form, Input, InputNumber, Space, Switch } from 'antd';
import { EditOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtNum } from '../lib/format';
import {
  BalanceTag,
  DataTable,
  FilterBar,
  FormDrawer,
  StatusChip,
  TableCard,
  type FilterField,
  type SbColumn,
} from '../components';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import type { StatusMeta } from '../lib/status-maps';
import type { Vehicle } from '../lib/types';

/** Faol / Nofaol active flag — success ink for live, neutral ink for archived. */
const ACTIVE_META: Record<'active' | 'inactive', StatusMeta> = {
  active: { label: 'Faol', light: '#1A7F37', dark: '#6CC495' },
  inactive: { label: 'Nofaol', light: '#64748B', dark: '#94A3B8' },
};

// jadval ustidagi standart filtrlar (URL-sinxron)
const FILTERS: FilterField[] = [
  {
    key: 'active',
    label: 'Holat',
    type: 'select',
    options: [
      { label: 'Faol', value: 'true' },
      { label: 'Nofaol', value: 'false' },
    ],
  },
];

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
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canEdit = hasRole('ADMIN', 'ACCOUNTANT');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form] = Form.useForm<VehicleFormValues>();

  const uf = useUrlFilters(['search', 'active']);
  const search = uf.get('search').trim().toLowerCase();
  const activeFilter = uf.get('active');

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
      message.success(editing ? 'Moshina yangilandi' : 'Moshina yaratildi');
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      setModalOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => endpoints.deleteVehicle(id),
    onSuccess: () => {
      message.success('Moshina nofaol qilindi');
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
      title: 'Moshinani nofaol qilish',
      content: `"${row.name}" nofaol qilinadi. Tarix saqlanadi, o'chirilmaydi.`,
      okText: 'Nofaol qilish',
      okButtonProps: { danger: true },
      cancelText: 'Bekor qilish',
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
      render: (v: boolean) => <StatusChip meta={v ? ACTIVE_META.active : ACTIVE_META.inactive} />,
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
        actions={
          canEdit
            ? [{ key: 'new', label: 'Yangi moshina', primary: true, icon: <PlusOutlined />, onClick: openCreate }]
            : []
        }
      />

      <TableCard
        title="Moshinalar"
        loading={listQ.isFetching}
        toolbar={<FilterBar schema={FILTERS} searchPlaceholder="Nomi / raqami / shofyor" />}
      >
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
        title={editing ? 'Moshinani tahrirlash' : 'Yangi moshina'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={() => form.validateFields().then((vals) => save.mutate(vals))}
        submitting={save.isPending}
        width={440}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Nomi" rules={[{ required: true, message: 'Nomi majburiy' }, { max: 200 }]}>
            <Input placeholder="masalan Howo 1" />
          </Form.Item>
          <Form.Item name="plate" label="Davlat raqami" rules={[{ max: 50 }]}>
            <Input placeholder="masalan 01 A 123 BC" />
          </Form.Item>
          <Form.Item name="driver" label="Shofyor" rules={[{ max: 200 }]}>
            <Input placeholder="Shofyor ismi" />
          </Form.Item>
          <Form.Item name="phone" label="Telefon" rules={[{ max: 50 }]}>
            <Input placeholder="+998 ..." />
          </Form.Item>
          <Form.Item
            name="capacityPallets"
            label="Sig'imi (paddon)"
            extra="Bitta furaga sig'adigan paddonlar soni (standart 19)"
            rules={[{ required: true, message: "Sig'imi majburiy" }]}
          >
            <InputNumber min={1} max={40} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          {editing && (
            <Form.Item name="active" label="Faol" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </FormDrawer>
    </div>
  );
}
