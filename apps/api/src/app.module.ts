import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AgentsModule } from './agents/agents.module';
import { ClientsModule } from './clients/clients.module';
import { RegionsModule } from './regions/regions.module';
import { BlockSizesModule } from './block-sizes/block-sizes.module';
import { FactoriesModule } from './factories/factories.module';
import { ProcurementModule } from './procurement/procurement.module';
import { SalesModule } from './sales/sales.module';
import { PaymentsModule } from './payments/payments.module';
import { PalletsModule } from './pallets/pallets.module';
import { FactoryPaymentsModule } from './factory-payments/factory-payments.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    AgentsModule,
    ClientsModule,
    RegionsModule,
    BlockSizesModule,
    FactoriesModule,
    ProcurementModule,
    SalesModule,
    PaymentsModule,
    PalletsModule,
    FactoryPaymentsModule,
    DashboardModule,
    ReportsModule,
  ],
})
export class AppModule {}
