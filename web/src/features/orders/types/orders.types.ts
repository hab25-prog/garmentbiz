export type OrderStatus = "PENDING" | "CONFIRMED" | "IN_PRODUCTION" | "COMPLETED" | "DELIVERED" | "CANCELLED";
export interface OrderItem { id: string; productId: string; quantity: number; unitPrice: string; lineTotal: string; description: string | null; product: { id: string; name: string; sku: string | null } }
export interface Order { id: string; orderNo: string; orderDate: string; dueDate: string | null; notes: string | null; totalAmount: string; status: OrderStatus; customer: { id: string; name: string; phone: string | null; email: string | null }; items: OrderItem[]; batches?: { id: string; batchNo?: string; status?: string }[] }
export interface CreateOrderInput { customerId: string; orderDate: string; dueDate?: string; notes?: string; items: { productId: string; quantity: number; unitPrice?: string; description?: string }[] }

export type MaterialEstimateStatus = "COMPLETE" | "INCOMPLETE";
export type MaterialEstimateLineStatus = "COMPLETE" | "INSUFFICIENT_STOCK" | "NO_COST_LAYERS" | "INVENTORY_DISCREPANCY";
export interface OrderMaterialEstimateSummary {
  id: string;
  orderId: string;
  status: MaterialEstimateStatus;
  totalMaterialCost: string | null;
  estimatedAt: string;
  _count: { items: number; materials: number };
}
export interface OrderMaterialEstimate {
  id: string;
  orderId: string;
  status: MaterialEstimateStatus;
  totalMaterialCost: string | null;
  estimatedAt: string;
  items: Array<{
    id: string;
    orderItemId: string;
    productId: string;
    productNameSnapshot: string;
    orderedQuantity: number;
    hasBom: boolean;
    requirements: Array<{
      quantityPerProduct: string;
      requiredQuantity: string;
      materialEstimate: {
        materialNameSnapshot: string;
        baseUnitCodeSnapshot: string;
      };
    }>;
  }>;
  materials: Array<{
    id: string;
    materialId: string;
    materialNameSnapshot: string;
    baseUnitNameSnapshot: string;
    baseUnitCodeSnapshot: string;
    requiredQuantity: string;
    availableQuantity: string;
    fifoAvailableQuantity: string;
    shortageQuantity: string;
    status: MaterialEstimateLineStatus;
    estimatedCost: string | null;
    requirements: Array<{
      quantityPerProduct: string;
      requiredQuantity: string;
      estimateItem: { productNameSnapshot: string; orderedQuantity: number };
    }>;
    fifoLayers: Array<{
      layerReceivedAtSnapshot: string;
      layerAvailableQuantity: string;
      allocatedQuantity: string;
      unitCostSnapshot: string;
      estimatedCost: string;
    }>;
  }>;
}
