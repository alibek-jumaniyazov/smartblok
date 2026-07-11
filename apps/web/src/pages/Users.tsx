import { useState } from 'react';
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
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import type { Role } from '../lib/types';

const ROLE: Record<Role, { label: string; color: string }> = {
  ADMIN: { label: 'Administrator', color: 'magenta' },
  ACCOUNTANT: { label: 'Buxgalter', color: 'blue' },
  AGENT: { label: 'Agent', color: 'green' },
  CASHIER: { label: 'Kassir', color: 'gold' },
};

/** SAFE_SELECT shape from UsersService */
interface UserRow {
  id: string;
  username: string;
  email: string | null;
  name: string;
  role: Role;
  phone: string | null;
  active: boolean;
  agentId: string | null;
  agent: { id: string; name: string } | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserFormValues {
  username: string;
  name: string;
  role: Role;
  agentId?: string;
  email?: string;
  phone?: string;
  password?: string;
  active?: boolean;
}

export default function Users() {
  const { message, modal } = App.useApp();
  const { user: me } = useAuth();
  const qc = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form] = Form.useForm<UserFormValues>();
  const roleWatch = Form.useWatch('role', form);

  const listQ = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await endpoints.users()) as unknown as UserRow[],
  });
  const agentsQ = useQuery({
    queryKey: ['agents'],
    queryFn: () => endpoints.agents(),
  });
  const agents = asItems(agentsQ.data);

  const save = useMutation({
    mutationFn: (vals: UserFormValues) => {
      const base: Record<string, unknown> = {
        username: vals.username,
        name: vals.name,
        role: vals.role,
        email: vals.email || undefined,
        phone: vals.phone || undefined,
        agentId: vals.role === 'AGENT' ? vals.agentId : editing ? null : undefined,
      };
      if (editing) {
        if (vals.password) base.password = vals.password;
        if (vals.active !== undefined) base.active = vals.active;
        return endpoints.updateUser(editing.id, base);
      }
      base.password = vals.password;
      return endpoints.createUser(base);
    },
    onSuccess: () => {
      message.success(editing ? 'Foydalanuvchi yangilandi' : 'Foydalanuvchi yaratildi');
      qc.invalidateQueries({ queryKey: ['users'] });
      setModalOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => endpoints.deleteUser(id),
    onSuccess: () => {
      message.success('Foydalanuvchi bloklandi, sessiyalari bekor qilindi');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ role: 'AGENT' });
    setModalOpen(true);
  };
  const openEdit = (row: UserRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      username: row.username,
      name: row.name,
      role: row.role,
      agentId: row.agentId ?? undefined,
      email: row.email ?? '',
      phone: row.phone ?? '',
      active: row.active,
      password: '',
    });
    setModalOpen(true);
  };

  const confirmDeactivate = (row: UserRow) => {
    modal.confirm({
      title: 'Foydalanuvchini bloklash',
      content: `"${row.name}" (${row.username}) bloklanadi va barcha faol sessiyalari darhol bekor qilinadi. Hisob o'chirilmaydi — keyin qayta yoqish mumkin.`,
      okText: 'Bloklash',
      okButtonProps: { danger: true },
      cancelText: 'Bekor qilish',
      onOk: () => deactivate.mutateAsync(row.id),
    });
  };

  const columns: TableColumnsType<UserRow> = [
    { title: 'Login', dataIndex: 'username', key: 'username' },
    { title: 'Ism', dataIndex: 'name', key: 'name' },
    {
      title: 'Rol',
      dataIndex: 'role',
      key: 'role',
      render: (v: Role) => <Tag color={ROLE[v]?.color}>{ROLE[v]?.label ?? v}</Tag>,
    },
    { title: 'Agent', key: 'agent', render: (_: unknown, r) => r.agent?.name ?? '—' },
    { title: 'Telefon', dataIndex: 'phone', key: 'phone', render: (v: string | null) => v || '—' },
    {
      title: 'Holat',
      dataIndex: 'active',
      key: 'active',
      render: (v: boolean) => (v ? <Tag color="green">Faol</Tag> : <Tag color="red">Bloklangan</Tag>),
    },
    {
      title: 'Oxirgi kirish',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      render: (v: string | null) => fmtDateTime(v),
    },
    {
      title: 'Amallar',
      key: 'actions',
      width: 140,
      render: (_: unknown, row) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          {row.active && row.id !== me?.id && (
            <Button size="small" danger icon={<StopOutlined />} onClick={() => confirmDeactivate(row)} />
          )}
        </Space>
      ),
    },
  ];

  if (listQ.error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Foydalanuvchilarni yuklashda xatolik"
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
      title={<Typography.Title level={4} style={{ margin: 0 }}>Foydalanuvchilar</Typography.Title>}
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Yangi foydalanuvchi
        </Button>
      }
    >
      <div className="scroll-x">
        <Table<UserRow>
          rowKey="id"
          columns={columns}
          dataSource={listQ.data ?? []}
          loading={listQ.isFetching}
          pagination={{ showSizeChanger: true, defaultPageSize: 20 }}
          size="middle"
        />
      </div>

      <Modal
        title={editing ? 'Foydalanuvchini tahrirlash' : 'Yangi foydalanuvchi'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.validateFields().then((vals) => save.mutate(vals))}
        okText="Saqlash"
        cancelText="Bekor qilish"
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="username"
            label="Login"
            rules={[
              { required: true, message: 'Login majburiy' },
              { min: 3, max: 32, message: '3–32 belgi' },
              {
                pattern: /^[a-zA-Z0-9]+$/,
                message: 'Faqat lotin harflari va raqamlar',
              },
            ]}
          >
            <Input placeholder="masalan botir1" autoComplete="off" />
          </Form.Item>
          <Form.Item name="name" label="Ism" rules={[{ required: true, message: 'Ism majburiy' }, { max: 128 }]}>
            <Input placeholder="To'liq ism" />
          </Form.Item>
          <Form.Item name="role" label="Rol" rules={[{ required: true, message: 'Rolni tanlang' }]}>
            <Select
              options={(Object.keys(ROLE) as Role[]).map((r) => ({ value: r, label: ROLE[r].label }))}
            />
          </Form.Item>
          {roleWatch === 'AGENT' && (
            <Form.Item
              name="agentId"
              label="Agent"
              rules={[{ required: true, message: 'AGENT roli uchun agent majburiy' }]}
              extra="Bu foydalanuvchi qaysi agent nomidan ishlaydi"
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Agentni tanlang"
                loading={agentsQ.isFetching}
                options={agents.map((a) => ({ value: a.id, label: a.name }))}
              />
            </Form.Item>
          )}
          <Form.Item
            name="password"
            label={editing ? 'Yangi parol (almashtirish uchun)' : 'Parol'}
            rules={
              editing
                ? [{ min: 8, message: 'Kamida 8 belgi' }]
                : [
                    { required: true, message: 'Parol majburiy' },
                    { min: 8, message: 'Kamida 8 belgi' },
                  ]
            }
            extra={
              editing
                ? "Bo'sh qoldirsangiz parol o'zgarmaydi. Almashtirilsa, foydalanuvchi sessiyalari bekor qilinadi."
                : 'Kamida 8 belgi'
            }
          >
            <Input.Password placeholder={editing ? 'Almashtirish uchun kiriting' : 'Parol'} autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ type: 'email', message: "Email noto'g'ri" }]}>
            <Input placeholder="ixtiyoriy" />
          </Form.Item>
          <Form.Item name="phone" label="Telefon" rules={[{ max: 32 }]}>
            <Input placeholder="+998 ..." />
          </Form.Item>
          {editing && (
            <Form.Item
              name="active"
              label="Faol"
              valuePropName="checked"
              extra="O'chirilsa foydalanuvchi tizimga kira olmaydi (sessiyalari bekor qilinadi)"
            >
              <Switch disabled={editing.id === me?.id} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
