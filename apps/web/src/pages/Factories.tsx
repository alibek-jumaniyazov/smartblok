import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
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
import type { Factory } from '../lib/types';

/** list rows carry ledger balance + bonus wallet + pallet accountability (FIN roles) */
type FactoryRow = Factory & { balance?: string; bonusBalance?: string; palletsHeld?: number };

interface FactoryFormValues {
  name: string;
  note?: string;
  active?: boolean;
}

export default function Factories() {
  const { message, modal } = App.useApp();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canEdit = hasRole('ADMIN', 'ACCOUNTANT');

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FactoryRow | null>(null);
  const [form] = Form.useForm<FactoryFormValues>();

  const listQ = useQuery({
    queryKey: ['factories'],
    queryFn: () => endpoints.factories(),
  });
  const rows = useMemo(() => {
    const all = asItems(listQ.data) as FactoryRow[];
    const s = search.trim().toLowerCase();
    return s ? all.filter((f) => f.name.toLowerCase().includes(s)) : all;
  }, [listQ.data, search]);

  const save = useMutation({
    mutationFn: (vals: FactoryFormValues) =>
      editing ? endpoints.updateFactory(editing.id, vals) : endpoints.createFactory(vals),
    onSuccess: () => {
      message.success(editing ? 'Zavod yangilandi' : 'Zavod yaratildi');
      qc.invalidateQueries({ queryKey: ['factories'] });
      setModalOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => endpoints.deleteFactory(id),
    onSuccess: () => {
      message.success('Zavod nofaol qilindi');
      qc.invalidateQueries({ queryKey: ['factories'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ name: '', note: '' });
    setModalOpen(true);
  };
  const openEdit = (row: FactoryRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({ name: row.name, note: row.note ?? '', active: row.active });
    setModalOpen(true);
  };

  const confirmDeactivate = (row: FactoryRow) => {
    modal.confirm({
      title: 'Zavodni nofaol qilish',
      content: `"${row.name}" zavodi nofaol qilinadi. Tarix saqlanadi, o'chirilmaydi.`,
      okText: 'Nofaol qilish',
      okButtonProps: { danger: true },
      cancelText: 'Bekor qilish',
      onOk: () => deactivate.mutateAsync(row.id),
    });
  };

  const columns: TableColumnsType<FactoryRow> = [
    {
      title: 'Nomi',
      dataIndex: 'name',
      key: 'name',
      render: (_: unknown, row) => <Link to={`/factories/${row.id}`}>{row.name}</Link>,
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
            {n > 0 ? <Tag color="green">Avans</Tag> : n < 0 ? <Tag color="red">Qarz</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: 'Bonus hamyon',
      dataIndex: 'bonusBalance',
      key: 'bonusBalance',
      align: 'right',
      className: 'num',
      render: (v: string | undefined) => <Money value={v ?? '0'} />,
    },
    {
      title: 'Paddon hisobi',
      dataIndex: 'palletsHeld',
      key: 'palletsHeld',
      align: 'right',
      className: 'num',
      render: (v: number | undefined) => fmtNum(v ?? 0),
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
            render: (_: unknown, row: FactoryRow) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
                {row.active && (
                  <Button
                    size="small"
                    danger
                    icon={<StopOutlined />}
                    onClick={() => confirmDeactivate(row)}
                  />
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<FactoryRow>)
      : []),
  ];

  if (listQ.error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Zavodlarni yuklashda xatolik"
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
      title={<Typography.Title level={4} style={{ margin: 0 }}>Zavodlar</Typography.Title>}
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="Qidirish..."
            onSearch={setSearch}
            onChange={(e) => !e.target.value && setSearch('')}
            style={{ width: 220 }}
          />
          {canEdit && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Yangi zavod
            </Button>
          )}
        </Space>
      }
    >
      <div className="scroll-x">
        <Table<FactoryRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={listQ.isFetching}
          pagination={{ showSizeChanger: true, defaultPageSize: 20 }}
          size="middle"
        />
      </div>

      <Modal
        title={editing ? 'Zavodni tahrirlash' : 'Yangi zavod'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.validateFields().then((vals) => save.mutate(vals))}
        okText="Saqlash"
        cancelText="Bekor qilish"
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="Nomi"
            rules={[{ required: true, message: 'Nomi majburiy' }, { max: 200 }]}
          >
            <Input placeholder="Zavod nomi" />
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
