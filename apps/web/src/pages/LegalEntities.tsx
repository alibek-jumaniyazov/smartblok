import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { EditOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, endpoints } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import type { LegalEntity } from '../lib/types';

type EntityKind = LegalEntity['kind'];

const KIND: Record<EntityKind, { label: string; color: string }> = {
  DEALER: { label: 'Diler firmasi', color: 'blue' },
  FACTORY: { label: 'Zavod firmasi', color: 'purple' },
  THIRD_PARTY: { label: 'Uchinchi tomon', color: 'default' },
};

interface EntityFormValues {
  name: string;
  kind: EntityKind;
  inn?: string;
  note?: string;
  active?: boolean;
}

export default function LegalEntities() {
  const { message, modal } = App.useApp();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canEdit = hasRole('ADMIN', 'ACCOUNTANT');

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LegalEntity | null>(null);
  const [form] = Form.useForm<EntityFormValues>();

  const listQ = useQuery({
    queryKey: ['legal-entities'],
    queryFn: () => endpoints.legalEntities(),
  });
  const rows = useMemo(() => {
    const all = listQ.data ?? [];
    const s = search.trim().toLowerCase();
    return s
      ? all.filter((e) => e.name.toLowerCase().includes(s) || (e.inn ?? '').includes(s))
      : all;
  }, [listQ.data, search]);

  const save = useMutation({
    mutationFn: (vals: EntityFormValues) =>
      editing ? endpoints.updateLegalEntity(editing.id, vals) : endpoints.createLegalEntity(vals),
    onSuccess: () => {
      message.success(editing ? 'Yuridik shaxs yangilandi' : 'Yuridik shaxs yaratildi');
      qc.invalidateQueries({ queryKey: ['legal-entities'] });
      setModalOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => endpoints.updateLegalEntity(id, { active: false }),
    onSuccess: () => {
      message.success('Yuridik shaxs nofaol qilindi');
      qc.invalidateQueries({ queryKey: ['legal-entities'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ kind: 'THIRD_PARTY' });
    setModalOpen(true);
  };
  const openEdit = (row: LegalEntity) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      name: row.name,
      kind: row.kind,
      inn: row.inn ?? '',
      note: row.note ?? '',
      active: row.active,
    });
    setModalOpen(true);
  };

  const confirmDeactivate = (row: LegalEntity) => {
    modal.confirm({
      title: 'Yuridik shaxsni nofaol qilish',
      content: `"${row.name}" nofaol qilinadi — to'lovlar tarixi saqlanadi.`,
      okText: 'Nofaol qilish',
      okButtonProps: { danger: true },
      cancelText: 'Bekor qilish',
      onOk: () => deactivate.mutateAsync(row.id),
    });
  };

  const columns: TableColumnsType<LegalEntity> = [
    { title: 'Nomi', dataIndex: 'name', key: 'name' },
    {
      title: 'Turi',
      dataIndex: 'kind',
      key: 'kind',
      render: (v: EntityKind) => <Tag color={KIND[v]?.color}>{KIND[v]?.label ?? v}</Tag>,
    },
    { title: 'INN', dataIndex: 'inn', key: 'inn', render: (v: string | null) => v || '—' },
    { title: 'Izoh', dataIndex: 'note', key: 'note', ellipsis: true, render: (v: string | null) => v || '—' },
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
            render: (_: unknown, row: LegalEntity) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
                {row.active && (
                  <Button size="small" danger icon={<StopOutlined />} onClick={() => confirmDeactivate(row)} />
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<LegalEntity>)
      : []),
  ];

  if (listQ.error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Yuridik shaxslarni yuklashda xatolik"
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
      title={<Typography.Title level={4} style={{ margin: 0 }}>Yuridik shaxslar</Typography.Title>}
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="Nomi / INN..."
            onSearch={setSearch}
            onChange={(e) => !e.target.value && setSearch('')}
            style={{ width: 220 }}
          />
          {canEdit && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Yangi yuridik shaxs
            </Button>
          )}
        </Space>
      }
    >
      <div className="scroll-x">
        <Table<LegalEntity>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={listQ.isFetching}
          pagination={{ showSizeChanger: true, defaultPageSize: 20 }}
          size="middle"
        />
      </div>

      <Modal
        title={editing ? 'Yuridik shaxsni tahrirlash' : 'Yangi yuridik shaxs'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.validateFields().then((vals) => save.mutate(vals))}
        okText="Saqlash"
        cancelText="Bekor qilish"
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Nomi" rules={[{ required: true, message: 'Nomi majburiy' }, { max: 200 }]}>
            <Input placeholder='masalan "CAOLS KS" MCHJ' />
          </Form.Item>
          <Form.Item name="kind" label="Turi" rules={[{ required: true, message: 'Turini tanlang' }]}>
            <Select
              options={(Object.keys(KIND) as EntityKind[]).map((k) => ({
                value: k,
                label: KIND[k].label,
              }))}
            />
          </Form.Item>
          <Form.Item name="inn" label="INN" rules={[{ max: 50 }]}>
            <Input placeholder="Soliq raqami" />
          </Form.Item>
          <Form.Item name="note" label="Izoh" rules={[{ max: 1000 }]}>
            <Input.TextArea rows={3} placeholder="Ixtiyoriy izoh" />
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
