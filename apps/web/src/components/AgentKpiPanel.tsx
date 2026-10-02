import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, DatePicker, Form, InputNumber, Modal, Segmented, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SettingOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, apiError, asItems, endpoints } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import { fmtDate, fmtM3, fmtMoney } from '../lib/format';
import type { AgentKpiDay, AgentKpiMetrics, AgentKpiReport, AgentKpiRow } from '../lib/agent-kpi';
import { kpiPercentToShare, kpiShareToPercent } from '../lib/agent-kpi';
import { useT } from './LangContext';
import { ErrorState } from './EmptyState';
import { StatCard } from './StatCard';
import { TableCard } from './TableCard';

type KpiTableRow = AgentKpiMetrics & { agentId?: string | null; agentName?: string; date?: string; rowKey: string };

/** The table, daily view and agent card all read the same server calculation. */
export function AgentKpiPanel({ agentId }: { agentId?: string }) {
  const t = useT();
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const filters = useUrlFilters();
  const month = filters.get('kpiMonth') || undefined;
  const selectedAgent = agentId || filters.get('kpiAgent') || undefined;
  const rawView = filters.get('kpiView');
  const view = rawView === 'lifetime' || rawView === 'daily' ? rawView : 'monthly';
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [form] = Form.useForm<{ taxPerM3: string; agentPercent: string }>();
  const isAdmin = user?.role === 'ADMIN';
  const agents = useQuery({
    queryKey: ['agents'], queryFn: () => endpoints.agents(),
    enabled: !agentId && (user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT'),
  });
  const report = useQuery({
    queryKey: ['agent-kpi', selectedAgent, month],
    queryFn: () => api.get<AgentKpiReport>('/agents/kpi', { params: { month, agentId: selectedAgent } }).then((r) => r.data),
  });
  const data = report.data;
  const saveSettings = useMutation({
    mutationFn: (values: { taxPerM3: string; agentPercent: string }) => {
      return api.put('/agents/kpi/settings', {
        taxPerM3: values.taxPerM3,
        agentShare: kpiPercentToShare(values.agentPercent),
      });
    },
    onSuccess: () => {
      setSettingsOpen(false);
      queryClient.invalidateQueries({ queryKey: ['agent-kpi'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      message.success(t('KPI sozlamalari saqlandi'));
    },
    onError: (error) => message.error(apiError(error)),
  });
  const selected = data?.[view];
  const totals = selected?.totals;
  const rows: KpiTableRow[] = view === 'daily'
    ? (data?.daily.rows ?? []).map((row: AgentKpiDay) => ({ ...row, rowKey: row.date }))
    : (data?.[view].rows ?? []).map((row: AgentKpiRow) => ({ ...row, rowKey: row.agentId ?? 'unassigned' }));
  const metrics: Array<{ key: keyof AgentKpiMetrics; label: string; qty?: boolean }> = [
    { key: 'quantityM3', label: 'Hajm (m³)', qty: true },
    { key: 'profit', label: 'Transportdan keyingi foyda' },
    { key: 'taxAmount', label: 'Soliq' },
    { key: 'netProfit', label: 'Sof foyda' },
    { key: 'agentKpi', label: 'Agent KPI' },
    { key: 'companyProfit', label: 'Firma ulushi' },
  ];
  const columns: ColumnsType<KpiTableRow> = [
    { title: t(view === 'daily' ? 'Sana' : 'Agent'), key: 'name', width: 190,
      render: (_, row) => view === 'daily' ? fmtDate(row.date!)
        : row.agentId ? <Link to={`/agents/${row.agentId}?tab=kpi${month ? `&kpiMonth=${month}` : ''}`}>{row.agentName}</Link> : row.agentName },
    { title: t('Yuklar'), dataIndex: 'ordersCount', key: 'ordersCount', align: 'right', width: 80 },
    ...metrics.map(({ key, label, qty }) => ({
      title: t(label), dataIndex: key, key, align: 'right' as const, width: qty ? 125 : 165,
      render: (value: string) => <span className="num">{qty ? fmtM3(value) : fmtMoney(value)}</span>,
    })),
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <TableCard bodyPadding={16}>
        <Space wrap size={12}>
          <DatePicker picker="month" allowClear={false} value={dayjs(`${month ?? data?.month ?? dayjs().format('YYYY-MM')}-01`)}
            aria-label={t('KPI oyi')} onChange={(date) => date && filters.set({ kpiMonth: date.format('YYYY-MM') })} />
          {!agentId && <Select allowClear showSearch optionFilterProp="label" style={{ minWidth: 190 }}
            placeholder={t('Barcha agentlar')} aria-label={t('Agent')} value={selectedAgent}
            onChange={(value?: string) => filters.set({ kpiAgent: value ?? null })}
            options={asItems(agents.data).map((agent) => ({ value: agent.id, label: agent.name }))} />}
          <Segmented value={view} onChange={(value) => filters.set({ kpiView: String(value) })} options={[
            { value: 'monthly', label: t('Oylik KPI') }, { value: 'daily', label: t('Kunlik KPI') },
            { value: 'lifetime', label: t('Umumiy KPI') },
          ]} />
          {isAdmin && <Button icon={<SettingOutlined />} disabled={!data} onClick={() => {
            form.setFieldsValue({ taxPerM3: data!.settings.taxPerM3, agentPercent: kpiShareToPercent(data!.settings.agentShare) });
            setSettingsOpen(true);
          }}>{t('KPI sozlamalari')}</Button>}
        </Space>
        <Typography.Paragraph type="secondary" style={{ margin: '12px 0 0' }}>
          {t('Sof foyda = sotuv − tannarx − transport − soliq. Agent KPI = sof foyda × agent ulushi. To‘lov holati hisobga ta’sir qilmaydi.')}
          {' '}{t('KPI mijozga hozir biriktirilgan agent bo‘yicha hisoblanadi.')}
        </Typography.Paragraph>
        {data && <Typography.Paragraph style={{ margin: '8px 0 0' }}>
          {t('Bir kub uchun soliq')}: <b>{fmtMoney(data.settings.taxPerM3)}</b> {t("so'm")}
          {' · '}{t('Agent ulushi')}: <b>{(Number(data.settings.agentShare) * 100).toLocaleString(undefined, { maximumFractionDigits: 6 })}%</b>
          {' · '}{t('Firma ulushi')}: <b>{(Number(data.settings.companyShare) * 100).toLocaleString(undefined, { maximumFractionDigits: 6 })}%</b>
        </Typography.Paragraph>}
      </TableCard>
      {report.isError ? <ErrorState error={report.error} onRetry={() => report.refetch()} /> : <>
        {totals && <div className="sb-kpi-grid">
          <StatCard label="Agent KPI" value={totals.agentKpi} suffix="so'm" variant="in" />
          <StatCard label="Sof foyda" value={totals.netProfit} suffix="so'm" />
          <StatCard label="Firma ulushi" value={totals.companyProfit} suffix="so'm" />
          <StatCard label="Soliq" value={totals.taxAmount} suffix="so'm" />
        </div>}
        <TableCard title={t(view === 'monthly' ? 'Oylik KPI' : view === 'daily' ? 'Kunlik KPI' : 'Umumiy KPI')} loading={report.isFetching}>
          <Table<KpiTableRow> rowKey="rowKey" dataSource={rows} columns={columns} loading={report.isLoading}
            pagination={false} scroll={{ x: 1280 }} size="middle" locale={{ emptyText: t('Bu davrda yuklar yo‘q') }}
            summary={() => totals ? <Table.Summary.Row>
              <Table.Summary.Cell index={0}><b>{t('Jami')}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right"><b>{totals.ordersCount}</b></Table.Summary.Cell>
              {metrics.map(({ key, qty }, index) => <Table.Summary.Cell key={key} index={index + 2} align="right">
                <b className="num">{qty ? fmtM3(String(totals[key])) : fmtMoney(String(totals[key]))}</b>
              </Table.Summary.Cell>)}
            </Table.Summary.Row> : null} />
        </TableCard>
      </>}
      <Modal title={t('KPI sozlamalari')} open={settingsOpen} onCancel={() => setSettingsOpen(false)}
        onOk={() => form.submit()} confirmLoading={saveSettings.isPending} okText={t('Saqlash')} cancelText={t('Bekor qilish')} destroyOnHidden>
        <Typography.Paragraph>{t('Stavkalar barcha agentlar va davrlar uchun amal qiladi. Import tasdiqlanganda fayldagi KPI stavkalari qo‘llanadi.')}</Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={(values) => saveSettings.mutate(values)}>
          <Form.Item name="taxPerM3" label={t('Bir kub uchun soliq')} rules={[{ required: true }]}>
            <InputNumber stringMode min="0" precision={6} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="agentPercent" label={`${t('Agent ulushi')} (%)`} rules={[{ required: true }]}>
            <InputNumber stringMode min="0" max="100" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
