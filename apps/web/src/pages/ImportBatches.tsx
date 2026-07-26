import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Space, Typography, Upload } from 'antd';
import { CloudDownloadOutlined, InboxOutlined } from '@ant-design/icons';
import { api, apiError, blobError, endpoints } from '../lib/api';
import { useIsPhone } from '../lib/responsive';
import { DateRangeControl, PageHeader, TableCard } from '../components';
import { useT } from '../components/LangContext';

/**
 * Excel darvozasi: bazaga KIRISH (import) va bazadan CHIQISH (eksport) bitta joyda.
 *
 * Ikkalasi bir sahifada turadi, chunki egasi uchun bu bitta ish — «Excel bilan
 * ishlash». Eksport tepada: u kundalik amal (hisobot olish), import esa vaqti-vaqti
 * bilan bajariladigan katta amal.
 */
export default function ImportBatches() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const t = useT();
  const isPhone = useIsPhone();
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [range, setRange] = useState<{ from?: string; to?: string }>({});

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/import/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      message.success(t('Fayl yuklandi — koʼrib chiqishga oʼtildi'));
      navigate(`/import/${res.data.batch.id}`);
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    // Butun baza yig'iladi — bir necha soniya ketishi mumkin, shuning uchun
    // to'xtovsiz xabar turadi va faqat natija kelganda o'chadi.
    const hide = message.loading(t('Excel fayl tayyorlanmoqda…'), 0);
    try {
      await endpoints.exportXlsx(range.from && range.to ? range : undefined);
      message.success(t('Fayl yuklab olindi'));
    } catch (e) {
      // xato blob ichida keladi — oddiy apiError uni oʼqiy olmaydi
      message.error(await blobError(e));
    } finally {
      hide();
      setDownloading(false);
    }
  };

  const periodText =
    range.from && range.to
      ? t('Tanlangan davr harakatlari + bugungi qoldiqlar')
      : t('Butun baza — birinchi kundan bugungacha');

  return (
    <div>
      <PageHeader
        accent
        title={t('Excel — eksport va import')}
        subtitle={t('Bazani faylga chiqarish yoki daftarni bazaga koʼchirish')}
      />

      <TableCard bodyPadding={20}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>
              {t('Butun bazani Excelga chiqarish')}
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
              {t(
                'Bitta faylda: umumiy koʼrsatkichlar, mijozlar va zavodlar qoldigʼi, toʼlovlar, kassa, buyurtmalar, paddon, narxlar va bosh daftar. Har bir varaq sarlavhali, filtrli va jamili — ochish bilan nima qayerdaligi koʼrinadi.',
              )}
            </Typography.Paragraph>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ minWidth: isPhone ? '100%' : 260 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                {t('Sana oraligʼi (ixtiyoriy)')}
              </Typography.Text>
              <DateRangeControl
                from={range.from}
                to={range.to}
                onChange={(r) => setRange(r)}
                size="middle"
              />
            </div>
            <Button
              type="primary"
              size="large"
              icon={<CloudDownloadOutlined />}
              loading={downloading}
              onClick={() => void download()}
              block={isPhone}
            >
              {t('Excel faylni yuklab olish')}
            </Button>
          </div>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {periodText}
            {' · '}
            {t(
              'Sana tanlansa faqat HARAKATLAR qisqaradi (buyurtma, toʼlov, kassa, paddon); qoldiqlar va maʼlumotnomalar har doim toʼliq — chunki qoldiq bugungi holat.',
            )}
          </Typography.Text>
        </Space>
      </TableCard>

      <TableCard bodyPadding={20} style={{ marginTop: 16 }}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          {t('Excel faylni bazaga yuklash')}
        </Typography.Title>
        <Upload.Dragger
          accept=".xlsx"
          multiple={false}
          showUploadList={false}
          disabled={busy}
          beforeUpload={(file) => {
            void upload(file as File);
            return false;
          }}
          // telefonda 24px ichki zaxira 320px kenglikdan juda ko'p yeydi
          style={{ padding: isPhone ? 8 : 24 }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{t('Excel faylni shu yerga tashlang yoki bosing')}</p>
          <p className="ant-upload-hint">
            {t('Faqat .xlsx · 10 MB gacha. Fayl darhol bazaga yozilmaydi — avval koʼrib chiqasiz.')}
          </p>
        </Upload.Dragger>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
          {t(
            'Yuklashdan soʼng: har bir qator staging’ga tushadi, xatolar belgilanadi, siz tuzatasiz, «Preview» balanslarni koʼrsatadi — va faqat',
          )}{' '}
          <b>{t('«Maʼlumotlar bazasiga yuborish»')}</b>{' '}
          {t('tugmasi bosilganda hamma narsa bitta amalda saqlanadi.')}
        </Typography.Paragraph>
      </TableCard>
    </div>
  );
}
