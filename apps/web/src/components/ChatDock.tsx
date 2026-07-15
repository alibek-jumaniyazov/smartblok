// components/ChatDock.tsx — suzuvchi AI suhbat doki.
// Ekranning o'ng pastida launcher tugmasi; bosilganda suzuvchi suhbat paneli
// ochiladi (alohida sahifa emas). AppShell ichida joylashadi — har bir
// autentifikatsiyalangan sahifada mavjud. Suhbat mantiqi eski Chat.tsx dan olindi:
// per-user saqlanadigan suhbatlar, o'chirish, avtomatik yangi suhbat.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Avatar, Button, Empty, Input, Popconfirm, Spin, Tooltip, Typography } from 'antd';
import {
  CloseOutlined,
  DeleteOutlined,
  HistoryOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { api, apiError } from '../lib/api';
import { useT } from './LangContext';

interface ConvRow {
  id: string;
  title: string;
  updatedAt: string;
  _count: { messages: number };
}
interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
interface Conv {
  id: string;
  title: string;
  messages: Msg[];
}

export function ChatDock() {
  const t = useT();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showList, setShowList] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const chats = useQuery<ConvRow[]>({
    queryKey: ['chat'],
    queryFn: () => api.get('/chat').then((r) => r.data),
    enabled: open,
  });
  const conv = useQuery<Conv>({
    queryKey: ['chat', active],
    queryFn: () => api.get(`/chat/${active}`).then((r) => r.data),
    enabled: open && !!active,
  });

  const create = useMutation({
    mutationFn: () => api.post('/chat', {}).then((r) => r.data),
    onError: (e) => message.error(apiError(e)),
  });
  const send = useMutation({
    mutationFn: (v: { id: string; text: string }) =>
      api.post(`/chat/${v.id}/message`, { text: v.text }).then((r) => r.data),
    onSuccess: (_d, v) => {
      setText('');
      qc.invalidateQueries({ queryKey: ['chat', v.id] });
      qc.invalidateQueries({ queryKey: ['chat'] });
    },
    onError: (e) => message.error(apiError(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/chat/${id}`),
    onSuccess: (_d, id) => {
      if (active === id) setActive(null);
      qc.invalidateQueries({ queryKey: ['chat'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conv.data?.messages.length, send.isPending, open, showList]);

  const onSend = async () => {
    const val = text.trim();
    if (!val || send.isPending) return;
    let id = active;
    if (!id) {
      const c = await create.mutateAsync();
      id = c.id;
      setActive(id);
    }
    send.mutate({ id: id!, text: val });
  };

  const startNew = () => {
    setActive(null);
    setText('');
    setShowList(false);
  };
  const pick = (id: string) => {
    setActive(id);
    setShowList(false);
  };

  const bubble = (m: Msg) => {
    const me = m.role === 'user';
    return (
      <div key={m.id} className={me ? 'sb-chat-msg sb-chat-msg--me' : 'sb-chat-msg'}>
        <Avatar
          size={26}
          icon={me ? <UserOutlined /> : <RobotOutlined />}
          style={{ background: me ? 'var(--ant-color-primary)' : '#1d4ed8', flex: 'none' }}
        />
        <div className="sb-chat-bubble">{m.content}</div>
      </div>
    );
  };

  return (
    <>
      <button
        type="button"
        className={open ? 'sb-chat-fab sb-chat-fab--open no-print' : 'sb-chat-fab no-print'}
        aria-label={open ? t('Suhbatni yopish') : t('AI yordamchini ochish')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <CloseOutlined /> : <RobotOutlined />}
      </button>

      {open ? (
        <div className="sb-chat-dock no-print" role="dialog" aria-label={t('AI yordamchi bilan suhbat')}>
          {/* ── header ── */}
          <div className="sb-chat-dock__head">
            <Avatar
              size={34}
              icon={<RobotOutlined />}
              style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', flex: 'none' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sb-chat-dock__title">{t('AI yordamchi')}</div>
              <div className="sb-chat-dock__sub">{t('AI yordamchi bilan suhbat')}</div>
            </div>
            <Tooltip title={t('Suhbatlar tarixi')}>
              <Button
                type="text"
                size="small"
                className={showList ? 'sb-chat-dock__hbtn sb-chat-dock__hbtn--on' : 'sb-chat-dock__hbtn'}
                icon={<HistoryOutlined />}
                onClick={() => setShowList((s) => !s)}
              />
            </Tooltip>
            <Tooltip title={t('Yangi suhbat')}>
              <Button type="text" size="small" className="sb-chat-dock__hbtn" icon={<PlusOutlined />} onClick={startNew} />
            </Tooltip>
            <Tooltip title={t('Suhbatni yopish')}>
              <Button
                type="text"
                size="small"
                className="sb-chat-dock__hbtn"
                icon={<CloseOutlined />}
                onClick={() => setOpen(false)}
              />
            </Tooltip>
          </div>

          {/* ── body ── */}
          <div className="sb-chat-dock__body">
            <div className="sb-chat-dock__thread">
              {!active ? (
                <div className="sb-chat-dock__empty">
                  <span className="sb-chat-dock__empty-badge">
                    <RobotOutlined />
                  </span>
                  <Typography.Paragraph type="secondary" style={{ marginTop: 14, maxWidth: 260 }}>
                    {t('Savolingizni yozing — yangi suhbat avtomatik boshlanadi.')}
                  </Typography.Paragraph>
                </div>
              ) : conv.isLoading ? (
                <div style={{ margin: 'auto' }}>
                  <Spin />
                </div>
              ) : (
                <>
                  {conv.data?.messages.map(bubble)}
                  {send.isPending ? (
                    <div className="sb-chat-msg">
                      <Avatar size={26} icon={<RobotOutlined />} style={{ background: '#1d4ed8', flex: 'none' }} />
                      <div className="sb-chat-bubble sb-chat-bubble--typing">
                        <Spin size="small" /> {t('yozmoqda…')}
                      </div>
                    </div>
                  ) : null}
                  <div ref={endRef} />
                </>
              )}
            </div>

            {/* ── history overlay ── */}
            {showList ? (
              <div className="sb-chat-dock__list">
                <div className="sb-chat-dock__list-head">
                  <span>{t('Suhbatlar tarixi')}</span>
                  <Button
                    type="text"
                    size="small"
                    className="sb-chat-dock__hbtn"
                    icon={<CloseOutlined />}
                    onClick={() => setShowList(false)}
                  />
                </div>
                <div style={{ padding: 8 }}>
                  <Button block icon={<PlusOutlined />} onClick={startNew}>
                    {t('Yangi suhbat')}
                  </Button>
                </div>
                <div className="sb-chat-dock__list-body">
                  {chats.isLoading ? (
                    <div style={{ padding: 24, textAlign: 'center' }}>
                      <Spin />
                    </div>
                  ) : !chats.data?.length ? (
                    <Empty
                      description={t('Hali suhbatlar yo‘q')}
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      style={{ padding: 24 }}
                    />
                  ) : (
                    chats.data.map((c) => (
                      <div
                        key={c.id}
                        className={active === c.id ? 'sb-chat-conv sb-chat-conv--active' : 'sb-chat-conv'}
                        onClick={() => pick(c.id)}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="sb-chat-conv__title">{c.title}</div>
                          <div className="sb-chat-conv__meta">{t('{count} xabar', { count: c._count.messages })}</div>
                        </div>
                        <Popconfirm
                          title={t('Suhbatni o‘chirish?')}
                          okText={t('O‘chirish')}
                          cancelText={t('Bekor')}
                          okButtonProps={{ danger: true }}
                          onConfirm={() => del.mutate(c.id)}
                        >
                          <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </Popconfirm>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {/* ── footer ── */}
          <div className="sb-chat-dock__foot">
            <Input.TextArea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('Xabar yozing…')}
              autoSize={{ minRows: 1, maxRows: 5 }}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
            />
            <Button
              type="primary"
              shape="circle"
              icon={<SendOutlined />}
              loading={send.isPending || create.isPending}
              onClick={() => void onSend()}
              aria-label={t('Yuborish')}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
