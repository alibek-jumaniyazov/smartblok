import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
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
    PrismaModule,
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
})
export class AppModule {}
