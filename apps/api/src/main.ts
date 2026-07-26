import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { requireCorsOrigins } from './common/cors-origins';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  // trust the reverse proxy so req.ip is the real client IP (from X-Forwarded-For),
  // not the single proxy hop — otherwise the per-IP login throttle collapses into
  // one shared bucket and any client can lock everyone out. Set TRUST_PROXY_HOPS to
  // the number of proxies in front (default 1); 0 disables when running direct.
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  app.getHttpAdapter().getInstance().set('trust proxy', hops);

  app.use(helmet());
  // exposedHeaders: brauzerdagi JS sukut bo'yicha Content-Disposition ni O'QIY OLMAYDI.
  // Bugun bu ko'rinmaydi (dev'da vite proxy, prod'da SPA shu jarayonning o'zidan
  // beriladi — ikkalasi ham same-origin), lekin VITE_API_URL boshqa xostga
  // qo'yilishi bilan Excel eksporti jimgina «export.xlsx» nomi bilan saqlanadi.
  app.enableCors({
    origin: requireCorsOrigins(),
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // drain HTTP + Prisma cleanly on SIGTERM/SIGINT (rolling restarts, container stop)
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT) || 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`\n  SmartBlok API running on http://localhost:${port}/api\n`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
