import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { existsSync } from 'fs';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { RealtimeInterceptor } from './common/realtime.interceptor';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AgentsModule } from './agents/agents.module';
import { ClientsModule } from './clients/clients.module';
import { FactoriesModule } from './factories/factories.module';
import { ProductsModule } from './products/products.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PalletsModule } from './pallets/pallets.module';
import { BonusModule } from './bonus/bonus.module';
import { SettingsModule } from './settings/settings.module';
import { DebtsModule } from './debts/debts.module';
import { KassaModule } from './kassa/kassa.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { UsersModule } from './users/users.module';
import { ImportModule } from './import/import.module';
import { ChatModule } from './chat/chat.module';

// Serve the built SPA same-origin from the API process when a web build exists
// (apps/web/dist next to apps/api/dist in the deployed tree), so the frontend's
// relative '/api' baseURL works with no reverse proxy. /api/** is excluded so it
// reaches the controllers; everything else falls back to index.html for client
// routing. Absent in dev (no dist) — Vite serves the SPA there.
const webDist = join(__dirname, '..', '..', 'web', 'dist');
const serveStatic = existsSync(webDist)
  ? [ServeStaticModule.forRoot({ rootPath: webDist, exclude: ['/api/(.*)'] })]
  : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ...serveStatic,
    // generous global ceiling; login has its own strict @Throttle
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    CommonModule,
    AuthModule,
    AgentsModule,
    ClientsModule,
    FactoriesModule,
    ProductsModule,
    VehiclesModule,
    OrdersModule,
    PaymentsModule,
    PalletsModule,
    BonusModule,
    SettingsModule,
    DebtsModule,
    KassaModule,
    DashboardModule,
    UsersModule,
    ImportModule,
    ChatModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: RealtimeInterceptor },
  ],
})
export class AppModule {}
