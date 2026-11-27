-- Add immutable owner-generated minimum selling price snapshots for orders.
-- Existing orders, estimates, inventory, FIFO layers, and production records are unchanged.
CREATE TABLE "OrderPricingCalculation" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "materialEstimateId" TEXT NOT NULL,
  "markupPercent" DECIMAL(6,2) NOT NULL,
  "materialCost" DECIMAL(14,2) NOT NULL,
  "markupAmount" DECIMAL(14,2) NOT NULL,
  "minimumOrderPrice" DECIMAL(14,2) NOT NULL,
  "averageUnitPrice" DECIMAL(14,2) NOT NULL,
  "totalOrderedQuantity" DECIMAL(14,0) NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderPricingCalculation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderPricingCalculation_values_check" CHECK (
    "markupPercent" >= 0 AND "markupPercent" <= 1000 AND
    "materialCost" >= 0 AND "markupAmount" >= 0 AND
    "minimumOrderPrice" >= 0 AND "averageUnitPrice" >= 0 AND
    "totalOrderedQuantity" > 0
  )
);

CREATE INDEX "OrderPricingCalculation_businessId_orderId_calculatedAt_idx"
  ON "OrderPricingCalculation"("businessId", "orderId", "calculatedAt");
CREATE INDEX "OrderPricingCalculation_businessId_materialEstimateId_idx"
  ON "OrderPricingCalculation"("businessId", "materialEstimateId");

CREATE UNIQUE INDEX "CustomerOrder_businessId_id_key"
  ON "CustomerOrder"("businessId", "id");
CREATE UNIQUE INDEX "OrderMaterialEstimate_businessId_orderId_id_key"
  ON "OrderMaterialEstimate"("businessId", "orderId", "id");

ALTER TABLE "OrderPricingCalculation" ADD CONSTRAINT "OrderPricingCalculation_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderPricingCalculation" ADD CONSTRAINT "OrderPricingCalculation_businessId_orderId_fkey"
  FOREIGN KEY ("businessId", "orderId") REFERENCES "CustomerOrder"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderPricingCalculation" ADD CONSTRAINT "OrderPricingCalculation_businessId_orderId_materialEstimat_fkey"
  FOREIGN KEY ("businessId", "orderId", "materialEstimateId") REFERENCES "OrderMaterialEstimate"("businessId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
