import { Tag } from 'antd';
import { COST_STATUS, ORDER_STATUS, TRANSPORT_PAID } from '../lib/format';
import type { CostStatus, OrderStatus, TransportPaidStatus } from '../lib/types';

export function OrderStatusTag({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status] ?? { label: status, color: 'default' };
  return <Tag color={s.color}>{s.label}</Tag>;
}

export function CostStatusTag({ status }: { status: CostStatus }) {
  const s = COST_STATUS[status] ?? { label: status, color: 'default' };
  return <Tag color={s.color}>{s.label}</Tag>;
}

export function TransportPaidTag({ status }: { status: TransportPaidStatus }) {
  const s = TRANSPORT_PAID[status] ?? { label: status, color: 'default' };
  return <Tag color={s.color}>{s.label}</Tag>;
}
