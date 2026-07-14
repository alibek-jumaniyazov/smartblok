import { useMutation } from '@tanstack/react-query';
import { App, Button, Card, Col, Descriptions, Form, Input, Row, Typography } from 'antd';
import { LockOutlined, PhoneOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../auth/AuthContext';
import { PageHeader, StatusChip } from '../components';
import { apiError, endpoints } from '../lib/api';
import { ROLES } from '../lib/status-maps';
import type { AuthUser } from '../lib/types';

interface ProfileForm {
  name: string;
  username: string;
  phone?: string;
}

interface PasswordForm {
  password: string;
  confirm: string;
}

export default function Profile() {
  const { user, refresh } = useAuth();
  const { message, modal } = App.useApp();
  const [profileForm] = Form.useForm<ProfileForm>();
  const [passwordForm] = Form.useForm<PasswordForm>();

  // /auth/me returns phone too; the shared AuthUser type just doesn't declare it
  const phone = (user as (AuthUser & { phone?: string | null }) | null)?.phone ?? undefined;

  const profileMut = useMutation({
    mutationFn: (d: ProfileForm) => endpoints.updateProfile(d),
    onSuccess: async () => {
      await refresh();
      message.success("Profil ma'lumotlari saqlandi");
    },
    onError: (err) => message.error(apiError(err)),
  });

  const passwordMut = useMutation({
    mutationFn: async (d: PasswordForm) =>
      (await endpoints.updateProfile({ password: d.password })) as { accessToken?: string },
    onSuccess: async (res) => {
      // password change bumps tokenVersion server-side — adopt the fresh token
      // or the very next request gets a 401
      if (res?.accessToken) localStorage.setItem('sb_token', res.accessToken);
      passwordForm.resetFields();
      await refresh();
      modal.info({
        title: "Parol o'zgartirildi",
        content:
          "Xavfsizlik maqsadida boshqa qurilmalardagi barcha seanslar yakunlandi. Ushbu seans ochiq qoladi.",
      });
    },
    onError: (err) => message.error(apiError(err)),
  });

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <PageHeader title="Profil" subtitle="Shaxsiy ma'lumotlar va parol" accent />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Shaxsiy ma'lumotlar" size="small" style={{ height: '100%' }}>
            <Descriptions column={1} size="small" style={{ marginBottom: 20 }}>
              <Descriptions.Item label="Rol">
                {user ? <StatusChip meta={ROLES[user.role]} /> : '—'}
              </Descriptions.Item>
            </Descriptions>
            <Form<ProfileForm>
              form={profileForm}
              layout="vertical"
              requiredMark={false}
              initialValues={{ name: user?.name, username: user?.username, phone }}
              onFinish={(v) => profileMut.mutate({ name: v.name.trim(), username: v.username.trim(), phone: v.phone?.trim() })}
            >
              <Form.Item name="name" label="Ism" rules={[{ required: true, message: 'Ismni kiriting' }]}>
                <Input prefix={<UserOutlined />} />
              </Form.Item>
              <Form.Item name="username" label="Login" rules={[{ required: true, message: 'Loginni kiriting' }]}>
                <Input prefix={<UserOutlined />} autoComplete="username" />
              </Form.Item>
              <Form.Item name="phone" label="Telefon">
                <Input prefix={<PhoneOutlined />} placeholder="+998 ..." />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" loading={profileMut.isPending}>
                  Saqlash
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Parolni o'zgartirish" size="small" style={{ height: '100%' }}>
            <Form<PasswordForm>
              form={passwordForm}
              layout="vertical"
              requiredMark={false}
              onFinish={(v) => passwordMut.mutate(v)}
            >
              <Form.Item
                name="password"
                label="Yangi parol"
                rules={[
                  { required: true, message: 'Yangi parolni kiriting' },
                  { min: 8, message: "Parol kamida 8 ta belgidan iborat bo'lsin" },
                ]}
              >
                <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirm"
                label="Parolni tasdiqlang"
                dependencies={['password']}
                rules={[
                  { required: true, message: 'Parolni qayta kiriting' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) return Promise.resolve();
                      return Promise.reject(new Error('Parollar mos kelmadi'));
                    },
                  }),
                ]}
              >
                <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
              </Form.Item>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                Parol o'zgartirilganda boshqa qurilmalardagi barcha seanslar avtomatik yakunlanadi.
              </Typography.Paragraph>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" loading={passwordMut.isPending}>
                  Parolni yangilash
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
