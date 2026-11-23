-- AlterTable
ALTER TABLE "ProductionBatch" ADD COLUMN     "orderItemId" TEXT;

-- AlterTable
ALTER TABLE "ProductionCostSheet" ADD COLUMN     "laborCost" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MaterialCostAllocation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productionMaterialUsageId" TEXT NOT NULL,
    "materialCostLayerId" TEXT NOT NULL,
    "allocatedQuantity" DECIMAL(14,3) NOT NULL,
    "returnedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unitCostSnapshot" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialCostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialCostAllocation_businessId_productionMaterialUsageId_idx" ON "MaterialCostAllocation"("businessId", "productionMaterialUsageId");

-- CreateIndex
CREATE INDEX "MaterialCostAllocation_materialCostLayerId_idx" ON "MaterialCostAllocation"("materialCostLayerId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialCostAllocation_productionMaterialUsageId_materialCo_key" ON "MaterialCostAllocation"("productionMaterialUsageId", "materialCostLayerId");

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCostAllocation" ADD CONSTRAINT "MaterialCostAllocation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCostAllocation" ADD CONSTRAINT "MaterialCostAllocation_productionMaterialUsageId_fkey" FOREIGN KEY ("productionMaterialUsageId") REFERENCES "ProductionMaterialUsage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCostAllocation" ADD CONSTRAINT "MaterialCostAllocation_materialCostLayerId_fkey" FOREIGN KEY ("materialCostLayerId") REFERENCES "MaterialCostLayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
