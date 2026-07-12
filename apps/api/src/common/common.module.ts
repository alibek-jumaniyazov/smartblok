import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { LedgerService } from './ledger.service';
import { SettingsService } from './settings.service';
import { PricingService } from './pricing.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { HealthController } from './health.controller';

@Global()
@Module({
  controllers: [HealthController],
  providers: [AuditService, LedgerService, SettingsService, PricingService, RealtimeGateway, RealtimeService],
  exports: [AuditService, LedgerService, SettingsService, PricingService, RealtimeService],
})
export class CommonModule {}
