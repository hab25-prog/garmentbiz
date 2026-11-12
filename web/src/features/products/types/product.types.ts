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
}

export interface CreateProductInput {
  name: string;
  sku?: string;
  description?: string;
  category?: string;
  basePrice?: string;
}
