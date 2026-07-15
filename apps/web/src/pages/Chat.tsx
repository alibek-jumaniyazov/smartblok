import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Avatar, Button, Empty, Input, Popconfirm, Spin, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined, RobotOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import { api, apiError } from '../lib/api';
import { PageHeader } from '../components';

interface ConvRow { id: string; title: string; updatedAt: string; _count: { messages: number } }
interface Msg { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }
interface Conv { id: string; title: string; messages: Msg[] }

export default function Chat() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const chats = useQuery<ConvRow[]>({ queryKey: ['chat'], queryFn: () => api.get('/chat').then((r) => r.data) });
  const conv = useQuery<Conv>({ queryKey: ['chat', active], queryFn: () => api.get(`/chat/${active}`).then((r) => r.data), enabled: !!active });

  const create = useMutation({
    mutationFn: () => api.post('/chat', {}).then((r) => r.data),
    onError: (e) => message.error(apiError(e)),
  });
  const send = useMutation({
    mutationFn: (v: { id: string; text: string }) => api.post(`/chat/${v.id}/message`, { text: v.text }).then((r) => r.data),
    onSuccess: (_d, v) => { setText(''); qc.invalidateQueries({ queryKey: ['chat', v.id] }); qc.invalidateQueries({ queryKey: ['chat'] }); },
    onError: (e) => message.error(apiError(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/chat/${id}`),
    onSuccess: (_d, id) => { if (active === id) setActive(null); qc.invalidateQueries({ queryKey: ['chat'] }); },
    onError: (e) => message.error(apiError(e)),
  });

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [conv.data?.messages.length, send.isPending]);

  const onSend = async () => {
    const t = text.trim();
    if (!t || send.isPending) return;
    let id = active;
    if (!id) { const c = await create.mutateAsync(); id = c.id; setActive(id); }
    send.mutate({ id: id!, text: t });
  };

  const bubble = (m: Msg) => {
    const me = m.role === 'user';
    return (
      <div key={m.id} style={{ display: 'flex', gap: 10, flexDirection: me ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
        <Avatar size={30} icon={me ? <UserOutlined /> : <RobotOutlined />} style={{ background: me ? 'var(--ant-color-primary)' : '#0c6b62', flex: 'none' }} />
        <div style={{
          maxWidth: '72%', padding: '9px 13px', borderRadius: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5,
          background: me ? 'var(--ant-color-primary-bg, #e6f4ff)' : 'var(--ant-color-fill-tertiary, #f4f6f4)',
        }}>{m.content}</div>
      </div>
    );
  };

  return (
    <div>
      <PageHeader accent title="AI suhbat" subtitle="Yordamchi AI bilan suhbatlashing — suhbatlar saqlanadi"
        actions={[{ key: 'new', label: 'Yangi suhbat', icon: <PlusOutlined />, primary: true, onClick: () => { setActive(null); setText(''); } }]} />

      <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 200px)', minHeight: 420 }}>
        {/* conversation list */}
        <div style={{ width: 280, flex: 'none', overflowY: 'auto', border: '1px solid var(--ant-color-border)', borderRadius: 10, background: 'var(--ant-color-bg-container)' }}>
          <div style={{ padding: 10 }}>
            <Button block icon={<PlusOutlined />} onClick={() => { setActive(null); setText(''); }}>Yangi suhbat</Button>
          </div>
          {chats.isLoading ? <div style={{ padding: 20, textAlign: 'center' }}><Spin /></div>
            : !chats.data?.length ? <Empty description="Suhbat yo‘q" style={{ padding: 20 }} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              : chats.data.map((c) => (
                <div key={c.id} onClick={() => setActive(c.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', cursor: 'pointer', borderLeft: `3px solid ${active === c.id ? 'var(--ant-color-primary)' : 'transparent'}`, background: active === c.id ? 'var(--ant-color-fill-tertiary)' : undefined }}>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{c.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>{c._count.messages} xabar</div>
                  </div>
                  <Popconfirm title="Suhbatni o‘chirish?" okText="O‘chirish" cancelText="Bekor" okButtonProps={{ danger: true }}
                    onConfirm={() => del.mutate(c.id)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>
                </div>
              ))}
        </div>

        {/* message thread */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid var(--ant-color-border)', borderRadius: 10, background: 'var(--ant-color-bg-container)', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!active ? (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
                <RobotOutlined style={{ fontSize: 40, color: '#0c6b62' }} />
                <Typography.Paragraph style={{ marginTop: 12 }}>Savolingizni yozing — yangi suhbat avtomatik boshlanadi.</Typography.Paragraph>
              </div>
            ) : conv.isLoading ? <div style={{ margin: 'auto' }}><Spin /></div>
              : (
                <>
                  {conv.data?.messages.map(bubble)}
                  {send.isPending && (
                    <div style={{ display: 'flex', gap: 10 }}>
                      <Avatar size={30} icon={<RobotOutlined />} style={{ background: '#0c6b62', flex: 'none' }} />
                      <div style={{ padding: '9px 13px', color: 'var(--ant-color-text-secondary)' }}><Spin size="small" /> yozmoqda…</div>
                    </div>
                  )}
                  <div ref={endRef} />
                </>
              )}
          </div>
          <div style={{ borderTop: '1px solid var(--ant-color-border)', padding: 10, display: 'flex', gap: 8 }}>
            <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} placeholder="Xabar yozing…"
              autoSize={{ minRows: 1, maxRows: 5 }} onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); void onSend(); } }} />
            <Button type="primary" icon={<SendOutlined />} loading={send.isPending || create.isPending} onClick={() => void onSend()}>Yuborish</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
