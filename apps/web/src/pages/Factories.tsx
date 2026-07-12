import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Radio,
  Space,
  Switch,
  Table,
  theme,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { EditOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtNum } from '../lib/format';
import { BalanceTag, FormDrawer, MoneyCell, StatusChip, TableCard } from '../components';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../auth/AuthContext';
import type { Factory } from '../lib/types';

/** list rows carry ledger balance + bonus wallet + pallet accountability (FIN roles) */
type FactoryRow = Factory & { balance?: string; bonusBalance?: string; palletsHeld?: number };

type BonusKind = 'NONE' | 'PER_M3' | 'PERCENT';
interface FactoryFormValues {
  name: string;
  note?: string;
  active?: boolean;
  // faqat yaratishda — boshlang'ich bonus dasturi
  bonusKind?: BonusKind;
  bonusRatePerM3?: number;
  bonusPercent?: number;
}

export default function Factories() {
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
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
    mutationFn: (vals: FactoryFormValues) => {
      if (editing) {
        return endpoints.updateFactory(editing.id, { name: vals.name, note: vals.note ?? null, active: vals.active });
      }
      const kind = vals.bonusKind ?? 'NONE';
      return endpoints.createFactory({
        name: vals.name,
        note: vals.note ?? null,
        ...(kind !== 'NONE'
          ? {
              bonusKind: kind,
              ...(kind === 'PER_M3' ? { bonusRatePerM3: vals.bonusRatePerM3 } : {}),
              ...(kind === 'PERCENT' ? { bonusPercent: vals.bonusPercent } : {}),
            }
          : {}),
      });
    },
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
    form.setFieldsValue({ name: '', note: '', bonusKind: 'NONE' });
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
      ellipsis: true,
      width: 240,
      render: (_: unknown, row) => <Link to={`/factories/${row.id}`}>{row.name}</Link>,
    },
    {
      title: 'Balans',
      dataIndex: 'balance',
      key: 'balance',
      align: 'right',
      className: 'num',
      render: (v: string | undefined) => <BalanceTag balance={v ?? '0'} partyType="factory" />,
    },
    {
      title: 'Bonus hamyon',
      dataIndex: 'bonusBalance',
      key: 'bonusBalance',
      align: 'right',
      className: 'num',
      render: (v: string | undefined) => <MoneyCell value={v ?? '0'} />,
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
      render: (v: boolean) => (
        <StatusChip
          meta={
            v
              ? { label: 'Faol', light: token.colorSuccess, dark: token.colorSuccess }
              : { label: 'Nofaol' }
          }
        />
      ),
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
    <div>
      <PageHeader
        title="Zavodlar"
        actions={canEdit ? [{ key: 'new', label: 'Yangi zavod', primary: true, icon: <PlusOutlined />, onClick: openCreate }] : []}
      />
      <TableCard
        title="Zavodlar"
        loading={listQ.isFetching}
        toolbar={
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Input.Search
              allowClear
              placeholder="Qidirish..."
              onSearch={setSearch}
              onChange={(e) => !e.target.value && setSearch('')}
              style={{ width: 260 }}
            />
          </div>
        }
      >
        <Table<FactoryRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={listQ.isFetching}
          scroll={{ x: 'max-content' }}
          pagination={{ showSizeChanger: true, defaultPageSize: 20 }}
          size="middle"
        />
      </TableCard>

      <FormDrawer
        title={editing ? 'Zavodni tahrirlash' : 'Yangi zavod'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={() => form.submit()}
        submitting={save.isPending}
        width={480}
      >
        <Form form={form} layout="vertical" onFinish={(vals) => save.mutate(vals)}>
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
          {!editing && (
            <>
              <Divider style={{ margin: '4px 0 14px' }} plain>
                Bonus dasturi
              </Divider>
              <Form.Item name="bonusKind" label="Zavod bonus beradimi?">
                <Radio.Group
                  optionType="button"
                  buttonStyle="solid"
                  options={[
                    { value: 'NONE', label: 'Bermaydi' },
                    { value: 'PER_M3', label: "Har m³ ga so'm" },
                    { value: 'PERCENT', label: 'Foiz (%)' },
                  ]}
                />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(p, c) => p.bonusKind !== c.bonusKind}>
                {({ getFieldValue }) => {
                  const k = getFieldValue('bonusKind') as BonusKind;
                  if (k === 'PER_M3')
                    return (
                      <Form.Item
                        name="bonusRatePerM3"
                        label="Har m³ uchun bonus (so'm)"
                        rules={[{ required: true, message: 'Summani kiriting' }]}
                      >
                        <InputNumber min={0} style={{ width: '100%' }} placeholder="masalan 10" />
                      </Form.Item>
                    );
                  if (k === 'PERCENT')
                    return (
                      <Form.Item
                        name="bonusPercent"
                        label="Bonus foizi (%)"
                        rules={[{ required: true, message: 'Foizni kiriting' }]}
                      >
                        <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="masalan 5" />
                      </Form.Item>
                    );
                  return null;
                }}
              </Form.Item>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Bonus buyurtma yakunlanganda zavod hamyoniga yig'iladi. Keyin zavod sahifasidan o'zgartirsa bo'ladi.
              </Typography.Text>
            </>
          )}
        </Form>
      </FormDrawer>
    </div>
  );
}
