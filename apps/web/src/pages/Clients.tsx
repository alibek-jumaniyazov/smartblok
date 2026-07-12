// Mijozlar — ro'yxat + yaratish/tahrirlash. Balans (qarz qizil / avans yashil),
// kredit limiti, agent bog'lanishi, paddon qoldig'i.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EditOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { apiError, asItems, endpoints } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { fmtMoney, num } from '../lib/format';
import { BalanceTag, ErrorState, PageHeader, PalletChip, StatusChip, TableCard } from '../components';
import type { StatusMeta } from '../lib/status-maps';
import type { Agent, ClientRow } from '../lib/types';

interface ClientFormValues {
  name: string;
  phone?: string | null;
  agentId?: string | null;
  creditLimit?: number | string | null;
  paymentTermDays?: number | null;
}

const moneyFormatter = (v: string | number | undefined) =>
  `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => (v ?? '').replace(/\s/g, '');

/** Nofaol mijoz belgisi — neytral StatusChip (enum bo'lmagan holat, label-only meta). */
const INACTIVE_META: StatusMeta = { label: 'Nofaol' };

function ClientFormFields({ office, agents }: { office: boolean; agents: Agent[] }) {
  return (
    <>
      <Form.Item name="name" label="Nomi" rules={[{ required: true, message: 'Nomi majburiy' }]}>
        <Input placeholder="Mijoz nomi" />
      </Form.Item>
      <Form.Item name="phone" label="Telefon">
        <Input placeholder="+998 ..." />
      </Form.Item>
      {office && (
        <Form.Item name="agentId" label="Agent">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Agent tanlang"
            options={agents.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Form.Item>
      )}
      {office && (
        <Form.Item
          name="creditLimit"
          label="Kredit limiti"
          extra="Bo'sh — cheklanmagan; 0 — faqat oldindan to'lov"
        >
          <InputNumber min={0} style={{ width: '100%' }} formatter={moneyFormatter} parser={moneyParser} />
        </Form.Item>
      )}
      {office && (
        <Form.Item name="paymentTermDays" label="To'lov muddati (kun)">
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      )}
    </>
  );
}

export default function Clients() {
  const { message, modal } = App.useApp();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const office = hasRole('ADMIN', 'ACCOUNTANT');
  const isAdmin = hasRole('ADMIN');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<ClientRow | null>(null);
  const [createForm] = Form.useForm<ClientFormValues>();
  const [editForm] = Form.useForm<ClientFormValues>();

  const clientsQ = useQuery({
    queryKey: ['clients', 'list', page, pageSize, search],
    queryFn: () => endpoints.clients({ page, pageSize, search: search || undefined }),
  });
  const agentsQ = useQuery({
    queryKey: ['agents'],
    queryFn: () => endpoints.agents(),
    enabled: office, // /agents is ADMIN/ACCOUNTANT-only
  });
  const agents = asItems(agentsQ.data);

  const lookupsAlert = office && agentsQ.error ? (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 12 }}
      message="Agentlarni yuklashda xatolik"
      description={apiError(agentsQ.error)}
      action={
        <Button size="small" icon={<ReloadOutlined />} onClick={() => agentsQ.refetch()}>
          Qayta urinish
        </Button>
      }
    />
  ) : null;

  const toPayload = (v: ClientFormValues) => ({
    name: v.name,
    phone: v.phone ?? null,
    ...(office
      ? {
          agentId: v.agentId ?? null,
          creditLimit: v.creditLimit === undefined || v.creditLimit === null || v.creditLimit === '' ? null : v.creditLimit,
          paymentTermDays: v.paymentTermDays ?? null,
        }
      : {}),
  });

  const createMut = useMutation({
    mutationFn: (v: ClientFormValues) => endpoints.createClient(toPayload(v)),
    onSuccess: () => {
      message.success("Mijoz qo'shildi");
      qc.invalidateQueries({ queryKey: ['clients'] });
      setCreateOpen(false);
      createForm.resetFields();
    },
    onError: (err) => message.error(apiError(err)),
  });

  const updateMut = useMutation({
    mutationFn: (v: ClientFormValues) => endpoints.updateClient(editRow!.id, toPayload(v)),
    onSuccess: () => {
      message.success('Mijoz yangilandi');
      qc.invalidateQueries({ queryKey: ['clients'] });
      setEditRow(null);
    },
    onError: (err) => message.error(apiError(err)),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => endpoints.deleteClient(id),
    onSuccess: () => {
      message.success('Mijoz nofaol holatga o‘tkazildi');
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => message.error(apiError(err)),
  });

  const confirmDeactivate = (c: ClientRow) => {
    modal.confirm({
      title: 'Mijozni nofaol qilish',
      content: `"${c.name}" nofaol holatga o'tkaziladi. Buning uchun mijoz balansi nolga teng bo'lishi shart.`,
      okText: 'Nofaol qilish',
      okButtonProps: { danger: true },
      cancelText: 'Bekor qilish',
      onOk: () => deactivateMut.mutateAsync(c.id),
    });
  };

  const columns: ColumnsType<ClientRow> = [
    {
      title: 'Nomi',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      ellipsis: true,
      render: (_, c) => (
        <Space>
          <Link to={`/clients/${c.id}`} style={{ fontWeight: 600 }}>{c.name}</Link>
          {!c.active && <StatusChip meta={INACTIVE_META} />}
        </Space>
      ),
    },
    { title: 'Agent', key: 'agent', width: 160, ellipsis: true, render: (_, c) => c.agent?.name ?? '—' },
    { title: 'Telefon', dataIndex: 'phone', key: 'phone', width: 150, ellipsis: true, render: (v: string | null) => v || '—' },
    {
      title: 'Balans',
      key: 'balance',
      align: 'right',
      render: (_, c) => <BalanceTag balance={c.balance ?? '0'} partyType="client" compact />,
    },
    {
      title: 'Paddon',
      key: 'palletBalance',
      align: 'center',
      render: (_, c) => ((c.palletBalance ?? 0) > 0 ? <PalletChip pallets={c.palletBalance ?? 0} compact /> : '—'),
    },
    {
      title: 'Kredit limiti',
      key: 'creditLimit',
      align: 'right',
      render: (_, c) =>
        c.creditLimit == null ? (
          <Typography.Text type="secondary">Cheklanmagan</Typography.Text>
        ) : (
          <span className="num">{fmtMoney(c.creditLimit)}</span>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      align: 'right',
      render: (_, c) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} title="Tahrirlash" onClick={() => setEditRow(c)} />
          {isAdmin && c.active && (
            <Button size="small" danger icon={<StopOutlined />} title="Nofaol qilish" onClick={() => confirmDeactivate(c)} />
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Mijozlar"
        actions={[
          { key: 'new', label: 'Yangi mijoz', primary: true, icon: <PlusOutlined />, onClick: () => setCreateOpen(true) },
        ]}
      />

      <TableCard
        title="Mijozlar"
        loading={clientsQ.isFetching}
        toolbar={
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Input.Search
              allowClear
              placeholder="Qidirish (nomi, telefon, taxallus)"
              style={{ width: 300, maxWidth: '100%' }}
              onSearch={(v) => {
                setSearch(v.trim());
                setPage(1);
              }}
            />
          </div>
        }
      >
        {clientsQ.error ? (
          <ErrorState
            error={clientsQ.error}
            onRetry={() => clientsQ.refetch()}
            message="Mijozlarni yuklashda xatolik"
          />
        ) : (
          <Table<ClientRow>
            rowKey="id"
            columns={columns}
            dataSource={clientsQ.data?.items}
            loading={clientsQ.isFetching}
            scroll={{ x: 'max-content' }}
            pagination={{
              current: page,
              pageSize,
              total: clientsQ.data?.total ?? 0,
              showSizeChanger: true,
              showTotal: (t) => `Jami: ${t}`,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
            }}
          />
        )}
      </TableCard>

      <Drawer
        title="Yangi mijoz"
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        width={440}
        extra={
          <Button type="primary" loading={createMut.isPending} onClick={() => createForm.submit()}>
            Saqlash
          </Button>
        }
      >
        {lookupsAlert}
        <Form form={createForm} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <ClientFormFields office={office} agents={agents} />
        </Form>
      </Drawer>

      <Drawer
        title="Mijozni tahrirlash"
        open={!!editRow}
        onClose={() => setEditRow(null)}
        width={420}
        extra={
          <Button type="primary" loading={updateMut.isPending} onClick={() => editForm.submit()}>
            Saqlash
          </Button>
        }
      >
        {lookupsAlert}
        {editRow && (
          <Form
            key={editRow.id}
            form={editForm}
            layout="vertical"
            onFinish={(v) => updateMut.mutate(v)}
            initialValues={{
              name: editRow.name,
              phone: editRow.phone ?? undefined,
              agentId: editRow.agentId ?? editRow.agent?.id ?? undefined,
              creditLimit: editRow.creditLimit != null ? num(editRow.creditLimit) : undefined,
              paymentTermDays: editRow.paymentTermDays ?? undefined,
            }}
          >
            <ClientFormFields office={office} agents={agents} />
          </Form>
        )}
      </Drawer>
    </div>
  );
}
