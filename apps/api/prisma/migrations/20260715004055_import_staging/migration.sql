-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PARSING', 'DRAFT', 'READY', 'COMMITTING', 'COMMITTED', 'ROLLED_BACK', 'DISCARDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowKind" AS ENUM ('SHIPMENT', 'CLIENT_PAYMENT', 'FACTORY_PAYMENT', 'PALLET_RETURN', 'SHEET_BALANCE');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'READY', 'SKIPPED', 'COMMITTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportIssueSeverity" AS ENUM ('BLOCK', 'CONFIRM', 'WARN', 'INFO');

-- CreateEnum
CREATE TYPE "ImportIssueStatus" AS ENUM ('OPEN', 'ACCEPTED', 'EDITED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ImportEntityKind" AS ENUM ('CLIENT', 'AGENT', 'VEHICLE', 'PRODUCT', 'FACTORY', 'LEGAL_ENTITY');

-- CreateEnum
CREATE TYPE "ImportEntityDecision" AS ENUM ('PENDING', 'LINK', 'CREATE', 'SKIP');

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "committedAt" TIMESTAMP(3),
ADD COLUMN     "decisions" JSONB,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "preview" JSONB,
ADD COLUMN     "previewAt" TIMESTAMP(3),
ADD COLUMN     "previewHash" TEXT,
ADD COLUMN     "rolledBackAt" TIMESTAMP(3),
ADD COLUMN     "rulesSnapshot" JSONB,
ADD COLUMN     "sourceHash" TEXT,
ADD COLUMN     "status" "ImportBatchStatus" NOT NULL DEFAULT 'PARSING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" "ImportRowKind" NOT NULL,
    "sheetName" TEXT NOT NULL,
    "excelRow" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "rawJson" JSONB NOT NULL,
    "parsedJson" JSONB NOT NULL,
    "resolvedJson" JSONB NOT NULL,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "groupKey" TEXT,
    "fingerprint" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "palletTransactionId" TEXT,
    "editedById" TEXT,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportIssue" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowId" TEXT,
    "ruleId" TEXT NOT NULL,
    "severity" "ImportIssueSeverity" NOT NULL,
    "field" TEXT,
    "message" TEXT NOT NULL,
    "currentValue" JSONB,
    "suggestedValue" JSONB,
    "status" "ImportIssueStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedValue" JSONB,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportEntityMap" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" "ImportEntityKind" NOT NULL,
    "sourceName" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "sampleRows" JSONB,
    "decision" "ImportEntityDecision" NOT NULL DEFAULT 'PENDING',
    "targetId" TEXT,
    "newName" TEXT,
    "createPayload" JSONB,
    "suggestion" JSONB,
    "createdEntityId" TEXT,

    CONSTRAINT "ImportEntityMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportFingerprint" (
    "key" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" "ImportRowKind" NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportFingerprint_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ImportRow_batchId_kind_status_idx" ON "ImportRow"("batchId", "kind", "status");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_groupKey_idx" ON "ImportRow"("batchId", "groupKey");

-- CreateIndex
CREATE INDEX "ImportRow_fingerprint_idx" ON "ImportRow"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_batchId_sheetName_excelRow_key" ON "ImportRow"("batchId", "sheetName", "excelRow");

-- CreateIndex
CREATE INDEX "ImportIssue_batchId_status_severity_idx" ON "ImportIssue"("batchId", "status", "severity");

-- CreateIndex
CREATE INDEX "ImportIssue_batchId_ruleId_idx" ON "ImportIssue"("batchId", "ruleId");

-- CreateIndex
CREATE INDEX "ImportIssue_rowId_idx" ON "ImportIssue"("rowId");

-- CreateIndex
CREATE INDEX "ImportEntityMap_batchId_kind_decision_idx" ON "ImportEntityMap"("batchId", "kind", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "ImportEntityMap_batchId_kind_normalizedKey_key" ON "ImportEntityMap"("batchId", "kind", "normalizedKey");

-- CreateIndex
CREATE INDEX "ImportFingerprint_batchId_idx" ON "ImportFingerprint"("batchId");

-- CreateIndex
CREATE INDEX "ImportBatch_status_createdAt_idx" ON "ImportBatch"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportIssue" ADD CONSTRAINT "ImportIssue_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportIssue" ADD CONSTRAINT "ImportIssue_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "ImportRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportEntityMap" ADD CONSTRAINT "ImportEntityMap_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportFingerprint" ADD CONSTRAINT "ImportFingerprint_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
