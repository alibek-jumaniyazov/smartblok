-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'CONFIRMED', 'LOADING', 'DELIVERING', 'DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransportMode" AS ENUM ('CLIENT_OWN', 'DEALER_ABSORBED', 'DEALER_CHARGED');

-- CreateEnum
CREATE TYPE "TransportPaidStatus" AS ENUM ('NOT_APPLICABLE', 'UNKNOWN', 'UNPAID', 'PAID', 'PAID_BY_CLIENT');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('CLIENT_IN', 'CLIENT_REFUND', 'FACTORY_OUT', 'FACTORY_REFUND', 'VEHICLE_OUT', 'TRANSPORT_DIRECT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK', 'CLICK', 'TERMINAL', 'CARD', 'USD', 'BONUS');

-- CreateEnum
CREATE TYPE "PriceKind" AS ENUM ('FACTORY_CASH', 'FACTORY_BANK', 'DEALER_SALE');

-- CreateEnum
CREATE TYPE "CostStatus" AS ENUM ('PROVISIONAL', 'PARTIAL', 'FINAL');

-- CreateEnum
CREATE TYPE "BonusProgramKind" AS ENUM ('NONE', 'PER_M3', 'PERCENT');

-- CreateEnum
CREATE TYPE "BonusTransactionType" AS ENUM ('ACCRUAL', 'WITHDRAWAL', 'DEBT_OFFSET', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('CLIENT', 'FACTORY', 'VEHICLE');

-- CreateEnum
CREATE TYPE "LedgerSource" AS ENUM ('ORDER_SALE', 'ORDER_COST', 'COST_ADJUSTMENT', 'TRANSPORT_CHARGE', 'TRANSPORT_COST', 'PAYMENT', 'PAYMENT_VOID', 'ORDER_CANCEL', 'PALLET_CHARGE', 'PALLET_RETURN_CREDIT', 'BONUS_OFFSET', 'ADJUSTMENT', 'IMPORT');

-- CreateEnum
CREATE TYPE "PalletTransactionType" AS ENUM ('RECEIVED_FROM_FACTORY', 'DELIVERED_TO_CLIENT', 'RETURNED_BY_CLIENT', 'RETURNED_TO_FACTORY', 'CHARGED_LOST', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "CashboxType" AS ENUM ('CASH', 'BANK', 'CLICK', 'TERMINAL', 'CARD');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('UZS', 'USD');

-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "CashSource" AS ENUM ('MANUAL', 'PAYMENT', 'EXPENSE', 'BONUS_WITHDRAWAL', 'REVERSAL');

-- CreateEnum
CREATE TYPE "LegalEntityKind" AS ENUM ('DEALER', 'FACTORY', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'VOID', 'STATUS_CHANGE', 'COST_FINALIZE', 'LOGIN', 'LOGIN_FAILED', 'IMPORT', 'EXPORT');

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'AGENT',
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "agentId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "note" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalEntity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LegalEntityKind" NOT NULL DEFAULT 'THIRD_PARTY',
    "inn" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "sortNo" INTEGER,
    "debtLimit" DECIMAL(18,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalEntity" TEXT,
    "phone" TEXT,
    "regionId" TEXT,
    "agentId" TEXT,
    "creditLimit" DECIMAL(18,2),
    "paymentTermDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAlias" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ClientAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPrice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "pricePerM3" DECIMAL(18,6) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ClientPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Factory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Factory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusProgram" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "kind" "BonusProgramKind" NOT NULL,
    "ratePerM3" DECIMAL(18,2),
    "percent" DECIMAL(5,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BonusProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusTransaction" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "factoryId" TEXT NOT NULL,
    "type" "BonusTransactionType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "baseAmount" DECIMAL(18,2),
    "baseM3" DECIMAL(12,3),
    "orderId" TEXT,
    "programId" TEXT,
    "paymentId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "reversalOfId" TEXT,

    CONSTRAINT "BonusTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" TEXT,
    "m3PerPallet" DECIMAL(6,3) NOT NULL DEFAULT 1.728,
    "blocksPerPallet" INTEGER,
    "unit" TEXT NOT NULL DEFAULT 'm³',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "PriceKind" NOT NULL,
    "pricePerM3" DECIMAL(18,6) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plate" TEXT,
    "driver" TEXT,
    "phone" TEXT,
    "capacityPallets" INTEGER NOT NULL DEFAULT 19,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsRoute" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "costPerTruck" DECIMAL(18,2) NOT NULL,
    "capacityPallets" INTEGER NOT NULL DEFAULT 19,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogisticsRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "agentId" TEXT,
    "clientId" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "driverName" TEXT,
    "saleTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "costTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "costStatus" "CostStatus" NOT NULL DEFAULT 'PROVISIONAL',
    "transportMode" "TransportMode" NOT NULL DEFAULT 'DEALER_ABSORBED',
    "transportCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "transportCharge" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "transportPaidStatus" "TransportPaidStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "transportPaidAt" TIMESTAMP(3),
    "note" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "costFinalizedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "importBatchId" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityM3" DECIMAL(12,3) NOT NULL,
    "palletCount" INTEGER NOT NULL DEFAULT 0,
    "palletPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "listPricePerM3" DECIMAL(18,6),
    "salePricePerM3" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "saleTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pricePending" BOOLEAN NOT NULL DEFAULT false,
    "provisionalPriceKind" "PriceKind" NOT NULL DEFAULT 'FACTORY_BANK',
    "costPricePerM3" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "finalCostPricePerM3" DECIMAL(18,6),
    "costTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "from" "OrderStatus",
    "to" "OrderStatus" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byId" TEXT,
    "note" TEXT,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderComment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "byId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "agentId" TEXT,
    "clientId" TEXT,
    "factoryId" TEXT,
    "vehicleId" TEXT,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "amount" DECIMAL(18,2) NOT NULL,
    "usdAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "denominations" JSONB,
    "payerEntityId" TEXT,
    "receiverEntityId" TEXT,
    "payerName" TEXT,
    "receiverName" TEXT,
    "cashboxId" TEXT,
    "idempotencyKey" TEXT,
    "note" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "importBatchId" TEXT,
    "reconciled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "priceKind" "PriceKind",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "voidedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" TIMESTAMP(3) NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "source" "LedgerSource" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "clientId" TEXT,
    "factoryId" TEXT,
    "vehicleId" TEXT,
    "orderId" TEXT,
    "paymentId" TEXT,
    "palletTransactionId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "reversalOfId" TEXT,
    "importBatchId" TEXT,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PalletTransaction" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "PalletTransactionType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "clientId" TEXT,
    "factoryId" TEXT,
    "orderId" TEXT,
    "unitPrice" DECIMAL(18,2),
    "note" TEXT,
    "createdById" TEXT,
    "reversalOfId" TEXT,
    "importBatchId" TEXT,

    CONSTRAINT "PalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cashbox" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CashboxType" NOT NULL DEFAULT 'CASH',
    "currency" "Currency" NOT NULL DEFAULT 'UZS',
    "entityId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cashbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashTransaction" (
    "id" TEXT NOT NULL,
    "cashboxId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" "CashDirection" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "source" "CashSource" NOT NULL DEFAULT 'MANUAL',
    "paymentId" TEXT,
    "expenseId" TEXT,
    "bonusTransactionId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "reversalOfId" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "cashboxId" TEXT,
    "note" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "importBatchId" TEXT,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "mime" TEXT,
    "size" INTEGER,
    "orderId" TEXT,
    "clientId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "stats" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_agentId_idx" ON "User"("agentId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_at_idx" ON "AuditLog"("userId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntity_name_key" ON "LegalEntity"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_name_key" ON "Agent"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

-- CreateIndex
CREATE INDEX "Client_agentId_idx" ON "Client"("agentId");

-- CreateIndex
CREATE INDEX "Client_regionId_idx" ON "Client"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAlias_name_key" ON "ClientAlias"("name");

-- CreateIndex
CREATE INDEX "ClientAlias_clientId_idx" ON "ClientAlias"("clientId");

-- CreateIndex
CREATE INDEX "ClientPrice_clientId_productId_effectiveFrom_idx" ON "ClientPrice"("clientId", "productId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPrice_clientId_productId_effectiveFrom_key" ON "ClientPrice"("clientId", "productId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Factory_name_key" ON "Factory"("name");

-- CreateIndex
CREATE INDEX "BonusProgram_factoryId_effectiveFrom_idx" ON "BonusProgram"("factoryId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "BonusProgram_factoryId_effectiveFrom_key" ON "BonusProgram"("factoryId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "BonusTransaction_paymentId_key" ON "BonusTransaction"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "BonusTransaction_reversalOfId_key" ON "BonusTransaction"("reversalOfId");

-- CreateIndex
CREATE INDEX "BonusTransaction_factoryId_at_idx" ON "BonusTransaction"("factoryId", "at");

-- CreateIndex
CREATE INDEX "BonusTransaction_orderId_idx" ON "BonusTransaction"("orderId");

-- CreateIndex
CREATE INDEX "Product_factoryId_idx" ON "Product"("factoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_factoryId_name_key" ON "Product"("factoryId", "name");

-- CreateIndex
CREATE INDEX "ProductPrice_productId_kind_effectiveFrom_idx" ON "ProductPrice"("productId", "kind", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPrice_productId_kind_effectiveFrom_key" ON "ProductPrice"("productId", "kind", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plate_key" ON "Vehicle"("plate");

-- CreateIndex
CREATE INDEX "LogisticsRoute_factoryId_regionId_effectiveFrom_idx" ON "LogisticsRoute"("factoryId", "regionId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsRoute_factoryId_regionId_effectiveFrom_key" ON "LogisticsRoute"("factoryId", "regionId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

-- CreateIndex
CREATE INDEX "Order_clientId_status_idx" ON "Order"("clientId", "status");

-- CreateIndex
CREATE INDEX "Order_factoryId_status_idx" ON "Order"("factoryId", "status");

-- CreateIndex
CREATE INDEX "Order_agentId_status_idx" ON "Order"("agentId", "status");

-- CreateIndex
CREATE INDEX "Order_vehicleId_idx" ON "Order"("vehicleId");

-- CreateIndex
CREATE INDEX "Order_status_date_idx" ON "Order"("status", "date");

-- CreateIndex
CREATE INDEX "Order_date_idx" ON "Order"("date");

-- CreateIndex
CREATE INDEX "Order_dueDate_idx" ON "Order"("dueDate");

-- CreateIndex
CREATE INDEX "Order_importBatchId_idx" ON "Order"("importBatchId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_at_idx" ON "OrderStatusHistory"("orderId", "at");

-- CreateIndex
CREATE INDEX "OrderComment_orderId_createdAt_idx" ON "OrderComment"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_clientId_date_idx" ON "Payment"("clientId", "date");

-- CreateIndex
CREATE INDEX "Payment_factoryId_date_idx" ON "Payment"("factoryId", "date");

-- CreateIndex
CREATE INDEX "Payment_vehicleId_idx" ON "Payment"("vehicleId");

-- CreateIndex
CREATE INDEX "Payment_agentId_date_idx" ON "Payment"("agentId", "date");

-- CreateIndex
CREATE INDEX "Payment_kind_date_idx" ON "Payment"("kind", "date");

-- CreateIndex
CREATE INDEX "Payment_cashboxId_idx" ON "Payment"("cashboxId");

-- CreateIndex
CREATE INDEX "Payment_reconciled_idx" ON "Payment"("reconciled");

-- CreateIndex
CREATE INDEX "Payment_date_idx" ON "Payment"("date");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_orderId_idx" ON "PaymentAllocation"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_palletTransactionId_key" ON "LedgerEntry"("palletTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_reversalOfId_key" ON "LedgerEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "LedgerEntry_account_clientId_date_idx" ON "LedgerEntry"("account", "clientId", "date");

-- CreateIndex
CREATE INDEX "LedgerEntry_account_factoryId_date_idx" ON "LedgerEntry"("account", "factoryId", "date");

-- CreateIndex
CREATE INDEX "LedgerEntry_account_vehicleId_date_idx" ON "LedgerEntry"("account", "vehicleId", "date");

-- CreateIndex
CREATE INDEX "LedgerEntry_source_date_idx" ON "LedgerEntry"("source", "date");

-- CreateIndex
CREATE INDEX "LedgerEntry_orderId_idx" ON "LedgerEntry"("orderId");

-- CreateIndex
CREATE INDEX "LedgerEntry_paymentId_idx" ON "LedgerEntry"("paymentId");

-- CreateIndex
CREATE INDEX "LedgerEntry_date_idx" ON "LedgerEntry"("date");

-- CreateIndex
CREATE UNIQUE INDEX "PalletTransaction_reversalOfId_key" ON "PalletTransaction"("reversalOfId");

-- CreateIndex
CREATE INDEX "PalletTransaction_clientId_type_idx" ON "PalletTransaction"("clientId", "type");

-- CreateIndex
CREATE INDEX "PalletTransaction_factoryId_type_idx" ON "PalletTransaction"("factoryId", "type");

-- CreateIndex
CREATE INDEX "PalletTransaction_orderId_idx" ON "PalletTransaction"("orderId");

-- CreateIndex
CREATE INDEX "PalletTransaction_date_idx" ON "PalletTransaction"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Cashbox_name_key" ON "Cashbox"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CashTransaction_reversalOfId_key" ON "CashTransaction"("reversalOfId");

-- CreateIndex
CREATE INDEX "CashTransaction_cashboxId_direction_idx" ON "CashTransaction"("cashboxId", "direction");

-- CreateIndex
CREATE INDEX "CashTransaction_cashboxId_date_idx" ON "CashTransaction"("cashboxId", "date");

-- CreateIndex
CREATE INDEX "CashTransaction_paymentId_idx" ON "CashTransaction"("paymentId");

-- CreateIndex
CREATE INDEX "CashTransaction_expenseId_idx" ON "CashTransaction"("expenseId");

-- CreateIndex
CREATE INDEX "CashTransaction_bonusTransactionId_idx" ON "CashTransaction"("bonusTransactionId");

-- CreateIndex
CREATE INDEX "CashTransaction_source_idx" ON "CashTransaction"("source");

-- CreateIndex
CREATE INDEX "CashTransaction_date_idx" ON "CashTransaction"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE INDEX "Expense_categoryId_idx" ON "Expense"("categoryId");

-- CreateIndex
CREATE INDEX "Expense_cashboxId_idx" ON "Expense"("cashboxId");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Document_orderId_idx" ON "Document"("orderId");

-- CreateIndex
CREATE INDEX "Document_clientId_idx" ON "Document"("clientId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAlias" ADD CONSTRAINT "ClientAlias_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPrice" ADD CONSTRAINT "ClientPrice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPrice" ADD CONSTRAINT "ClientPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusProgram" ADD CONSTRAINT "BonusProgram_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusTransaction" ADD CONSTRAINT "BonusTransaction_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusTransaction" ADD CONSTRAINT "BonusTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusTransaction" ADD CONSTRAINT "BonusTransaction_programId_fkey" FOREIGN KEY ("programId") REFERENCES "BonusProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusTransaction" ADD CONSTRAINT "BonusTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusTransaction" ADD CONSTRAINT "BonusTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusTransaction" ADD CONSTRAINT "BonusTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "BonusTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsRoute" ADD CONSTRAINT "LogisticsRoute_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsRoute" ADD CONSTRAINT "LogisticsRoute_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderComment" ADD CONSTRAINT "OrderComment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderComment" ADD CONSTRAINT "OrderComment_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_payerEntityId_fkey" FOREIGN KEY ("payerEntityId") REFERENCES "LegalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receiverEntityId_fkey" FOREIGN KEY ("receiverEntityId") REFERENCES "LegalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashboxId_fkey" FOREIGN KEY ("cashboxId") REFERENCES "Cashbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_palletTransactionId_fkey" FOREIGN KEY ("palletTransactionId") REFERENCES "PalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletTransaction" ADD CONSTRAINT "PalletTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletTransaction" ADD CONSTRAINT "PalletTransaction_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletTransaction" ADD CONSTRAINT "PalletTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletTransaction" ADD CONSTRAINT "PalletTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletTransaction" ADD CONSTRAINT "PalletTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "PalletTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletTransaction" ADD CONSTRAINT "PalletTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cashbox" ADD CONSTRAINT "Cashbox_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_cashboxId_fkey" FOREIGN KEY ("cashboxId") REFERENCES "Cashbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_bonusTransactionId_fkey" FOREIGN KEY ("bonusTransactionId") REFERENCES "BonusTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "CashTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cashboxId_fkey" FOREIGN KEY ("cashboxId") REFERENCES "Cashbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Cross-field financial invariants (service layer must satisfy these; DB is the backstop) ───

-- LedgerEntry: exactly the party matching "account" must be set
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "ledger_party_matches_account" CHECK (
  ("account" = 'CLIENT'  AND "clientId" IS NOT NULL AND "factoryId" IS NULL AND "vehicleId" IS NULL) OR
  ("account" = 'FACTORY' AND "factoryId" IS NOT NULL AND "clientId" IS NULL AND "vehicleId" IS NULL) OR
  ("account" = 'VEHICLE' AND "vehicleId" IS NOT NULL AND "clientId" IS NULL AND "factoryId" IS NULL)
);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "ledger_amount_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "ledger_bonus_offset_payment" CHECK ("source" <> 'BONUS_OFFSET' OR "paymentId" IS NOT NULL);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "ledger_pallet_link" CHECK ("source" NOT IN ('PALLET_CHARGE','PALLET_RETURN_CREDIT') OR "palletTransactionId" IS NOT NULL);

-- Payment: kind ↔ party consistency, positive amounts, BONUS never touches a cashbox
ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "payment_kind_party" CHECK (
  ("kind" IN ('CLIENT_IN','CLIENT_REFUND') AND "clientId" IS NOT NULL) OR
  ("kind" IN ('FACTORY_OUT','FACTORY_REFUND') AND "factoryId" IS NOT NULL) OR
  ("kind" = 'VEHICLE_OUT' AND "vehicleId" IS NOT NULL) OR
  ("kind" = 'TRANSPORT_DIRECT' AND "clientId" IS NOT NULL AND "vehicleId" IS NOT NULL AND "cashboxId" IS NULL)
);
ALTER TABLE "Payment" ADD CONSTRAINT "payment_bonus_no_cashbox" CHECK ("method" <> 'BONUS' OR "cashboxId" IS NULL);

ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "allocation_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "CashTransaction" ADD CONSTRAINT "cash_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "PalletTransaction" ADD CONSTRAINT "pallet_qty_nonzero" CHECK ("qty" <> 0);
ALTER TABLE "PalletTransaction" ADD CONSTRAINT "pallet_qty_positive_directional" CHECK ("type" IN ('ADJUSTMENT','REVERSAL') OR "qty" > 0);
ALTER TABLE "Expense" ADD CONSTRAINT "expense_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "BonusTransaction" ADD CONSTRAINT "bonus_amount_nonzero" CHECK ("amount" <> 0);
