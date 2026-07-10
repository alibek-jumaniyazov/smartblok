import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { LedgerService } from './ledger.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [AuditService, LedgerService, SettingsService],
  exports: [AuditService, LedgerService, SettingsService],
})
export class CommonModule {}
