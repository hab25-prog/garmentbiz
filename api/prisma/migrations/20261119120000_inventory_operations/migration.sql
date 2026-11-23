-- Additive inventory operations, source tracking, and explicit unit conversions.
-- Existing purchase, movement, production usage, and allocation rows are preserved.

ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'MANUAL_RECEIPT';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'INVENTORY_ISSUE';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'INVENTORY_RETURN';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'INVENTORY_WASTE';

CREATE TYPE "InventoryLayerSource" AS ENUM ('PURCHASE', 'MANUAL_RECEIPT', 'ADJUSTMENT_IN');
CREATE TYPE "InventoryOperationType" AS ENUM ('MANUAL_RECEIPT', 'ISSUE', 'RETURN', 'WASTE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');

ALTER TABLE "MaterialCostLayer" ALTER COLUMN "purchaseItemId" DROP NOT NULL;
ALTER TABLE "MaterialCostLayer" ADD COLUMN "sourceOperationId" TEXT;
ALTER TABLE "MaterialCostLayer" ADD COLUMN "sourceType" "InventoryLayerSource" NOT NULL DEFAULT 'PURCHASE';
ALTER TABLE "MaterialCostLayer" ADD COLUMN "receivedAt" TIMESTAMP(3);
UPDATE "MaterialCostLayer" l SET "receivedAt" = COALESCE(p."receivedAt", p."purchaseDate")
FROM "PurchaseItem" pi JOIN "Purchase" p ON p.id = pi."purchaseId"
WHERE l."purchaseItemId" = pi.id AND l."receivedAt" IS NULL;
ALTER TABLE "MaterialCostLayer" ALTER COLUMN "receivedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MaterialCostLayer" ALTER COLUMN "receivedAt" SET NOT NULL;
CREATE UNIQUE INDEX "MaterialCostLayer_sourceOperationId_key" ON "MaterialCostLayer"("sourceOperationId");

ALTER TABLE "StockMovement" ADD COLUMN "inventoryOperationId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "unitCostSnapshot" DECIMAL(14,2);
ALTER TABLE "StockMovement" ADD COLUMN "reason" TEXT;
CREATE UNIQUE INDEX "StockMovement_inventoryOperationId_key" ON "StockMovement"("inventoryOperationId");

CREATE TABLE "InventoryOperation" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "supplierId" TEXT,
  "performedByMembershipId" TEXT NOT NULL,
  "operationType" "InventoryOperationType" NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "unitCost" DECIMAL(14,2),
  "reason" TEXT NOT NULL,
  "reference" TEXT,
  "operationKey" TEXT NOT NULL,
  "reversesOperationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryOperation_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "InventoryOperation_unitCost_nonnegative" CHECK ("unitCost" IS NULL OR "unitCost" >= 0)
);
CREATE UNIQUE INDEX "InventoryOperation_businessId_operationKey_key" ON "InventoryOperation"("businessId", "operationKey");
CREATE INDEX "InventoryOperation_businessId_materialId_createdAt_idx" ON "InventoryOperation"("businessId", "materialId", "createdAt");
CREATE INDEX "InventoryOperation_businessId_operationType_createdAt_idx" ON "InventoryOperation"("businessId", "operationType", "createdAt");
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_performedByMembershipId_fkey" FOREIGN KEY ("performedByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_reversesOperationId_fkey" FOREIGN KEY ("reversesOperationId") REFERENCES "InventoryOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialCostLayer" ADD CONSTRAINT "MaterialCostLayer_sourceOperationId_fkey" FOREIGN KEY ("sourceOperationId") REFERENCES "InventoryOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialCostLayer" ADD CONSTRAINT "MaterialCostLayer_exactly_one_source_check" CHECK (("purchaseItemId" IS NULL) <> ("sourceOperationId" IS NULL));

CREATE TABLE "InventoryCostAllocation" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "inventoryOperationId" TEXT NOT NULL,
  "materialCostLayerId" TEXT NOT NULL,
  "allocatedQuantity" DECIMAL(14,3) NOT NULL,
  "returnedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "unitCostSnapshot" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryCostAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryCostAllocation_quantity_check" CHECK ("allocatedQuantity" > 0 AND "returnedQuantity" >= 0 AND "returnedQuantity" <= "allocatedQuantity")
);
CREATE UNIQUE INDEX "InventoryCostAllocation_operation_layer_key" ON "InventoryCostAllocation"("inventoryOperationId", "materialCostLayerId");
CREATE INDEX "InventoryCostAllocation_businessId_operation_idx" ON "InventoryCostAllocation"("businessId", "inventoryOperationId");
CREATE INDEX "InventoryCostAllocation_layer_idx" ON "InventoryCostAllocation"("materialCostLayerId");
ALTER TABLE "InventoryCostAllocation" ADD CONSTRAINT "InventoryCostAllocation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryCostAllocation" ADD CONSTRAINT "InventoryCostAllocation_inventoryOperationId_fkey" FOREIGN KEY ("inventoryOperationId") REFERENCES "InventoryOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryCostAllocation" ADD CONSTRAINT "InventoryCostAllocation_materialCostLayerId_fkey" FOREIGN KEY ("materialCostLayerId") REFERENCES "MaterialCostLayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "UnitConversion" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "fromUnitId" TEXT NOT NULL,
  "toUnitId" TEXT NOT NULL,
  "factor" DECIMAL(18,9) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UnitConversion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UnitConversion_factor_positive" CHECK ("factor" > 0),
  CONSTRAINT "UnitConversion_distinct_units" CHECK ("fromUnitId" <> "toUnitId")
);
CREATE UNIQUE INDEX "UnitConversion_businessId_fromUnitId_toUnitId_key" ON "UnitConversion"("businessId", "fromUnitId", "toUnitId");
CREATE INDEX "UnitConversion_businessId_idx" ON "UnitConversion"("businessId");
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_fromUnitId_fkey" FOREIGN KEY ("fromUnitId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_toUnitId_fkey" FOREIGN KEY ("toUnitId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_inventoryOperationId_fkey" FOREIGN KEY ("inventoryOperationId") REFERENCES "InventoryOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
