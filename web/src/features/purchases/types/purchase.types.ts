export type PurchaseStatus = "DRAFT" | "RECEIVED" | "CANCELLED";

export interface PurchaseMaterial {
  id: string;
  name: string;
  sku: string | null;
  unit: {
    id: string;
    name: string;
    code: string;
  };
}

export interface PurchaseSupplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
}

export interface PurchaseCostLayer {
  id: string;
  originalQty: string;
  remainingQty: string;
  unitCost: string;
  status: "OPEN" | "DEPLETED";
}

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  materialId: string;
  quantity: string;
  unitCost: string;
  totalCost: string;
  material: PurchaseMaterial;
  costLayer?: PurchaseCostLayer | null;
}

export interface Purchase {
  id: string;
  businessId: string;
  supplierId: string;
  purchaseNo: string;
  status: PurchaseStatus;
  purchaseDate: string;
  receivedAt: string | null;
  subtotal: string;
  notes: string | null;
  supplier: PurchaseSupplier;
  items: PurchaseItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CreatePurchaseItemInput {
  materialId: string;
  quantity: string;
  unitCost: string;
}

export interface CreatePurchaseInput {
  supplierId: string;
  notes?: string;
  items: CreatePurchaseItemInput[];
}
