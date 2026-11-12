import { apiClient } from "../../../lib/api-client";
import type { Purchase, CreatePurchaseInput } from "../types/purchase.types";

export const purchasesApi = {
  getAll(): Promise<Purchase[]> {
    return apiClient.get<Purchase[]>("/api/purchases");
  },

  create(input: CreatePurchaseInput): Promise<Purchase> {
    return apiClient.post<Purchase>("/api/purchases", input);
  },

  receive(purchaseId: string): Promise<Purchase> {
    return apiClient.post<Purchase>(
      `/api/purchases/${encodeURIComponent(purchaseId)}/receive`,
    );
  },
};
