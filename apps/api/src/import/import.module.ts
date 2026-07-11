import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

// Production Excel importer (excel-spec.md §11): 21-sheet decode, alias merge,
// driver-direct transport matching, pallet tracking, reconciliation report and
// pre-go-live rollback. PrismaService / LedgerService / AuditService come from
// the global PrismaModule / CommonModule.
@Module({
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
