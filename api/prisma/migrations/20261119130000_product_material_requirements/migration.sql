-- Add business-scoped product material requirements for BOM configuration.
-- This is additive: it creates a new table and does not modify existing rows.
CREATE TABLE "ProductMaterialRequirement" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "quantityPerUnit" DECIMAL(14,3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductMaterialRequirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductMaterialRequirement_quantityPerUnit_positive" CHECK ("quantityPerUnit" > 0)
);

CREATE UNIQUE INDEX "ProductMaterialRequirement_productId_materialId_key"
  ON "ProductMaterialRequirement"("productId", "materialId");
CREATE INDEX "ProductMaterialRequirement_businessId_productId_idx"
  ON "ProductMaterialRequirement"("businessId", "productId");
CREATE INDEX "ProductMaterialRequirement_businessId_materialId_idx"
  ON "ProductMaterialRequirement"("businessId", "materialId");

ALTER TABLE "ProductMaterialRequirement"
  ADD CONSTRAINT "ProductMaterialRequirement_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductMaterialRequirement"
  ADD CONSTRAINT "ProductMaterialRequirement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductMaterialRequirement"
  ADD CONSTRAINT "ProductMaterialRequirement_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
