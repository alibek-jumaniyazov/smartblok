import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { apiError, endpoints } from '../lib/api';
import { fmtDate, fmtMoney } from '../lib/format';
import { Money } from '../components/Money';
import { useAuth } from '../auth/AuthContext';
import type { Expense, Paged } from '../lib/types';

const { RangePicker } = DatePicker;

interface ExpenseRow extends Expense {
  voidReason?: string | null;
  createdBy?: { id: string; name: string } | null;
}

interface ExpenseFormVals {
  date: Dayjs;
  amount: number;
  categoryId?: string;
  cashboxId: string;
  note?: string;
}

const moneyFormatter = (v: string | number | undefined) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => Number((v ?? '').replace(/\s/g, ''));

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Alert
      type="error"
      showIcon
      message="Ma'lumotni yuklab bo'lmadi"
      description={apiError(error)}
      action={
        <Button size="small" danger onClick={onRetry}>
          Qayta urinish
        </Button>
      }
    />
  );
}

/** voided rows render struck-through */
function struck(r: ExpenseRow, node: ReactNode): ReactNode {
  return r.voidedAt ? <span style={{ textDecoration: 'line-through', opacity: 0.55 }}>{node}</span> : node;
}

export default function Expenses() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canCreate = hasRole('ADMIN', 'ACCOUNTANT', 'CASHIER');
  const canVoid = hasRole('ADMIN', 'ACCOUNTANT');
  const canManageCategories = hasRole('ADMIN', 'ACCOUNTANT');

  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [cashboxId, setCashboxId] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [search, setSearch] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<ExpenseFormVals>();

  const [catOpen, setCatOpen] = useState(false);
  const [catName, setCatName] = useState('');

  useEffect(() => {
    if (createOpen) {
      form.resetFields();
      form.setFieldsValue({ date: dayjs() });
    }
  }, [createOpen, form]);

  const categoriesQ = useQuery({ queryKey: ['expenses', 'categories'], queryFn: () => endpoints.expenseCategories() });
  const boxesQ = useQuery({ queryKey: ['kassa', 'cashboxes'], queryFn: () => endpoints.cashboxes() });

  const listParams = {
    page,
    pageSize,
    search,
    categoryId,
    cashboxId,
    dateFrom: range?.[0]?.format('YYYY-MM-DD'),
    dateTo: range?.[1]?.format('YYYY-MM-DD'),
    includeVoided: 'true',
  };
  const listQ = useQuery({
    queryKey: ['expenses', 'list', listParams],
    queryFn: () => endpoints.expenses(listParams) as Promise<Paged<ExpenseRow>>,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['expenses'] });
    qc.invalidateQueries({ queryKey: ['kassa'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const createMut = useMutation({
    mutationFn: (d: object) => endpoints.createExpense(d),
    onSuccess: () => {
      message.success('Xarajat saqlandi');
      invalidate();
      setCreateOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const voidMut = useMutation({
    mutationFn: (d: { id: string; reason: string }) => endpoints.voidExpense(d.id, d.reason),
    onSuccess: () => {
      message.success('Xarajat bekor qilindi');
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const catMut = useMutation({
    mutationFn: (name: string) => endpoints.createExpenseCategory({ name }),
    onSuccess: (res) => {
      message.success("Kategoriya qo'shildi");
      qc.invalidateQueries({ queryKey: ['expenses'] });
      const id = (res as { id?: string } | null)?.id;
      if (id && createOpen) form.setFieldValue('categoryId', id);
      setCatOpen(false);
      setCatName('');
    },
    onError: (e) => message.error(apiError(e)),
  });

  const askVoid = (row: ExpenseRow) => {
    let reason = '';
    modal.confirm({
      title: 'Xarajatni bekor qilish',
      content: (
        <div>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            {fmtDate(row.date)} — {fmtMoney(row.amount)} so'm ({row.category?.name ?? 'kategoriyasiz'}). Kassaga
            qaytarish (storno) yozuvi yaratiladi.
          </Typography.Paragraph>
          <Input.TextArea
            rows={3}
            placeholder="Sabab (majburiy)"
            onChange={(e) => {
              reason = e.target.value;
            }}
          />
        </div>
      ),
      okText: 'Bekor qilish',
      okButtonProps: { danger: true },
      cancelText: 'Yopish',
      onOk: () => {
        if (!reason.trim()) {
          message.warning('Sababni kiritish majburiy');
          return Promise.reject(new Error('reason required'));
        }
        return voidMut.mutateAsync({ id: row.id, reason: reason.trim() });
      },
    });
  };

  const submitCreate = (v: ExpenseFormVals) => {
    createMut.mutate({
      date: v.date.format('YYYY-MM-DD'),
      amount: v.amount,
      categoryId: v.categoryId || undefined,
      cashboxId: v.cashboxId,
      note: v.note?.trim() ? v.note.trim() : undefined,
    });
  };

  const categories = categoriesQ.data ?? [];
  const catOptions = categories.map((c) => ({ value: c.id, label: c.name }));
  const boxes = boxesQ.data ?? [];
  const uzsActiveBoxes = boxes.filter((b) => b.active && b.currency === 'UZS');

  const columns: TableProps<ExpenseRow>['columns'] = [
    { title: 'Sana', dataIndex: 'date', width: 110, render: (v: string, r) => struck(r, fmtDate(v)) },
    {
      title: 'Kategoriya',
      key: 'category',
      render: (_, r) => struck(r, r.category?.name ? <Tag>{r.category.name}</Tag> : '—'),
    },
    {
      title: 'Summa',
      dataIndex: 'amount',
      align: 'right',
      width: 160,
      render: (v: string, r) => struck(r, <Money value={v} strong suffix="so'm" />),
    },
    { title: 'Kassa', key: 'cashbox', render: (_, r) => struck(r, r.cashbox?.name ?? '—') },
    { title: 'Izoh', dataIndex: 'note', ellipsis: true, render: (v: string | null, r) => struck(r, v || '—') },
    {
      title: 'Holat',
      key: 'status',
      width: 130,
      render: (_, r) =>
        r.voidedAt ? (
          <Tooltip title={r.voidReason || undefined}>
            <Tag color="red">Bekor qilingan</Tag>
          </Tooltip>
        ) : (
          <Tag color="green">Faol</Tag>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 130,
      render: (_, r) =>
        canVoid && !r.voidedAt ? (
          <Button size="small" danger icon={<StopOutlined />} onClick={() => askVoid(r)}>
            Bekor qilish
          </Button>
        ) : null,
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ display: 'flex' }}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Xarajatlar
        </Typography.Title>
        {canCreate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Yangi xarajat
          </Button>
        )}
      </Flex>

      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search
            allowClear
            placeholder="Izoh bo'yicha qidirish"
            style={{ width: 240 }}
            onSearch={(v) => {
              setSearch(v || undefined);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="Kategoriya"
            style={{ minWidth: 180 }}
            options={catOptions}
            value={categoryId}
            onChange={(v) => {
              setCategoryId(v);
              setPage(1);
            }}
            showSearch
            optionFilterProp="label"
          />
          <Select
            allowClear
            placeholder="Kassa"
            style={{ minWidth: 180 }}
            options={boxes.map((b) => ({ value: b.id, label: `${b.name} (${b.currency})` }))}
            value={cashboxId}
            onChange={(v) => {
              setCashboxId(v);
              setPage(1);
            }}
            showSearch
            optionFilterProp="label"
          />
          <RangePicker
            value={range}
            onChange={(v) => {
              setRange(v);
              setPage(1);
            }}
          />
        </Space>
        {listQ.isError ? (
          <LoadError error={listQ.error} onRetry={() => listQ.refetch()} />
        ) : (
          <Table<ExpenseRow>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={listQ.data?.items ?? []}
            loading={listQ.isFetching}
            scroll={{ x: 900 }}
            pagination={{
              current: page,
              pageSize,
              total: listQ.data?.total ?? 0,
              showSizeChanger: true,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
            }}
          />
        )}
      </Card>

      <Modal
        title="Yangi xarajat"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="Saqlash"
        cancelText="Bekor qilish"
        confirmLoading={createMut.isPending}
      >
        <Form form={form} layout="vertical" onFinish={submitCreate}>
          <Form.Item name="date" label="Sana" rules={[{ required: true, message: 'Sanani tanlang' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="amount" label="Summa" rules={[{ required: true, message: 'Summani kiriting' }]}>
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              formatter={moneyFormatter}
              parser={moneyParser}
              placeholder="0"
            />
          </Form.Item>
          <Form.Item label="Kategoriya">
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="categoryId" noStyle>
                <Select
                  allowClear
                  placeholder="Kategoriya (ixtiyoriy)"
                  options={catOptions}
                  showSearch
                  optionFilterProp="label"
                  style={{ width: '100%' }}
                />
              </Form.Item>
              {canManageCategories && (
                <Tooltip title="Yangi kategoriya qo'shish">
                  <Button icon={<PlusOutlined />} onClick={() => setCatOpen(true)} />
                </Tooltip>
              )}
            </Space.Compact>
          </Form.Item>
          <Form.Item
            name="cashboxId"
            label="Kassa (faqat UZS)"
            rules={[{ required: true, message: 'Kassani tanlang' }]}
          >
            <Select
              placeholder="Kassani tanlang"
              options={uzsActiveBoxes.map((b) => ({ value: b.id, label: b.name }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="note" label="Izoh">
            <Input.TextArea rows={2} placeholder="Izoh (ixtiyoriy)" maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Yangi kategoriya"
        open={catOpen}
        onCancel={() => {
          setCatOpen(false);
          setCatName('');
        }}
        onOk={() => {
          if (!catName.trim()) {
            message.warning('Kategoriya nomini kiriting');
            return;
          }
          catMut.mutate(catName.trim());
        }}
        okText="Qo'shish"
        cancelText="Bekor qilish"
        confirmLoading={catMut.isPending}
      >
        <Input
          placeholder="Kategoriya nomi"
          value={catName}
          maxLength={200}
          onChange={(e) => setCatName(e.target.value)}
          onPressEnter={() => {
            if (catName.trim()) catMut.mutate(catName.trim());
          }}
        />
      </Modal>
    </Space>
  );
}
