export type OrderStatus = "PENDING" | "CONFIRMED" | "IN_PRODUCTION" | "COMPLETED" | "DELIVERED" | "CANCELLED";
export interface OrderItem { id: string; productId: string; quantity: number; unitPrice: string; lineTotal: string; description: string | null; product: { id: string; name: string; sku: string | null } }
export type ProductionBatchStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export interface OrderProductionBatch {
  id: string;
  batchNo: string;
  orderItemId: string | null;
  status: ProductionBatchStatus;
  plannedQuantity: number;
  completedQuantity: number;
  startDate: string | null;
  completedAt: string | null;
  orderItem: { id: string; product: { id: string; name: string; sku: string | null } } | null;
}
export interface OrderActualMaterialCost {
  totalReconciledMaterialCost: string;
  batchCosts: Array<{ batchId: string; batchNo: string; orderItemId: string | null; status: ProductionBatchStatus; materialCost: string; usageCount: number; reconciledUsageCount: number; unreconciledUsageCount: number }>;
  productCosts: Array<{ orderItemId: string; productName: string; materialCost: string }>;
  activeBatchCount: number;
  completedBatchCount: number;
  unreconciledUsageCount: number;
  isFinal: boolean;
  isProvisional: boolean;
}
export interface EstimatedActualCostItem { orderItemId: string; productName: string; completedQuantity: number; estimatedMaterialCost: string | null; actualMaterialCost: string | null; variance: string | null; variancePercent: string | null; estimatedCostPerUnit: string | null; actualCostPerUnit: string | null; unreconciledUsageCount: number; unavailableReason: string | null }
export interface EstimatedVsActualMaterialCost { status: "UNAVAILABLE" | "NO_COMPLETED_PRODUCTION" | "PROVISIONAL" | "COMPLETE"; unavailableReason: string | null; estimateId: string | null; estimatedMaterialCost: string | null; actualMaterialCost: string | null; variance: string | null; variancePercent: string | null; completedQuantity: number; items: EstimatedActualCostItem[] }
export interface Order { id: string; orderNo: string; orderDate: string; dueDate: string | null; notes: string | null; totalAmount: string; status: OrderStatus; customer: { id: string; name: string; phone: string | null; email: string | null }; items: OrderItem[]; batches?: OrderProductionBatch[]; productionActualMaterialCost?: OrderActualMaterialCost; estimatedVsActualMaterialCost?: EstimatedVsActualMaterialCost }
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

export interface OrderPricingCalculation {
  id: string;
  orderId: string;
  materialEstimateId: string;
  markupPercent: string;
  materialCost: string;
  markupAmount: string;
  minimumOrderPrice: string;
  averageUnitPrice: string;
  totalOrderedQuantity: string;
  calculatedAt: string;
  materialEstimate: { id: string; status: MaterialEstimateStatus; estimatedAt: string; totalMaterialCost: string | null };
}

export interface OrderPricingResponse {
  latestEstimate: { id: string; status: MaterialEstimateStatus; totalMaterialCost: string | null; estimatedAt: string } | null;
  currentPricing: OrderPricingCalculation | null;
  history: OrderPricingCalculation[];
}
