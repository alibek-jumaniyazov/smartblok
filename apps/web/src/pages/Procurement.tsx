import { useState } from 'react';
import { Alert, Button, Card, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { TrophyOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { apiError, asItems, endpoints } from '../lib/api';
import { fmtM3, fmtMoney, fmtNum } from '../lib/format';
import { Money } from '../components/Money';
import type { Paged, Product, Region } from '../lib/types';

/** row shape from ProcurementService.matrix */
interface MatrixRow {
  productId: string;
  product: string;
  size: string | null;
  factoryId: string;
  factory: string;
  m3PerPallet: string;
  factoryPricePerM3: string;
  costPerTruck: string;
  capacityPallets: number;
  truckM3: string;
  landedCostPerM3: string;
}

interface DroppedRow {
  productId: string;
  product: string;
  factoryId: string;
  factory: string;
  reason: string;
}

interface MatrixData {
  regionId: string | null;
  region: string | null;
  cheapest: MatrixRow | null;
  rows: MatrixRow[];
  dropped: DroppedRow[];
}

export default function Procurement() {
  const [regionId, setRegionId] = useState<string | undefined>(undefined);
  const [productId, setProductId] = useState<string | undefined>(undefined);

  const regionsQ = useQuery({
    queryKey: ['regions'],
    queryFn: () => endpoints.regions(),
  });
  const productsQ = useQuery({
    queryKey: ['products', 'options'],
    queryFn: async () => {
      const q = { pageSize: 200 } as { factoryId?: string; pageSize?: number };
      return (await endpoints.products(q)) as unknown as
        | Paged<Product & { factoryName?: string }>
        | (Product & { factoryName?: string })[];
    },
  });
  const products = asItems(productsQ.data);

  // matrix derives from product prices + logistics routes; keyed under 'products'
  // so realtime price changes refresh it
  const matrixQ = useQuery({
    queryKey: ['products', 'procurement-matrix', regionId ?? '', productId ?? ''],
    queryFn: async () =>
      (await endpoints.procurementMatrix({ regionId, productId })) as MatrixData,
    enabled: !!regionId,
  });

  const data = matrixQ.data;
  const cheapest = data?.cheapest ?? null;
  const isCheapest = (r: MatrixRow) =>
    !!cheapest && r.productId === cheapest.productId && r.factoryId === cheapest.factoryId;

  const columns: TableColumnsType<MatrixRow> = [
    {
      title: 'Zavod',
      dataIndex: 'factory',
      key: 'factory',
      render: (v: string, r) => (
        <Space size={6}>
          <span>{v}</span>
          {isCheapest(r) && (
            <Tag color="green" icon={<TrophyOutlined />}>
              Eng arzon
            </Tag>
          )}
        </Space>
      ),
    },
    { title: 'Mahsulot', dataIndex: 'product', key: 'product' },
    { title: "O'lchami", dataIndex: 'size', key: 'size', render: (v: string | null) => v || '—' },
    {
      title: "Zavod narxi (so'm/m³)",
      dataIndex: 'factoryPricePerM3',
      key: 'factoryPricePerM3',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: "Fura narxi (so'm)",
      dataIndex: 'costPerTruck',
      key: 'costPerTruck',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} />,
    },
    {
      title: "Sig'imi (paddon)",
      dataIndex: 'capacityPallets',
      key: 'capacityPallets',
      align: 'right',
      className: 'num',
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Fura hajmi',
      dataIndex: 'truckM3',
      key: 'truckM3',
      align: 'right',
      className: 'num',
      render: (v: string) => fmtM3(v),
    },
    {
      title: "Yetkazilgan tannarx (so'm/m³)",
      dataIndex: 'landedCostPerM3',
      key: 'landedCostPerM3',
      align: 'right',
      className: 'num',
      render: (v: string) => <Money value={v} strong />,
    },
  ];

  const droppedCols: TableColumnsType<DroppedRow> = [
    { title: 'Zavod', dataIndex: 'factory', key: 'factory' },
    { title: 'Mahsulot', dataIndex: 'product', key: 'product' },
    {
      title: 'Sabab',
      dataIndex: 'reason',
      key: 'reason',
      render: (v: string) => <Tag color="orange">{v}</Tag>,
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={
          <Typography.Title level={4} style={{ margin: 0 }}>
            Ta'minot matritsasi
          </Typography.Title>
        }
        extra={
          <Space wrap>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Hudud"
              style={{ width: 200 }}
              value={regionId}
              onChange={setRegionId}
              loading={regionsQ.isFetching}
              options={(regionsQ.data ?? []).map((r: Region) => ({ value: r.id, label: r.name }))}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Mahsulot (ixtiyoriy)"
              style={{ width: 260 }}
              value={productId}
              onChange={setProductId}
              loading={productsQ.isFetching}
              options={products.map((p) => ({
                value: p.id,
                label: `${p.name}${p.size ? ` (${p.size})` : ''} — ${(p as { factoryName?: string }).factoryName ?? p.factory?.name ?? ''}`,
              }))}
            />
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          Yetkazilgan tannarx = zavodning o'tkazma narxi + fura narxi / (fura sig'imi × m³/paddon).
          Eng arzon variant yashil bilan belgilanadi.
        </Typography.Paragraph>

        {regionsQ.error ? (
          <Alert
            type="error"
            showIcon
            message="Hududlarni yuklashda xatolik"
            description={apiError(regionsQ.error)}
            action={
              <Button size="small" onClick={() => regionsQ.refetch()}>
                Qayta urinish
              </Button>
            }
          />
        ) : !regionId ? (
          <Alert type="info" showIcon message="Taqqoslash uchun hududni tanlang" />
        ) : matrixQ.error ? (
          <Alert
            type="error"
            showIcon
            message="Matritsani yuklashda xatolik"
            description={apiError(matrixQ.error)}
            action={
              <Button size="small" onClick={() => matrixQ.refetch()}>
                Qayta urinish
              </Button>
            }
          />
        ) : (
          <>
            {cheapest && (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 16 }}
                message={
                  <span>
                    Eng arzon: <b>{cheapest.factory}</b> — {cheapest.product} —{' '}
                    <b>{fmtMoney(cheapest.landedCostPerM3)} so'm/m³</b> (
                    {data?.region ?? ''} hududiga yetkazilgan holda)
                  </span>
                }
              />
            )}
            <div className="scroll-x">
              <Table<MatrixRow>
                rowKey={(r) => `${r.productId}|${r.factoryId}`}
                columns={columns}
                dataSource={data?.rows ?? []}
                loading={matrixQ.isFetching}
                pagination={false}
                size="middle"
                onRow={(r) =>
                  isCheapest(r) ? { style: { background: 'rgba(82, 196, 26, 0.12)' } } : {}
                }
              />
            </div>
          </>
        )}
      </Card>

      {regionId && !matrixQ.error && (data?.dropped?.length ?? 0) > 0 && (
        <Card size="small" title="Hisobga kirmagan mahsulotlar">
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            Quyidagilar uchun narx yoki marshrut ma'lumoti yetishmaydi — taqqoslashga kirmadi.
          </Typography.Paragraph>
          <div className="scroll-x">
            <Table<DroppedRow>
              rowKey={(r) => `${r.productId}|${r.factoryId}`}
              columns={droppedCols}
              dataSource={data?.dropped ?? []}
              pagination={false}
              size="small"
            />
          </div>
        </Card>
      )}
    </Space>
  );
}
