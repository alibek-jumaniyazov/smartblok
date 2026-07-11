import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
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
import type { ColumnsType } from 'antd/es/table';
import { EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiError, asItems, endpoints } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { fmtMoney, num } from '../lib/format';
import type { Agent, Money as MoneyStr } from '../lib/types';

interface AgentRow extends Agent {
  /** agent's own limit (null = falls back to the global default) — for the edit form */
  ownDebtLimit?: MoneyStr | null;
}

interface AgentFormValues {
  name: string;
  phone?: string | null;
  sortNo?: number | null;
  active: boolean;
  debtLimit?: number | string | null;
}

type ModalState = { mode: 'create' } | { mode: 'edit'; row: AgentRow } | null;

const moneyFormatter = (v: string | number | undefined) =>
  `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => (v ?? '').replace(/\s/g, '');

export default function Agents() {
  const { message } = App.useApp();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const isAdmin = hasRole('ADMIN');

  const [modalState, setModalState] = useState<ModalState>(null);
  const [form] = Form.useForm<AgentFormValues>();

  const q = useQuery({ queryKey: ['agents'], queryFn: () => endpoints.agents() });
  const rows = asItems(q.data) as AgentRow[];

  const toPayload = (v: AgentFormValues) => ({
    name: v.name,
    phone: v.phone ?? null,
    sortNo: v.sortNo ?? null,
    active: v.active,
    ...(isAdmin
      ? { debtLimit: v.debtLimit === undefined || v.debtLimit === null || v.debtLimit === '' ? null : v.debtLimit }
      : {}),
  });

  const saveMut = useMutation({
    mutationFn: (v: AgentFormValues) =>
      modalState?.mode === 'edit'
        ? endpoints.updateAgent(modalState.row.id, toPayload(v))
        : endpoints.createAgent(toPayload(v)),
    onSuccess: () => {
      message.success(modalState?.mode === 'edit' ? 'Agent yangilandi' : "Agent qo'shildi");
      qc.invalidateQueries({ queryKey: ['agents'] });
      setModalState(null);
    },
    onError: (err) => message.error(apiError(err)),
  });

  const columns: ColumnsType<AgentRow> = [
    {
      title: 'Nomi',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, a) => <Link to={`/agents/${a.id}`}>{v}</Link>,
    },
    { title: 'Telefon', dataIndex: 'phone', key: 'phone', render: (v: string | null) => v || '—' },
    {
      title: 'Mijozlar',
      dataIndex: 'clientCount',
      key: 'clientCount',
      align: 'center',
      render: (v: number | undefined) => v ?? 0,
    },
    {
      title: 'Ochiq qarz',
      dataIndex: 'outstandingDebt',
      key: 'outstandingDebt',
      align: 'right',
      render: (v: MoneyStr | undefined) => (
        <Typography.Text
          type={num(v) > 0 ? 'danger' : undefined}
          style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        >
          {fmtMoney(v)}
        </Typography.Text>
      ),
    },
    {
      title: 'Qarz limiti',
      dataIndex: 'debtLimit',
      key: 'debtLimit',
      align: 'right',
      render: (v: MoneyStr | null | undefined) =>
        v == null ? (
          <Typography.Text type="secondary">Cheklanmagan</Typography.Text>
        ) : num(v) === 0 ? (
          <Tag color="red">0 — bloklangan</Tag>
        ) : (
          <span className="num">{fmtMoney(v)}</span>
        ),
    },
    {
      title: 'Holati',
      dataIndex: 'active',
      key: 'active',
      align: 'center',
      render: (v: boolean) => (v ? <Tag color="green">Faol</Tag> : <Tag color="red">Nofaol</Tag>),
    },
    {
      title: 'Amallar',
      key: 'actions',
      width: 90,
      render: (_, a) => (
        <Button
          size="small"
          icon={<EditOutlined />}
          title="Tahrirlash"
          onClick={() => setModalState({ mode: 'edit', row: a })}
        />
      ),
    },
  ];

  const editing = modalState?.mode === 'edit' ? modalState.row : null;

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Agentlar
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalState({ mode: 'create' })}>
          Yangi agent
        </Button>
      </Space>

      {q.error ? (
        <Alert
          type="error"
          showIcon
          message="Agentlarni yuklashda xatolik"
          description={apiError(q.error)}
          action={
            <Button icon={<ReloadOutlined />} onClick={() => q.refetch()}>
              Qayta urinish
            </Button>
          }
        />
      ) : (
        <Table<AgentRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={q.isFetching}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
        />
      )}

      <Modal
        title={editing ? 'Agentni tahrirlash' : 'Yangi agent'}
        open={!!modalState}
        onCancel={() => setModalState(null)}
        onOk={() => form.submit()}
        okText="Saqlash"
        cancelText="Bekor qilish"
        confirmLoading={saveMut.isPending}
        destroyOnHidden
      >
        {modalState && (
          <Form
            key={editing ? editing.id : 'create'}
            form={form}
            layout="vertical"
            onFinish={(v) => saveMut.mutate(v)}
            initialValues={
              editing
                ? {
                    name: editing.name,
                    phone: editing.phone ?? undefined,
                    sortNo: editing.sortNo ?? undefined,
                    active: editing.active,
                    debtLimit: editing.ownDebtLimit != null ? num(editing.ownDebtLimit) : undefined,
                  }
                : { active: true }
            }
          >
            <Form.Item name="name" label="Nomi" rules={[{ required: true, message: 'Nomi majburiy' }]}>
              <Input placeholder="Agent nomi" />
            </Form.Item>
            <Form.Item name="phone" label="Telefon">
              <Input placeholder="+998 ..." />
            </Form.Item>
            <Form.Item name="sortNo" label="Tartib raqami" extra="Faqat ro'yxatdagi tartib uchun">
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="active" label="Faol" valuePropName="checked">
              <Switch />
            </Form.Item>
            {isAdmin && (
              <Form.Item
                name="debtLimit"
                label="Qarz limiti"
                extra="null = umumiy limit, 0 = yangi buyurtmalar bloklanadi"
              >
                <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFormatter} parser={moneyParser} />
              </Form.Item>
            )}
          </Form>
        )}
      </Modal>
    </div>
  );
}
