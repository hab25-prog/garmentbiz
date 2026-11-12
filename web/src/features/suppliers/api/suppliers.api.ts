import { apiClient } from "../../../lib/api-client";
import type { Supplier, CreateSupplierInput } from "../types/supplier.types";

export const suppliersApi = {
  getAll(): Promise<Supplier[]> {
    return apiClient.get<Supplier[]>("/api/suppliers");
  },

  create(input: CreateSupplierInput): Promise<Supplier> {
    return apiClient.post<Supplier>("/api/suppliers", input);
  },
};
