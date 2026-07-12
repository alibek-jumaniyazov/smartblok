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
  app.enableCors({ origin: requireCorsOrigins(), credentials: true });
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
