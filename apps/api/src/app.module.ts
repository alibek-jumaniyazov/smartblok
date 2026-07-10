import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AgentsModule } from './agents/agents.module';
import { ClientsModule } from './clients/clients.module';
import { RegionsModule } from './regions/regions.module';
import { FactoriesModule } from './factories/factories.module';
import { ProductsModule } from './products/products.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { ProcurementModule } from './procurement/procurement.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { ExpensesModule } from './expenses/expenses.module';
import { DebtsModule } from './debts/debts.module';
import { KassaModule } from './kassa/kassa.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { UsersModule } from './users/users.module';
import { ImportModule } from './import/import.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // generous global ceiling; login has its own strict @Throttle
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    CommonModule,
    AuthModule,
    AgentsModule,
    ClientsModule,
    RegionsModule,
    FactoriesModule,
    ProductsModule,
    VehiclesModule,
    ProcurementModule,
    OrdersModule,
    PaymentsModule,
    ExpensesModule,
    DebtsModule,
    KassaModule,
    DashboardModule,
    ReportsModule,
    UsersModule,
    ImportModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
