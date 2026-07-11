import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Form, Input, Modal, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiError, endpoints } from '../lib/api';
import type { Region } from '../lib/types';

type RegionRow = Region & { _count?: { clients: number } };

interface RegionFormValues {
  name: string;
  note?: string | null;
}

type ModalState = { mode: 'create' } | { mode: 'edit'; row: RegionRow } | null;

export default function Regions() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();

  const [modalState, setModalState] = useState<ModalState>(null);
  const [form] = Form.useForm<RegionFormValues>();

  const q = useQuery({ queryKey: ['regions'], queryFn: () => endpoints.regions() });
  const rows = (q.data ?? []) as RegionRow[];

  const saveMut = useMutation({
    mutationFn: (v: RegionFormValues) => {
      const payload = { name: v.name, note: v.note ?? null };
      return modalState?.mode === 'edit'
        ? endpoints.updateRegion(modalState.row.id, payload)
        : endpoints.createRegion(payload);
    },
    onSuccess: () => {
      message.success(modalState?.mode === 'edit' ? 'Hudud yangilandi' : "Hudud qo'shildi");
      qc.invalidateQueries({ queryKey: ['regions'] });
      // region names are denormalized into client rows on screen
      qc.invalidateQueries({ queryKey: ['clients'] });
      setModalState(null);
    },
    onError: (err) => message.error(apiError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => endpoints.deleteRegion(id),
    onSuccess: () => {
      message.success("Hudud o'chirildi");
      qc.invalidateQueries({ queryKey: ['regions'] });
    },
    onError: (err) => message.error(apiError(err)),
  });

  const confirmDelete = (r: RegionRow) => {
    modal.confirm({
      title: "Hududni o'chirish",
      content: `"${r.name}" o'chiriladi. Mijozlar yoki marshrutlarda ishlatilayotgan hududni o'chirib bo'lmaydi.`,
      okText: "O'chirish",
      okButtonProps: { danger: true },
      cancelText: 'Bekor qilish',
      onOk: () => deleteMut.mutateAsync(r.id),
    });
  };

  const columns: ColumnsType<RegionRow> = [
    { title: 'Nomi', dataIndex: 'name', key: 'name' },
    { title: 'Izoh', dataIndex: 'note', key: 'note', render: (v: string | null) => v || '—' },
    {
      title: 'Mijozlar soni',
      key: 'clients',
      align: 'center',
      render: (_, r) => r._count?.clients ?? 0,
    },
    {
      title: 'Amallar',
      key: 'actions',
      width: 110,
      render: (_, r) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            title="Tahrirlash"
            onClick={() => setModalState({ mode: 'edit', row: r })}
          />
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            title="O'chirish"
            onClick={() => confirmDelete(r)}
          />
        </Space>
      ),
    },
  ];

  const editing = modalState?.mode === 'edit' ? modalState.row : null;

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Hududlar
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalState({ mode: 'create' })}>
          Yangi hudud
        </Button>
      </Space>

      {q.error ? (
        <Alert
          type="error"
          showIcon
          message="Hududlarni yuklashda xatolik"
          description={apiError(q.error)}
          action={
            <Button icon={<ReloadOutlined />} onClick={() => q.refetch()}>
              Qayta urinish
            </Button>
          }
        />
      ) : (
        <Table<RegionRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={q.isFetching}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
        />
      )}

      <Modal
        title={editing ? 'Hududni tahrirlash' : 'Yangi hudud'}
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
            initialValues={editing ? { name: editing.name, note: editing.note ?? undefined } : undefined}
          >
            <Form.Item name="name" label="Nomi" rules={[{ required: true, message: 'Nomi majburiy' }]}>
              <Input placeholder="Hudud nomi" />
            </Form.Item>
            <Form.Item name="note" label="Izoh">
              <Input.TextArea rows={2} placeholder="Izoh (ixtiyoriy)" />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
