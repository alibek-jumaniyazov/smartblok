import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { AiReviewService } from './rules/ai-review.service';

/**
 * Excel-import staging pipeline: upload → parse → stage (ImportRow/Issue/EntityMap)
 * → owner edits in the review UI → dry-run preview → atomic commit. PrismaService is
 * global; the commit writes ledger primitives directly (proven by commit.dryrun test),
 * so no OrdersService dependency is needed here.
 */
@Module({
  controllers: [ImportController],
  providers: [ImportService, AiReviewService],
  exports: [ImportService],
})
export class ImportModule {}
