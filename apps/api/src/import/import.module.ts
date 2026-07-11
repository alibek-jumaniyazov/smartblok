import { Module } from '@nestjs/common';

// v2 importer removed with the v3 schema. The corrected 21-sheet importer
// (client sheets, pallets, driver-direct payments, alias merge, reconciliation
// report) is Phase 5 — see docs/audit/excel-spec.md §10–11.
@Module({})
export class ImportModule {}
