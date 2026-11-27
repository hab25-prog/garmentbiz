import { apiClient } from "../../../lib/api-client";
import type { CreateOrderInput, Order, OrderMaterialEstimate, OrderMaterialEstimateSummary, OrderPricingCalculation, OrderPricingResponse, OrderStatus } from "../types/orders.types";
export const ordersApi = {
  getAll: () => apiClient.get<Order[]>("/api/orders"),
  getById: (id: string) => apiClient.get<Order>(`/api/orders/${encodeURIComponent(id)}`),
  create: (input: CreateOrderInput) => apiClient.post<Order>("/api/orders", input),
  updateStatus: (id: string, status: OrderStatus) => apiClient.patch<Order>(`/api/orders/${encodeURIComponent(id)}/status`, { status }),
  getMaterialEstimates: (id: string) => apiClient.get<OrderMaterialEstimateSummary[]>(`/api/orders/${encodeURIComponent(id)}/material-estimates`),
  getMaterialEstimate: (id: string, estimateId: string) => apiClient.get<OrderMaterialEstimate>(`/api/orders/${encodeURIComponent(id)}/material-estimates/${encodeURIComponent(estimateId)}`),
  createMaterialEstimate: (id: string) => apiClient.post<OrderMaterialEstimate>(`/api/orders/${encodeURIComponent(id)}/material-estimates`, {}),
  getPricing: (id: string) => apiClient.get<OrderPricingResponse>(`/api/orders/${encodeURIComponent(id)}/pricing`),
  createPricing: (id: string, markupPercent?: string) => apiClient.post<OrderPricingCalculation>(`/api/orders/${encodeURIComponent(id)}/pricing`, markupPercent === undefined ? {} : { markupPercent }),
};
