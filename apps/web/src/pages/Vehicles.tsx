import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { EditOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtNum, num } from '../lib/format';
import { Money } from '../components/Money';
import { useAuth } from '../auth/AuthContext';
import type { Vehicle } from '../lib/types';

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

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form] = Form.useForm<VehicleFormValues>();

  const listQ = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => endpoints.vehicles(),
  });
  const rows = useMemo(() => {
    const all = asItems(listQ.data);
    const s = search.trim().toLowerCase();
    return s
      ? all.filter((v) =>
          [v.name, v.plate ?? '', v.driver ?? ''].some((f) => f.toLowerCase().includes(s)),
        )
      : all;
  }, [listQ.data, search]);

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

  const columns: TableColumnsType<Vehicle> = [
    { title: 'Nomi', dataIndex: 'name', key: 'name' },
    { title: 'Davlat raqami', dataIndex: 'plate', key: 'plate', render: (v: string | null) => v || '—' },
    { title: 'Shofyor', dataIndex: 'driver', key: 'driver', render: (v: string | null) => v || '—' },
    { title: 'Telefon', dataIndex: 'phone', key: 'phone', render: (v: string | null) => v || '—' },
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
      render: (v: string | undefined) => {
        const n = num(v);
        return (
          <Space size={6}>
            <Money value={v ?? '0'} signed strong />
            {n < 0 ? <Tag color="red">Qarzimiz</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: 'Holat',
      dataIndex: 'active',
      key: 'active',
      render: (v: boolean) => (v ? <Tag color="green">Faol</Tag> : <Tag>Nofaol</Tag>),
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
        ] as TableColumnsType<Vehicle>)
      : []),
  ];

  if (listQ.error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Moshinalarni yuklashda xatolik"
        description={apiError(listQ.error)}
        action={
          <Button size="small" onClick={() => listQ.refetch()}>
            Qayta urinish
          </Button>
        }
      />
    );
  }

  return (
    <Card
      title={<Typography.Title level={4} style={{ margin: 0 }}>Moshinalar</Typography.Title>}
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="Nomi / raqami / shofyor..."
            onSearch={setSearch}
            onChange={(e) => !e.target.value && setSearch('')}
            style={{ width: 240 }}
          />
          {canEdit && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Yangi moshina
            </Button>
          )}
        </Space>
      }
    >
      <div className="scroll-x">
        <Table<Vehicle>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={listQ.isFetching}
          pagination={{ showSizeChanger: true, defaultPageSize: 20 }}
          size="middle"
        />
      </div>

      <Modal
        title={editing ? 'Moshinani tahrirlash' : 'Yangi moshina'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.validateFields().then((vals) => save.mutate(vals))}
        okText="Saqlash"
        cancelText="Bekor qilish"
        confirmLoading={save.isPending}
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
      </Modal>
    </Card>
  );
}
