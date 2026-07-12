import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  App,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Radio,
  Space,
  Switch,
  theme,
  Typography,
} from 'antd';
import { EditOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtNum } from '../lib/format';
import {
  BalanceTag,
  DataTable,
  FilterBar,
  FormDrawer,
  MoneyCell,
  StatusChip,
  TableCard,
  type FilterField,
  type SbColumn,
} from '../components';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
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

export default function Factories() {
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canEdit = hasRole('ADMIN', 'ACCOUNTANT');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FactoryRow | null>(null);
  const [form] = Form.useForm<FactoryFormValues>();

  const uf = useUrlFilters(['search', 'active']);
  const search = uf.get('search').trim().toLowerCase();
  const activeFilter = uf.get('active');

  const listQ = useQuery({
    queryKey: ['factories'],
    queryFn: () => endpoints.factories(),
  });
  const rows = useMemo(() => {
    const all = asItems(listQ.data) as FactoryRow[];
    return all.filter((f) => {
      if (activeFilter === 'true' && !f.active) return false;
      if (activeFilter === 'false' && f.active) return false;
      if (search && !f.name.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [listQ.data, search, activeFilter]);

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

  const columns: SbColumn<FactoryRow>[] = [
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
        ] as SbColumn<FactoryRow>[])
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Zavodlar"
        actions={canEdit ? [{ key: 'new', label: 'Yangi zavod', primary: true, icon: <PlusOutlined />, onClick: openCreate }] : []}
      />
      <TableCard
        toolbar={
          <FilterBar
            schema={FILTERS}
            searchPlaceholder="Zavod qidirish"
            resultMeta={
              <span className="num" style={{ color: token.colorTextSecondary, fontSize: 13 }}>
                {fmtNum(rows.length)} ta
              </span>
            }
          />
        }
      >
        <DataTable<FactoryRow>
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
          onRowOpen={(row) => navigate(`/factories/${row.id}`)}
          emptyText="Hozircha zavod yo'q"
          scroll={{ x: 'max-content' }}
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
