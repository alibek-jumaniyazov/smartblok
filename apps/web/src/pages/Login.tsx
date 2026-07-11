import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Card, Form, Input, Typography, theme } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../auth/AuthContext';
import { apiError } from '../lib/api';

interface LoginForm {
  username: string;
  password: string;
}

export default function Login() {
  const { login, loading, token: authToken } = useAuth();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { token } = theme.useToken();

  // already authenticated → straight to the dashboard
  useEffect(() => {
    if (authToken) navigate('/', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  const onFinish = async (values: LoginForm) => {
    try {
      await login(values.username.trim(), values.password);
      navigate('/', { replace: true });
    } catch (err) {
      message.error(apiError(err));
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: token.colorBgLayout,
        padding: 16,
      }}
    >
      <Card style={{ width: 380, boxShadow: token.boxShadowSecondary }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Typography.Title level={2} style={{ color: token.colorPrimary, marginTop: 8, marginBottom: 6 }}>
            SmartBlok
          </Typography.Title>
          <Typography.Text type="secondary">Gazoblok biznesini bitta tizimda boshqaring</Typography.Text>
        </div>
        <Form<LoginForm> layout="vertical" size="large" requiredMark={false} onFinish={onFinish}>
          <Form.Item name="username" label="Login" rules={[{ required: true, message: 'Loginni kiriting' }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item name="password" label="Parol" rules={[{ required: true, message: 'Parolni kiriting' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={loading}>
              Kirish
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
