import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/public.decorator';

/**
 * Unauthenticated liveness/readiness probe for load balancers, orchestrators and
 * uptime monitors. Confirms the process is up AND the database answers a trivial
 * query; returns 503 if the DB is unreachable so a proxy can drain the instance.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
    return { status: 'ok', db: 'up', uptime: Math.round(process.uptime()) };
  }
}
