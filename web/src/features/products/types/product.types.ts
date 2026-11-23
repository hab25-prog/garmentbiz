export interface Product {
  id: string;
  businessId: string;
  name: string;
  sku: string | null;
  description: string | null;
  category: string | null;
  basePrice: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { materialRequirements: number };
}

export interface CreateProductInput {
  name: string;
  sku?: string;
  description?: string;
  category?: string;
  basePrice?: string;
}

export interface ProductMaterialRequirement {
  id: string;
  productId: string;
  materialId: string;
  quantityPerUnit: string;
  material: {
    id: string;
    name: string;
    sku: string | null;
    unit: { id: string; name: string; code: string };
  };
}
