-- Add immutable, auditable FIFO material-cost estimate snapshots for orders.
-- Existing orders, inventory movements, cost layers, production records, and BOM rows are unchanged.
CREATE TYPE "OrderMaterialEstimateStatus" AS ENUM ('COMPLETE', 'INCOMPLETE');
CREATE TYPE "OrderMaterialEstimateLineStatus" AS ENUM (
  'COMPLETE',
  'INSUFFICIENT_STOCK',
  'NO_COST_LAYERS',
  'INVENTORY_DISCREPANCY'
);

CREATE TABLE "OrderMaterialEstimate" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "status" "OrderMaterialEstimateStatus" NOT NULL,
  "totalMaterialCost" DECIMAL(14,2),
  "estimatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderMaterialEstimate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderMaterialEstimate_total_status_check" CHECK (
    ("status" = 'COMPLETE' AND "totalMaterialCost" IS NOT NULL) OR
    ("status" = 'INCOMPLETE' AND "totalMaterialCost" IS NULL)
  )
);
CREATE INDEX "OrderMaterialEstimate_businessId_orderId_estimatedAt_idx"
  ON "OrderMaterialEstimate"("businessId", "orderId", "estimatedAt");
ALTER TABLE "OrderMaterialEstimate" ADD CONSTRAINT "OrderMaterialEstimate_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialEstimate" ADD CONSTRAINT "OrderMaterialEstimate_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OrderMaterialEstimateItem" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "estimateId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productNameSnapshot" TEXT NOT NULL,
  "orderedQuantity" INTEGER NOT NULL,
  "hasBom" BOOLEAN NOT NULL,
  CONSTRAINT "OrderMaterialEstimateItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderMaterialEstimateItem_quantity_positive" CHECK ("orderedQuantity" > 0)
);
CREATE UNIQUE INDEX "OrderMaterialEstimateItem_estimateId_orderItemId_key"
  ON "OrderMaterialEstimateItem"("estimateId", "orderItemId");
CREATE INDEX "OrderMaterialEstimateItem_businessId_estimateId_idx"
  ON "OrderMaterialEstimateItem"("businessId", "estimateId");
ALTER TABLE "OrderMaterialEstimateItem" ADD CONSTRAINT "OrderMaterialEstimateItem_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialEstimateItem" ADD CONSTRAINT "OrderMaterialEstimateItem_estimateId_fkey"
  FOREIGN KEY ("estimateId") REFERENCES "OrderMaterialEstimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialEstimateItem" ADD CONSTRAINT "OrderMaterialEstimateItem_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialEstimateItem" ADD CONSTRAINT "OrderMaterialEstimateItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OrderMaterialEstimateMaterial" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "estimateId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "materialNameSnapshot" TEXT NOT NULL,
  "baseUnitId" TEXT NOT NULL,
  "baseUnitNameSnapshot" TEXT NOT NULL,
  "baseUnitCodeSnapshot" TEXT NOT NULL,
  "requiredQuantity" DECIMAL(14,3) NOT NULL,
  "availableQuantity" DECIMAL(14,3) NOT NULL,
  "fifoAvailableQuantity" DECIMAL(14,3) NOT NULL,
  "shortageQuantity" DECIMAL(14,3) NOT NULL,
  "status" "OrderMaterialEstimateLineStatus" NOT NULL,
  "estimatedCost" DECIMAL(14,2),
  CONSTRAINT "OrderMaterialEstimateMaterial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderMaterialEstimateMaterial_quantities_check" CHECK (
    "requiredQuantity" > 0 AND "fifoAvailableQuantity" >= 0 AND "shortageQuantity" >= 0
  ),
  CONSTRAINT "OrderMaterialEstimateMaterial_cost_status_check" CHECK (
    ("status" = 'COMPLETE' AND "estimatedCost" IS NOT NULL) OR
    ("status" <> 'COMPLETE' AND "estimatedCost" IS NULL)
  )
);
CREATE UNIQUE INDEX "OrderMaterialEstimateMaterial_estimateId_materialId_key"
  ON "OrderMaterialEstimateMaterial"("estimateId", "materialId");
CREATE INDEX "OrderMaterialEstimateMaterial_businessId_estimateId_idx"
  ON "OrderMaterialEstimateMaterial"("businessId", "estimateId");
ALTER TABLE "OrderMaterialEstimateMaterial" ADD CONSTRAINT "OrderMaterialEstimateMaterial_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialEstimateMaterial" ADD CONSTRAINT "OrderMaterialEstimateMaterial_estimateId_fkey"
  FOREIGN KEY ("estimateId") REFERENCES "OrderMaterialEstimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialEstimateMaterial" ADD CONSTRAINT "OrderMaterialEstimateMaterial_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialEstimateMaterial" ADD CONSTRAINT "OrderMaterialEstimateMaterial_baseUnitId_fkey"
  FOREIGN KEY ("baseUnitId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OrderMaterialEstimateRequirement" (
  "id" TEXT NOT NULL,
  "estimateItemId" TEXT NOT NULL,
  "materialEstimateId" TEXT NOT NULL,
  "quantityPerProduct" DECIMAL(14,3) NOT NULL,
  "requiredQuantity" DECIMAL(14,3) NOT NULL,
  CONSTRAINT "OrderMaterialEstimateRequirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderMaterialEstimateRequirement_quantities_positive" CHECK (
    "quantityPerProduct" > 0 AND "requiredQuantity" > 0
  )
);
CREATE UNIQUE INDEX "OrderMaterialEstimateRequirement_estimateItemId_materialEstimateId_key"
  ON "OrderMaterialEstimateRequirement"("estimateItemId", "materialEstimateId");
CREATE INDEX "OrderMaterialEstimateRequirement_materialEstimateId_idx"
  ON "OrderMaterialEstimateRequirement"("materialEstimateId");
ALTER TABLE "OrderMaterialEstimateRequirement" ADD CONSTRAINT "OrderMaterialEstimateRequirement_estimateItemId_fkey"
  FOREIGN KEY ("estimateItemId") REFERENCES "OrderMaterialEstimateItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialEstimateRequirement" ADD CONSTRAINT "OrderMaterialEstimateRequirement_materialEstimateId_fkey"
  FOREIGN KEY ("materialEstimateId") REFERENCES "OrderMaterialEstimateMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OrderMaterialEstimateLayer" (
  "id" TEXT NOT NULL,
  "materialEstimateId" TEXT NOT NULL,
  "materialCostLayerId" TEXT NOT NULL,
  "layerReceivedAtSnapshot" TIMESTAMP(3) NOT NULL,
  "layerAvailableQuantity" DECIMAL(14,3) NOT NULL,
  "allocatedQuantity" DECIMAL(14,3) NOT NULL,
  "unitCostSnapshot" DECIMAL(14,2) NOT NULL,
  "estimatedCost" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "OrderMaterialEstimateLayer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderMaterialEstimateLayer_values_check" CHECK (
    "layerAvailableQuantity" >= 0 AND "allocatedQuantity" > 0 AND
    "allocatedQuantity" <= "layerAvailableQuantity" AND "unitCostSnapshot" >= 0 AND
    "estimatedCost" >= 0
  )
);
CREATE UNIQUE INDEX "OrderMaterialEstimateLayer_materialEstimateId_materialCostLayerId_key"
  ON "OrderMaterialEstimateLayer"("materialEstimateId", "materialCostLayerId");
CREATE INDEX "OrderMaterialEstimateLayer_materialEstimateId_idx"
  ON "OrderMaterialEstimateLayer"("materialEstimateId");
ALTER TABLE "OrderMaterialEstimateLayer" ADD CONSTRAINT "OrderMaterialEstimateLayer_materialEstimateId_fkey"
  FOREIGN KEY ("materialEstimateId") REFERENCES "OrderMaterialEstimateMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialEstimateLayer" ADD CONSTRAINT "OrderMaterialEstimateLayer_materialCostLayerId_fkey"
  FOREIGN KEY ("materialCostLayerId") REFERENCES "MaterialCostLayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
