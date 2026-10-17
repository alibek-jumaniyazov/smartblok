import { useEffect, useState } from 'react';
import { Alert, App, Button, DatePicker, Descriptions, Divider, Empty, Form, Input, InputNumber, Pagination, Select, Skeleton, Space, Table, Tag, Typography, theme } from 'antd';
import { DeleteOutlined, PlusOutlined, RightOutlined, UndoOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { endpoints, apiError } from '../lib/api';
import { fmtDate, fmtNum } from '../lib/format';
import { useIsPhone } from '../lib/responsive';
import { canCancelShipment, formatAcceptanceValue, inspectionPreview, SHIPMENT_STATUS } from '../lib/pallet-shipments';
import type { FactoryPalletInspection, FactoryPalletInspectionInput, FactoryPalletShipment, FactoryPalletShipmentStatus } from '../lib/types';
import { FormDrawer } from './FormDrawer';
import { ReasonModal } from './ReasonModal';
import { TableCard } from './TableCard';
import { useT } from './LangContext';

type Action = 'arrive' | 'inspect' | 'return';
interface InspectionValues {
  date: Dayjs;
  receiverName: string;
  documentRef?: string;
  lines?: { condition: string; qty: number; unitPrice: string }[];
  rejectedQty?: number;
  rejectionReason?: string;
  note?: string;
}

const moneyFormatter = (v: string | number | undefined) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const moneyParser = (v: string | undefined) => (v ?? '').replace(/\s/g, '');

function AcceptanceMoney({ value, suffix }: { value: string; suffix?: string }) {
  const t = useT();
  return <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}><span style={{ whiteSpace: 'nowrap' }}>{formatAcceptanceValue(value)}</span>{suffix ? ` ${t(suffix)}` : null}</span>;
}

function ShipmentStatus({ status }: { status: FactoryPalletShipmentStatus }) {
  const t = useT();
  const meta = SHIPMENT_STATUS[status];
  return <Tag color={meta?.color}>{t(meta?.label ?? status)}</Tag>;
}

/** Factory logistics is kept separate from the client ledger and from already accepted legacy returns. */
export function FactoryPalletShipments({ factoryId, factories, onFactoryChange, onChanged }: {
  factoryId?: string;
  factories: { id: string; name: string }[];
  onFactoryChange: (id?: string) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const isPhone = useIsPhone();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<FactoryPalletShipmentStatus>();
  const [selectedId, setSelectedId] = useState<string>();
  const [action, setAction] = useState<Action>();
  const [requestKey, setRequestKey] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reverseArrivalOpen, setReverseArrivalOpen] = useState(false);
  const [reverseRow, setReverseRow] = useState<FactoryPalletInspection>();
  const [reverseReturnRow, setReverseReturnRow] = useState<FactoryPalletShipment['warehouseReturns'][number]>();
  const [arriveForm] = Form.useForm<{ date: Dayjs; note?: string }>();
  const [inspectionForm] = Form.useForm<InspectionValues>();
  const [returnForm] = Form.useForm<{ date: Dayjs; qty: number; note: string }>();

  useEffect(() => { setPage(1); }, [factoryId, status]);
  const listQ = useQuery({
    queryKey: ['pallets', 'factory-shipments', { factoryId, status, page }],
    queryFn: () => endpoints.palletFactoryShipments({ factoryId, status, page, pageSize: 10 }),
  });
  const detailQ = useQuery({
    queryKey: ['pallets', 'factory-shipment', selectedId],
    queryFn: () => endpoints.palletFactoryShipment(selectedId!),
    enabled: !!selectedId,
  });
  const shipment = detailQ.data;
  const lines = Form.useWatch('lines', inspectionForm) ?? [];
  const rejectedQty = Number(Form.useWatch('rejectedQty', inspectionForm) ?? 0);
  const preview = inspectionPreview(lines, rejectedQty, shipment?.uninspectedQty ?? 0);
  const returnQty = Number(Form.useWatch('qty', returnForm) ?? 0);

  const changed = (text: string) => {
    message.success(t(text));
    setAction(undefined);
    onChanged();
    void detailQ.refetch();
    void listQ.refetch();
  };
  const arriveMut = useMutation({
    mutationFn: (d: { date: string; note?: string }) => endpoints.palletShipmentArrive(selectedId!, d),
    onSuccess: () => changed('Poddonlar zavodga yetib bordi — tekshiruv kutilmoqda'),
  });
  const inspectionMut = useMutation({
    mutationFn: (d: FactoryPalletInspectionInput) => endpoints.palletShipmentInspect(selectedId!, d),
    onSuccess: () => changed('Zavod tekshiruvi saqlandi — faqat qabul qilingan son qarzdan ayrildi'),
  });
  const returnMut = useMutation({
    mutationFn: (d: { requestKey: string; date: string; qty: number; note: string }) => endpoints.palletShipmentReturnRejected(selectedId!, d),
    onSuccess: () => changed('Rad etilgan poddonlar omborga qaytarildi'),
  });
  const cancelMut = useMutation({
    mutationFn: (reason: string) => endpoints.palletShipmentCancel(selectedId!, reason),
    onSuccess: () => { setCancelOpen(false); changed('Xato jo‘natish bekor qilindi — ombor qoldig‘i tiklandi'); },
  });
  const reverseMut = useMutation({
    mutationFn: (reason: string) => endpoints.palletShipmentReverseInspection(reverseRow!.id, reason),
    onSuccess: () => { setReverseRow(undefined); changed('Tekshiruv yozuvi bekor qilindi — poddonlar qayta tekshiruvga qaytdi'); },
  });
  const reverseReturnMut = useMutation({
    mutationFn: (reason: string) => endpoints.palletShipmentReverseWarehouseReturn(reverseReturnRow!.id, reason),
    onSuccess: () => { setReverseReturnRow(undefined); changed('Xato qaytish bekor qilindi — poddonlar zavoddagi rad etilgan hisobga qaytdi'); },
  });
  const reverseArrivalMut = useMutation({
    mutationFn: (reason: string) => endpoints.palletShipmentReverseArrival(selectedId!, reason),
    onSuccess: () => { setReverseArrivalOpen(false); changed('Xato yetib kelish bekor qilindi — jo‘natma yo‘lda'); },
  });
  const busy = arriveMut.isPending || inspectionMut.isPending || returnMut.isPending || cancelMut.isPending || reverseMut.isPending || reverseReturnMut.isPending || reverseArrivalMut.isPending;
  const readonly = busy || detailQ.isFetching || detailQ.isError || !shipment;
  const openAction = (next: Action) => {
    arriveMut.reset(); inspectionMut.reset(); returnMut.reset();
    setRequestKey(crypto.randomUUID());
    if (next === 'arrive') { arriveForm.resetFields(); arriveForm.setFieldsValue({ date: dayjs() }); }
    if (next === 'inspect') {
      inspectionForm.resetFields();
      inspectionForm.setFieldsValue({ date: dayjs(), lines: [{ condition: '', unitPrice: '' }], rejectedQty: 0 });
    }
    if (next === 'return') { returnForm.resetFields(); returnForm.setFieldsValue({ date: dayjs() }); }
    setAction(next);
  };
  const rows = listQ.data?.items ?? [];
  const latestMovementDate = shipment ? [shipment.dispatchedAt, shipment.arrivedAt, ...shipment.inspections.filter((row) => !row.voidedAt).map((row) => row.date), ...shipment.warehouseReturns.filter((row) => !row.voidedAt).map((row) => row.date)]
    .filter((value): value is string => !!value).sort((a, b) => dayjs(b).valueOf() - dayjs(a).valueOf())[0] : undefined;
  const cardStyle = { border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, padding: 14 };
  const dateRules = [{ required: true, message: t('Sanani tanlang') }];
  const requiredText = (messageKey: string) => [{ required: true, whitespace: true, message: t(messageKey) }];
  const datePicker = (earliest?: string | null) => <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" allowClear={false} disabledDate={(date) => date.isAfter(dayjs(), 'day') || (!!earliest && date.isBefore(dayjs(earliest), 'day'))} />;

  return <>
    <TableCard
      title={t('Zavodga poddon jo‘natmalari')}
      loading={listQ.isFetching}
      bodyPadding={isPhone ? 12 : 16}
      extra={<Space wrap style={{ width: isPhone ? '100%' : undefined }}>
        <Select allowClear showSearch optionFilterProp="label" placeholder={t('Zavod bo‘yicha')} value={factoryId} style={{ minWidth: 180, maxWidth: '100%' }} options={factories.map((factory) => ({ value: factory.id, label: factory.name }))} onChange={onFactoryChange} />
        <Select
          allowClear placeholder={t('Barcha holatlar')} value={status}
          style={{ minWidth: isPhone ? 180 : 240, maxWidth: '100%' }}
          onChange={(next) => { setStatus(next); setPage(1); }}
          options={Object.entries(SHIPMENT_STATUS).map(([value, meta]) => ({ value, label: t(meta.label) }))}
        />
      </Space>}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('Jo‘natilganda ombor kamayadi. Zavod oldidagi poddon qarzi faqat tekshiruvda qabul qilingan son bo‘yicha kamayadi.')}
      </Typography.Paragraph>
      {listQ.isError ? <Alert type="error" showIcon message={apiError(listQ.error)} action={<Button size="small" onClick={() => listQ.refetch()}>{t('Qayta urinish')}</Button>} />
        : listQ.isPending ? <Skeleton active />
        : rows.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Bu holatda jo‘natmalar yo‘q')} />
        : isPhone ? <Space orientation="vertical" style={{ width: '100%' }}>
          {rows.map((row) => <div key={row.id} style={cardStyle}>
            <Space wrap style={{ marginBottom: 8 }}><Typography.Text strong>{row.returnNo}</Typography.Text><ShipmentStatus status={row.status} /></Space>
            <div><Typography.Text strong>{row.factory.name}</Typography.Text></div>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{fmtDate(row.dispatchedAt)} · {row.vehiclePlate} · {row.driverName}</Typography.Paragraph>
            <div>{t('Jo‘natilgan')}: <b className="num">{fmtNum(row.qty)}</b> · {t('Qabul qilingan')}: <b className="num">{fmtNum(row.acceptedQty)}</b></div>
            <div>{t('Tekshirilmagan')}: <b className="num">{fmtNum(row.uninspectedQty)}</b> · {t('Rad etilgan — zavodda')}: <b className="num">{fmtNum(row.rejectedOutstandingQty)}</b></div>
            <Button block style={{ marginTop: 12 }} onClick={() => setSelectedId(row.id)} icon={<RightOutlined />}>{t('Jo‘natmani ochish')}</Button>
          </div>)}
        </Space> : <Table<FactoryPalletShipment>
          rowKey="id" size="small" dataSource={rows} pagination={false} scroll={{ x: 'max-content' }}
          columns={[
            { title: t('Jo‘natma'), key: 'returnNo', render: (_, row) => <Button type="link" style={{ padding: 0 }} onClick={() => setSelectedId(row.id)}>{row.returnNo}</Button> },
            { title: t('Sana'), dataIndex: 'dispatchedAt', render: fmtDate },
            { title: t('Zavod'), key: 'factory', render: (_, row) => row.factory.name },
            { title: t('Moshina'), key: 'vehicle', render: (_, row) => <><div>{row.vehiclePlate}</div><Typography.Text type="secondary">{row.driverName}</Typography.Text></> },
            { title: t('Holat'), dataIndex: 'status', render: (value) => <ShipmentStatus status={value} /> },
            { title: t('Jo‘natilgan'), dataIndex: 'qty', align: 'right', render: (value) => fmtNum(value) },
            { title: t('Qabul qilingan'), dataIndex: 'acceptedQty', align: 'right', render: (value) => fmtNum(value) },
            { title: t('Tekshirilmagan'), dataIndex: 'uninspectedQty', align: 'right', render: (value) => fmtNum(value) },
            { title: t('Rad etilgan — zavodda'), dataIndex: 'rejectedOutstandingQty', align: 'right', render: (value) => fmtNum(value) },
            { title: t('Qabul qiymati'), dataIndex: 'acceptanceTotal', align: 'right', render: (v) => <AcceptanceMoney value={v} /> },
          ]}
        />}
      {(listQ.data?.total ?? 0) > 10 ? <Pagination size="small" current={page} total={listQ.data?.total} pageSize={10} showSizeChanger={false} onChange={setPage} style={{ marginTop: 16, justifyContent: 'flex-end' }} /> : null}
    </TableCard>

    <FormDrawer open={!!selectedId} title={shipment ? `${shipment.returnNo} · ${shipment.factory.name}` : t('Poddon jo‘natmasi')} onClose={() => { if (!busy) setSelectedId(undefined); }} cancelText="Yopish" width={820}>
      {detailQ.isPending ? <Skeleton active /> : detailQ.isError ? <Alert type="error" showIcon message={apiError(detailQ.error)} action={<Button onClick={() => detailQ.refetch()}>{t('Qayta urinish')}</Button>} /> : shipment ? <>
        <Space wrap style={{ marginBottom: 16 }}><ShipmentStatus status={shipment.status} /><Typography.Text type="secondary">{shipment.vehiclePlate} · {shipment.driverName}</Typography.Text></Space>
        <Descriptions column={isPhone ? 1 : 2} size="small" bordered items={[
          { key: 'dispatch', label: t('Jo‘natilgan sana'), children: fmtDate(shipment.dispatchedAt) },
          { key: 'arrival', label: t('Zavodga yetib kelgan'), children: shipment.arrivedAt ? fmtDate(shipment.arrivedAt) : '—' },
          { key: 'qty', label: t('Jo‘natilgan'), children: `${fmtNum(shipment.qty)} ${t('dona')}` },
          { key: 'accepted', label: t('Qabul qilingan'), children: `${fmtNum(shipment.acceptedQty)} ${t('dona')}` },
          { key: 'uninspected', label: t('Tekshirilmagan'), children: `${fmtNum(shipment.uninspectedQty)} ${t('dona')}` },
          { key: 'rejected', label: t('Rad etilgan — zavodda'), children: `${fmtNum(shipment.rejectedOutstandingQty)} ${t('dona')}` },
          { key: 'returned', label: t('Omborga qaytgan'), children: `${fmtNum(shipment.returnedQty)} ${t('dona')}` },
          { key: 'amount', label: t('Qabul qiymati'), children: <AcceptanceMoney value={shipment.acceptanceTotal} suffix="so'm" /> },
        ]} />
        {shipment.note ? <Typography.Paragraph style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{shipment.note}</Typography.Paragraph> : null}
        {shipment.arrivalNote ? <Typography.Paragraph type="secondary" style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{t('Yetib kelish izohi')}: {shipment.arrivalNote}</Typography.Paragraph> : null}
        {shipment.status === 'CANCELLED' ? <Alert style={{ marginTop: 16 }} type="warning" showIcon message={t('Jo‘natma bekor qilingan')} description={`${fmtDate(shipment.cancelledAt!)} · ${shipment.cancelReason ?? ''}`} /> : <>
          <Alert style={{ marginTop: 16 }} type="info" showIcon message={t('Qabul narxi zavod dalolatnomasi bo‘yicha yoziladi')} description={t('Qabul qiymati alohida qayd etiladi. Bu amal kassa yoki tovar bo‘yicha pul qarzini avtomatik o‘zgartirmaydi.')} />
          <Space wrap style={{ marginTop: 16, width: '100%' }}>
            {shipment.status === 'IN_TRANSIT' ? <Button type="primary" disabled={readonly} onClick={() => openAction('arrive')}>{t('Zavodga yetib bordi')}</Button> : null}
            {shipment.arrivedAt && shipment.uninspectedQty > 0 ? <Button type="primary" disabled={readonly} onClick={() => openAction('inspect')}>{t('Tekshiruvni kiritish')}</Button> : null}
            {shipment.rejectedOutstandingQty > 0 ? <Button disabled={readonly} onClick={() => openAction('return')}>{t('Rad etilganlarni omborga olish')}</Button> : null}
            {shipment.arrivedAt && shipment.inspections.every((row) => !!row.voidedAt) && shipment.warehouseReturns.every((row) => !!row.voidedAt) ? <Button danger disabled={readonly} onClick={() => { reverseArrivalMut.reset(); setReverseArrivalOpen(true); }}>{t('Xato yetib kelishni bekor qilish')}</Button> : null}
            {canCancelShipment(shipment) ? <Button danger disabled={readonly} onClick={() => { cancelMut.reset(); setCancelOpen(true); }}>{t('Xato jo‘natishni bekor qilish')}</Button> : null}
          </Space>
        </>}
        <Divider>{t('Zavod tekshiruvlari')}</Divider>
        {shipment.inspections.length === 0 ? <Typography.Paragraph type="secondary">{t('Hali tekshiruv kiritilmagan')}</Typography.Paragraph> : <Space orientation="vertical" style={{ width: '100%' }}>
          {shipment.inspections.map((inspection) => <div key={inspection.id} style={{ ...cardStyle, opacity: inspection.voidedAt ? 0.6 : 1 }}>
            <Space wrap><Typography.Text strong>{fmtDate(inspection.date)}</Typography.Text><span>{inspection.receiverName}</span>{inspection.documentRef ? <Tag>{inspection.documentRef}</Tag> : null}{inspection.voidedAt ? <Tag>{t('Bekor qilingan')}</Tag> : null}</Space>
            {inspection.lines.map((line) => <div key={line.id} style={{ paddingTop: 8, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span>{line.condition} · <b className="num">{fmtNum(line.qty)}</b> {t('dona')} × <AcceptanceMoney value={line.unitPrice} /></span><AcceptanceMoney value={line.amount} suffix="so'm" />
            </div>)}
            {inspection.rejectedQty > 0 ? <Alert style={{ marginTop: 10 }} type="warning" message={`${t('Rad etilgan')}: ${fmtNum(inspection.rejectedQty)} ${t('dona')}`} description={inspection.rejectionReason} /> : null}
            {inspection.note ? <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0, whiteSpace: 'pre-wrap' }}>{inspection.note}</Typography.Paragraph> : null}
            {inspection.voidedAt ? <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>{fmtDate(inspection.voidedAt)} · {inspection.voidReason}</Typography.Paragraph>
              : <Button size="small" danger icon={<UndoOutlined />} disabled={readonly || shipment.status === 'CANCELLED'} style={{ marginTop: 12 }} onClick={() => { reverseMut.reset(); setReverseRow(inspection); }}>{t('Tekshiruv yozuvini bekor qilish')}</Button>}
          </div>)}
        </Space>}
        <Divider>{t('Omborga qaytish tarixi')}</Divider>
        {shipment.warehouseReturns.length === 0 ? <Typography.Paragraph type="secondary">{t('Rad etilgan poddonlar hali omborga olinmagan')}</Typography.Paragraph>
          : shipment.warehouseReturns.map((row) => <div key={row.id} style={{ ...cardStyle, marginBottom: 8, opacity: row.voidedAt ? 0.6 : 1 }}>
            <Space wrap><Typography.Text strong>{fmtDate(row.date)} · {fmtNum(row.qty)} {t('dona')}</Typography.Text>{row.voidedAt ? <Tag>{t('Bekor qilingan')}</Tag> : null}</Space>
            <div style={{ whiteSpace: 'pre-wrap' }}>{row.note}</div>
            {row.voidedAt ? <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>{fmtDate(row.voidedAt)} · {row.voidReason}</Typography.Paragraph>
              : <Button size="small" danger icon={<UndoOutlined />} style={{ marginTop: 12 }} disabled={readonly || shipment.status === 'CANCELLED'} onClick={() => { reverseReturnMut.reset(); setReverseReturnRow(row); }}>{t('Xato qaytishni bekor qilish')}</Button>}
          </div>)}
      </> : null}
    </FormDrawer>

    <FormDrawer title={t('Zavodga yetib kelishni belgilash')} open={action === 'arrive'} onClose={() => { if (!busy) setAction(undefined); }} onSubmit={() => arriveForm.submit()} submitText="Yetib kelishni saqlash" submitting={arriveMut.isPending} disabled={readonly}>
      <Form form={arriveForm} layout="vertical" disabled={busy} onFinish={(values) => { if (!readonly) arriveMut.mutate({ date: values.date.format('YYYY-MM-DD'), note: values.note?.trim() || undefined }); }}>
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('Yetib kelish hali qabul qilish emas')} description={t('Poddonlar tekshiruvga o‘tadi. Zavod oldidagi qarz va ombor qoldig‘i bu bosqichda o‘zgarmaydi.')} />
        {arriveMut.isError ? <Alert type="error" showIcon message={apiError(arriveMut.error)} style={{ marginBottom: 16 }} /> : null}
        <Form.Item name="date" label={t('Yetib kelgan sana')} rules={dateRules}>{datePicker(shipment?.dispatchedAt)}</Form.Item>
        <Form.Item name="note" label={t('Izoh')}><Input.TextArea maxLength={1000} rows={3} /></Form.Item>
      </Form>
    </FormDrawer>

    <FormDrawer title={t('Zavod tekshiruvi va qabul narxlari')} open={action === 'inspect'} onClose={() => { if (!busy) setAction(undefined); }} onSubmit={() => inspectionForm.submit()} submitText="Tekshiruvni saqlash" width={720} submitting={inspectionMut.isPending} disabled={readonly || !preview.valid}>
      <Form form={inspectionForm} layout="vertical" disabled={busy} onFinish={(values) => {
        if (readonly || !preview.valid) return;
        inspectionMut.mutate({ requestKey, date: values.date.format('YYYY-MM-DD'), receiverName: values.receiverName.trim(), documentRef: values.documentRef?.trim() || undefined, lines: (values.lines ?? []).map((line) => ({ condition: line.condition.trim(), qty: line.qty, unitPrice: String(line.unitPrice) })), rejectedQty: values.rejectedQty ?? 0, rejectionReason: values.rejectionReason?.trim() || undefined, note: values.note?.trim() || undefined });
      }}>
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('Tekshirish uchun qolgan: {n} dona', { n: shipment?.uninspectedQty ?? 0 })} description={t('Har xil holat va narxdagi poddonlarni alohida qatorga yozing. Qolgan qismini keyingi tekshiruvda kiritish mumkin. Faqat rad etilgan bo‘lsa, qabul qatorini o‘chiring.')} />
        {inspectionMut.isError ? <Alert type="error" showIcon message={apiError(inspectionMut.error)} style={{ marginBottom: 16 }} /> : null}
        <Form.Item name="date" label={t('Tekshiruv sanasi')} rules={dateRules}>{datePicker(latestMovementDate)}</Form.Item>
        <Form.Item name="receiverName" label={t('Zavoddagi qabul qiluvchi')} rules={requiredText('Qabul qiluvchi ismini yozing')}><Input maxLength={150} autoComplete="off" /></Form.Item>
        <Form.Item name="documentRef" label={t('Dalolatnoma yoki hujjat raqami')}><Input maxLength={150} /></Form.Item>
        <Typography.Title level={5}>{t('Qabul qilingan poddonlar')}</Typography.Title>
        <Form.List name="lines">{(fields, { add, remove }) => <>
          {fields.map((field, index) => <div key={field.key} style={{ ...cardStyle, marginBottom: 12 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}><Typography.Text strong>{t('Qabul qatori')} {index + 1}</Typography.Text><Button type="text" danger icon={<DeleteOutlined />} aria-label={t('Qabul qatorini o‘chirish')} onClick={() => remove(field.name)} /></Space>
            <Form.Item name={[field.name, 'condition']} label={t('Poddon holati')} rules={requiredText('Poddon holatini yozing')}><Input maxLength={200} placeholder={t('Masalan: butun, mixlari to‘liq; yoki ta’mir talab')} /></Form.Item>
            <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr', gap: isPhone ? 0 : 16 }}>
              <Form.Item name={[field.name, 'qty']} label={t('Soni (dona)')} rules={[{ required: true, message: t('Sonini kiriting') }, { type: 'integer', min: 1, message: t('Musbat butun son kiriting') }]}><InputNumber precision={0} min={1} max={shipment?.uninspectedQty} style={{ width: '100%' }} /></Form.Item>
              <Form.Item name={[field.name, 'unitPrice']} label={t('Zavod qabul narxi / dona')} rules={[{ required: true, message: t('Qabul narxini kiriting') }]} extra={t('Zavod belgilagan narx; bepul qabul qilinsa 0 kiriting')}><InputNumber<string> stringMode precision={2} min="0" max="999999999999.99" formatter={moneyFormatter} parser={moneyParser} style={{ width: '100%' }} /></Form.Item>
            </div>
          </div>)}
          <Button block type="dashed" icon={<PlusOutlined />} disabled={busy || fields.length >= 100} onClick={() => add({ condition: '', unitPrice: '' })} style={{ marginBottom: 16 }}>{t('Boshqa holat yoki narx qo‘shish')}</Button>
        </>}</Form.List>
        <Divider />
        <Form.Item name="rejectedQty" label={t('Rad etilgan poddonlar (dona)')} rules={[{ type: 'integer', min: 0, message: t('Nol yoki musbat butun son kiriting') }]}><InputNumber precision={0} min={0} max={shipment?.uninspectedQty} style={{ width: '100%' }} /></Form.Item>
        {rejectedQty > 0 ? <Form.Item name="rejectionReason" label={t('Rad etish sababi')} rules={requiredText('Rad etish sababini yozing')}><Input.TextArea maxLength={1000} rows={2} /></Form.Item> : null}
        <Alert type={preview.totalQty > (shipment?.uninspectedQty ?? 0) ? 'error' : 'info'} showIcon style={{ marginBottom: 16 }} message={t('Tekshiruv hisobi')} description={<>
          <div>{t('Qabul qilingan')}: <b className="num">{fmtNum(preview.acceptedQty)}</b> {t('dona')}</div>
          <div>{t('Rad etilgan')}: <b className="num">{fmtNum(preview.rejectedQty)}</b> {t('dona')}</div>
          <div>{t('Keyingi tekshiruvga qoladi')}: <b className="num">{fmtNum(preview.remainingQty)}</b> {t('dona')}</div>
          <div>{t('Qabul qiymati')}: <AcceptanceMoney value={preview.amount} suffix="so'm" /></div>
          <div style={{ marginTop: 8 }}>{t('Rad etilgan poddonlar omborga amalda qaytmaguncha zaxiraga qo‘shilmaydi va zavod oldidagi qarzdan ayrilmaydi.')}</div>
          <div style={{ marginTop: 8 }}>{t('Qabul qiymati alohida qayd etiladi. Bu amal kassa yoki tovar bo‘yicha pul qarzini avtomatik o‘zgartirmaydi.')}</div>
        </>} />
        <Form.Item name="note" label={t('Izoh')}><Input.TextArea maxLength={1000} rows={2} /></Form.Item>
      </Form>
    </FormDrawer>

    <FormDrawer title={t('Rad etilgan poddonlarni omborga olish')} open={action === 'return'} onClose={() => { if (!busy) setAction(undefined); }} onSubmit={() => returnForm.submit()} submitText="Omborga qabul qilish" submitting={returnMut.isPending} disabled={readonly || !Number.isInteger(returnQty) || returnQty <= 0 || returnQty > (shipment?.rejectedOutstandingQty ?? 0)}>
      <Form form={returnForm} layout="vertical" disabled={busy} onFinish={(values) => {
        if (readonly) return;
        returnMut.mutate({ requestKey, date: values.date.format('YYYY-MM-DD'), qty: values.qty, note: values.note.trim() });
      }}>
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={t('Faqat omborga amalda qaytgan poddonlarni kiriting')} description={t('Zavodda qolgan rad etilgan son: {n} dona. Qaytgan son omborga qo‘shiladi; zavod oldidagi poddon qarzi o‘zgarmaydi.', { n: shipment?.rejectedOutstandingQty ?? 0 })} />
        {returnMut.isError ? <Alert type="error" showIcon message={apiError(returnMut.error)} style={{ marginBottom: 16 }} /> : null}
        <Form.Item name="date" label={t('Omborga qaytgan sana')} rules={dateRules}>{datePicker(latestMovementDate)}</Form.Item>
        <Form.Item name="qty" label={t('Soni (dona)')} rules={[{ required: true, message: t('Sonini kiriting') }, { type: 'integer', min: 1, max: shipment?.rejectedOutstandingQty, message: t('Qaytgan son zavodda qolgan rad etilgan sondan oshmasligi kerak') }]}><InputNumber min={1} precision={0} max={shipment?.rejectedOutstandingQty} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="note" label={t('Qaytish izohi')} rules={requiredText('Qaytish izohini yozing')}><Input.TextArea maxLength={1000} rows={3} placeholder={t('Kim olib keldi va omborga kim qabul qildi')} /></Form.Item>
      </Form>
    </FormDrawer>

    <ReasonModal open={cancelOpen} title={t('Xato jo‘natishni bekor qilish')} confirmLabel="Jo‘natishni bekor qilish" onClose={() => { if (!busy) setCancelOpen(false); }} onConfirm={(reason) => cancelMut.mutateAsync(reason).then(() => undefined)} submitting={cancelMut.isPending} error={cancelMut.error} facts={[
      { text: t('Bu amal faqat xato kiritilgan jo‘natish uchun. Poddonlar amalda omborda bo‘lishi kerak.'), tone: 'warning' },
      { text: t('Ombor qoldig‘i {n} donaga tiklanadi; zavod oldidagi qarz o‘zgarmaydi.', { n: shipment?.qty ?? 0 }) },
    ]} />
    <ReasonModal open={!!reverseRow} title={t('Tekshiruv yozuvini bekor qilish')} confirmLabel="Tekshiruvni bekor qilish" onClose={() => { if (!busy) setReverseRow(undefined); }} onConfirm={(reason) => reverseMut.mutateAsync(reason).then(() => undefined)} submitting={reverseMut.isPending} error={reverseMut.error} facts={[
      { text: t('Ushbu tekshiruvdagi qabul va rad etish yozuvlari bekor qilinadi. Poddonlar qayta tekshirilmagan holatga o‘tadi.') },
      { text: t('Qabul qilingan son zavod oldidagi qarzga qaytadi. Omborga poddon qo‘shilmaydi. Keyingi harakatlar xalaqit qilsa, bekor qilish rad etiladi.'), tone: 'warning' },
    ]} />
    <ReasonModal open={!!reverseReturnRow} title={t('Xato qaytishni bekor qilish')} confirmLabel="Qaytish yozuvini bekor qilish" onClose={() => { if (!busy) setReverseReturnRow(undefined); }} onConfirm={(reason) => reverseReturnMut.mutateAsync(reason).then(() => undefined)} submitting={reverseReturnMut.isPending} error={reverseReturnMut.error} facts={[
      { text: t('Faqat xato kiritilgan omborga qaytishni bekor qiling. Poddonlar amalda omborga kelmagan bo‘lishi kerak.'), tone: 'warning' },
      { text: t('Ombordan {n} dona ayriladi va zavodda rad etilgan poddonlar qoldig‘iga qaytadi. Zavod oldidagi qarz o‘zgarmaydi.', { n: reverseReturnRow?.qty ?? 0 }) },
    ]} />
    <ReasonModal open={reverseArrivalOpen} title={t('Xato yetib kelishni bekor qilish')} confirmLabel="Yetib kelishni bekor qilish" onClose={() => { if (!busy) setReverseArrivalOpen(false); }} onConfirm={(reason) => reverseArrivalMut.mutateAsync(reason).then(() => undefined)} submitting={reverseArrivalMut.isPending} error={reverseArrivalMut.error} facts={[
      { text: t('Faqat xato belgilangan yetib kelishni bekor qiling. Jo‘natma yana yo‘lda deb ko‘rsatiladi.'), tone: 'warning' },
      { text: t('Ombordagi son va zavod oldidagi qarz o‘zgarmaydi. Oldingi yetib kelish va tuzatish sababi audit tarixida saqlanadi.') },
    ]} />
  </>;
}
