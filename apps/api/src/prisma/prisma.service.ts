import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  // drained on SIGTERM/SIGINT once app.enableShutdownHooks() runs, so rolling
  // restarts close DB connections cleanly instead of leaking them.
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
