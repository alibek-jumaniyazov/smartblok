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
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EditOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { apiError, asItems, endpoints } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { fmtMoney, isSettled, num } from '../lib/format';
import type { Agent, ClientRow, Region } from '../lib/types';

interface ClientFormValues {
  name: string;
  phone?: string | null;
  regionId?: string | null;
  agentId?: string | null;
  creditLimit?: number | string | null;
  paymentTermDays?: number | null;
}

const moneyFormatter = (v: string | number | undefined) =>
  `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => (v ?? '').replace(/\s/g, '');

/** Backend convention: positive balance = mijoz bizdan qarzdor (qizil), manfiy = avans (yashil). */
function BalanceCell({ value }: { value?: string | number | null }) {
  if (isSettled(value)) return <Typography.Text type="secondary">—</Typography.Text>;
  const v = num(value);
  const debt = v > 0;
  return (
    <Typography.Text
      type={debt ? 'danger' : 'success'}
      style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
    >
      {fmtMoney(Math.abs(v))} {debt ? 'Qarz' : 'Avans'}
    </Typography.Text>
  );
}

function ClientFormFields({ office, regions, agents }: { office: boolean; regions: Region[]; agents: Agent[] }) {
  return (
    <>
      <Form.Item name="name" label="Nomi" rules={[{ required: true, message: 'Nomi majburiy' }]}>
        <Input placeholder="Mijoz nomi" />
      </Form.Item>
      <Form.Item name="phone" label="Telefon">
        <Input placeholder="+998 ..." />
      </Form.Item>
      <Form.Item name="regionId" label="Hudud">
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Hudud tanlang"
          options={regions.map((r) => ({ value: r.id, label: r.name }))}
        />
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
  const regionsQ = useQuery({ queryKey: ['regions'], queryFn: () => endpoints.regions() });
  const agentsQ = useQuery({
    queryKey: ['agents'],
    queryFn: () => endpoints.agents(),
    enabled: office, // /agents is ADMIN/ACCOUNTANT-only
  });
  const regions = regionsQ.data ?? [];
  const agents = asItems(agentsQ.data);

  const lookupsError = regionsQ.error ?? (office ? agentsQ.error : null);
  const lookupsAlert = lookupsError ? (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 12 }}
      message="Ma'lumotnomalarni yuklashda xatolik"
      description={apiError(lookupsError)}
      action={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => {
            regionsQ.refetch();
            if (office) agentsQ.refetch();
          }}
        >
          Qayta urinish
        </Button>
      }
    />
  ) : null;

  const toPayload = (v: ClientFormValues) => ({
    name: v.name,
    phone: v.phone ?? null,
    regionId: v.regionId ?? null,
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
      render: (_, c) => (
        <Space>
          <Link to={`/clients/${c.id}`}>{c.name}</Link>
          {!c.active && <Tag>Nofaol</Tag>}
        </Space>
      ),
    },
    { title: 'Hudud', key: 'region', render: (_, c) => c.region?.name ?? '—' },
    { title: 'Agent', key: 'agent', render: (_, c) => c.agent?.name ?? '—' },
    { title: 'Telefon', dataIndex: 'phone', key: 'phone', render: (v: string | null) => v || '—' },
    {
      title: 'Balans',
      key: 'balance',
      align: 'right',
      render: (_, c) => <BalanceCell value={c.balance} />,
    },
    {
      title: 'Paddon',
      key: 'palletBalance',
      align: 'center',
      render: (_, c) => ((c.palletBalance ?? 0) > 0 ? <Tag color="orange">{c.palletBalance} dona</Tag> : '—'),
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
      title: 'Amallar',
      key: 'actions',
      width: 100,
      render: (_, c) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            title="Tahrirlash"
            onClick={() => setEditRow(c)}
          />
          {isAdmin && c.active && (
            <Button
              size="small"
              danger
              icon={<StopOutlined />}
              title="Nofaol qilish"
              onClick={() => confirmDeactivate(c)}
            />
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Mijozlar
        </Typography.Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Qidirish (nomi, telefon, taxallus)"
            style={{ width: 280 }}
            onSearch={(v) => {
              setSearch(v.trim());
              setPage(1);
            }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Yangi mijoz
          </Button>
        </Space>
      </Space>

      {clientsQ.error ? (
        <Alert
          type="error"
          showIcon
          message="Mijozlarni yuklashda xatolik"
          description={apiError(clientsQ.error)}
          action={
            <Button icon={<ReloadOutlined />} onClick={() => clientsQ.refetch()}>
              Qayta urinish
            </Button>
          }
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

      <Modal
        title="Yangi mijoz"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        onOk={() => createForm.submit()}
        okText="Saqlash"
        cancelText="Bekor qilish"
        confirmLoading={createMut.isPending}
      >
        {lookupsAlert}
        <Form form={createForm} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <ClientFormFields office={office} regions={regions} agents={agents} />
        </Form>
      </Modal>

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
              regionId: editRow.regionId ?? editRow.region?.id ?? undefined,
              agentId: editRow.agentId ?? editRow.agent?.id ?? undefined,
              creditLimit: editRow.creditLimit != null ? num(editRow.creditLimit) : undefined,
              paymentTermDays: editRow.paymentTermDays ?? undefined,
            }}
          >
            <ClientFormFields office={office} regions={regions} agents={agents} />
          </Form>
        )}
      </Drawer>
    </div>
  );
}
