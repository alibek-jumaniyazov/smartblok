import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { LedgerService } from './ledger.service';
import { SettingsService } from './settings.service';
import { PricingService } from './pricing.service';

@Global()
@Module({
  providers: [AuditService, LedgerService, SettingsService, PricingService],
  exports: [AuditService, LedgerService, SettingsService, PricingService],
})
export class CommonModule {}
