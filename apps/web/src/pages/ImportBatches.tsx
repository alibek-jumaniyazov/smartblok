import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Typography, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { api, apiError } from '../lib/api';
import { PageHeader, TableCard } from '../components';

/** Upload entry for the Excel importer: drop the xlsx → stage it → open the review screen. */
export default function ImportBatches() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/import/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      message.success('Fayl yuklandi — koʼrib chiqishga oʼtildi');
      navigate(`/import/${res.data.batch.id}`);
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader accent title="Excel import" subtitle="«Газоблок Счет.xlsx» ni bazaga koʼchirish" />
      <TableCard>
        <Upload.Dragger
          accept=".xlsx"
          multiple={false}
          showUploadList={false}
          disabled={busy}
          beforeUpload={(file) => { void upload(file as File); return false; }}
          style={{ padding: 24 }}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">Excel faylni shu yerga tashlang yoki bosing</p>
          <p className="ant-upload-hint">Faqat .xlsx · 10 MB gacha. Fayl darhol bazaga yozilmaydi — avval koʼrib chiqasiz.</p>
        </Upload.Dragger>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          Yuklashdan soʼng: har bir qator staging’ga tushadi, xatolar belgilanadi, siz tuzatasiz,
          «Preview» balanslarni koʼrsatadi — va faqat <b>«Maʼlumotlar bazasiga yuborish»</b> tugmasi
          bosilganda hamma narsa bitta amalda saqlanadi.
        </Typography.Paragraph>
      </TableCard>
    </div>
  );
}
